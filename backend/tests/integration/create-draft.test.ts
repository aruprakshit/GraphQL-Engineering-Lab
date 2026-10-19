/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Service: authenticated author creates a draft | Stores normalized title, generated ID, actor ownership, and draft status |
 * | Service: same title submitted twice | Creates and stores distinct draft IDs |
 * | Service: admin creates a draft | Uses the admin's own identity as author |
 * | Service: caller supplies ownership, status, or ID | Ignores protected fields and uses server-controlled values |
 * | Service: anonymous creation | Throws PostAuthenticationRequiredError without inserting |
 * | Service: invalid title | Throws InvalidPostTitleError without inserting |
 * | New draft visibility | Visible only to its author and admins |
 * | Service: storage unavailable | Propagates failure without inserting |
 * | GraphQL: user or admin creates a draft | Returns normalized draft and resolved author; stores correct ownership and status |
 * | GraphQL: anonymous caller | Returns UNAUTHENTICATED without inserting |
 * | GraphQL: blank or oversized title | Returns BAD_USER_INPUT without inserting |
 * | GraphQL: missing custom header or untrusted origin | Returns FORBIDDEN without inserting |
 * | GraphQL: protected ownership, status, or ID input fields | Rejects variables before resolver execution without inserting |
 * | GraphQL: list newly created drafts | Enforces author and admin visibility |
 * | GraphQL: authentication or write storage fails | Returns generic SERVICE_UNAVAILABLE without inserting |
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { createDraft, listVisiblePosts } from "../../src/posts/service.js";
import {
  InvalidPostTitleError,
  PostAuthenticationRequiredError,
} from "../../src/posts/errors.js";
import { graphql } from "graphql";
import { schema } from "../../src/graphql.js";
import { rootValue } from "../../src/resolvers/index.js";
import type { GraphQLContext } from "../../src/graphql-context.js";
import type {
  AccountDocument,
  Actor,
  CreatedSession,
} from "../../src/auth/models.js";
import type { PostDocument, UserDocument } from "../../src/models.js";
import { hashPassword } from "../../src/auth/passwords.js";
import { createSession, resolveSession } from "../../src/auth/sessions.js";
import { readSessionCookie } from "../../src/auth/session-cookie.js";
import { createRequestActor } from "../../src/auth/request-actor.js";
import { createAuthRequestGuard } from "../../src/auth/request-guard.js";
import { createUserLoader } from "../../src/loaders.js";

test("draft creation service", async (t) => {
  const url = process.env.TEST_MONGO_URL;
  const configuredDatabase = process.env.TEST_MONGO_DB;

  if (!url || configuredDatabase !== "graphql_engineering_lab_test") {
    throw new Error("Dedicated integration-test database is required");
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 3000,
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const database = client.db(`graphql_lab_test_drafts_${suffix}`);
  const posts = database.collection<PostDocument>("posts");

  const ada: Actor = { userId: "ada", role: "user" };
  const grace: Actor = { userId: "grace", role: "user" };
  const admin: Actor = { userId: "admin", role: "admin" };

  try {
    await client.connect();

    await t.test("creates a normalized draft owned by the actor", async () => {
      const before = await posts.countDocuments();

      const created = await createDraft(database, ada, {
        title: "  Learning  GraphQL  ",
      });

      assert.ok(created._id);
      assert.equal(created.title, "Learning  GraphQL");
      assert.equal(created.authorId, ada.userId);
      assert.equal(created.status, "draft");

      const stored = await posts.findOne({ _id: created._id });

      assert.deepEqual(stored, created);
      assert.equal(await posts.countDocuments(), before + 1);
    });

    await t.test("generates a different ID for each draft", async () => {
      const first = await createDraft(database, ada, {
        title: "Same title",
      });

      const second = await createDraft(database, ada, {
        title: "Same title",
      });

      assert.notEqual(first._id, second._id);
      assert.ok(await posts.findOne({ _id: first._id }));
      assert.ok(await posts.findOne({ _id: second._id }));
    });

    await t.test("admins create drafts under their own identity", async () => {
      const created = await createDraft(database, admin, {
        title: "Admin draft",
      });

      assert.equal(created.authorId, admin.userId);
      assert.equal(created.status, "draft");
      assert.deepEqual(await posts.findOne({ _id: created._id }), created);
    });

    await t.test(
      "ignores caller-supplied ownership, status, and ID",
      async () => {
        // EXTRA FIELDS CAN EXIST AT RUNTIME OUTSIDE GRAPHQL.
        const input = {
          title: "Ownership check",
          _id: "caller-chosen-id",
          authorId: grace.userId,
          status: "published",
        };

        const created = await createDraft(database, ada, input);

        assert.notEqual(created._id, input._id);
        assert.equal(created.authorId, ada.userId);
        assert.equal(created.status, "draft");

        assert.deepEqual(await posts.findOne({ _id: created._id }), created);

        assert.equal(await posts.findOne({ _id: input._id }), null);
      },
    );

    await t.test("rejects anonymous creation without inserting", async () => {
      const before = await posts.countDocuments();

      await assert.rejects(
        createDraft(database, null, {
          title: "Anonymous draft",
        }),
        PostAuthenticationRequiredError,
      );

      assert.equal(await posts.countDocuments(), before);
    });

    await t.test("rejects invalid titles without inserting", async () => {
      const before = await posts.countDocuments();

      for (const title of ["", " \t\n ", "a".repeat(201)]) {
        await assert.rejects(
          createDraft(database, ada, { title }),
          InvalidPostTitleError,
        );
      }

      assert.equal(await posts.countDocuments(), before);
    });

    await t.test(
      "new drafts follow the existing visibility policy",
      async () => {
        const created = await createDraft(database, ada, {
          title: "Private until published",
        });

        const scenarios = [
          { actor: null, visible: false },
          { actor: grace, visible: false },
          { actor: ada, visible: true },
          { actor: admin, visible: true },
        ];

        for (const { actor, visible } of scenarios) {
          const page = await listVisiblePosts(database, actor, {
            pageSize: 20,
            afterId: null,
          });

          assert.equal(
            page.posts.some((post) => post._id === created._id),
            visible,
          );
        }
      },
    );

    await t.test(
      "propagates storage failure without claiming success",
      async () => {
        const before = await posts.countDocuments();

        const unavailableClient = new MongoClient(url);
        const unavailableDatabase = unavailableClient.db(database.databaseName);
        await unavailableClient.close();

        await assert.rejects(
          createDraft(unavailableDatabase, ada, {
            title: "Unavailable storage",
          }),
        );

        assert.equal(await posts.countDocuments(), before);
      },
    );

    await t.test("GraphQL draft creation", async (t) => {
      const password = await hashPassword("GraphQL draft fixture password!");

      await database.collection<UserDocument>("users").insertMany([
        { _id: "ada", name: "Ada" },
        { _id: "grace", name: "Grace" },
        { _id: "admin", name: "Admin" },
      ]);

      await database.collection<AccountDocument>("accounts").insertMany([
        { _id: "ada", username: "ada", role: "user", password },
        { _id: "grace", username: "grace", role: "user", password },
        { _id: "admin", username: "admin", role: "admin", password },
      ]);

      const sessions = {
        ada: await createSession(database, "ada"),
        grace: await createSession(database, "grace"),
        admin: await createSession(database, "admin"),
      };

      const mutation = /* GraphQL */ `
        mutation CreateDraft($input: CreateDraftInput!) {
          createDraft(input: $input) {
            id
            title
            status
            author {
              id
              name
            }
          }
        }
      `;

      interface RequestOptions {
        authHeader?: string;
        origin?: string;
        database?: GraphQLContext["database"];
        authenticationDatabase?: GraphQLContext["database"];
        source?: string;
      }

      async function execute(
        session: CreatedSession | null,
        input: Record<string, unknown>,
        options: RequestOptions = {},
      ) {
        const requestDatabase = options.database ?? database;
        const authenticationDatabase =
          options.authenticationDatabase ?? database;

        const token = readSessionCookie(
          session ? `session=${session.token}` : undefined,
        );

        const guard = createAuthRequestGuard("http://localhost:4000");

        const unexpectedCall = (): never => {
          throw new Error("Draft creation invoked a login or cookie helper");
        };

        const context: GraphQLContext = {
          requestId: randomUUID(),
          database: requestDatabase,
          logDatabaseCall: () => {},
          userLoader: createUserLoader(
            requestDatabase,
            () => {},
            "create-draft-test",
          ),
          sessionToken: token,
          getActor: createRequestActor(() =>
            resolveSession(authenticationDatabase, token),
          ),
          assertAuthRequest: () => {
            guard({
              method: "POST",
              origin: options.origin ?? "http://localhost:4000",
              authHeader: options.authHeader ?? "1",
            });
          },
          verifyCredentials: async () => unexpectedCall(),
          beginLogin: unexpectedCall,
          setSessionCookie: unexpectedCall,
          clearSessionCookie: unexpectedCall,
        };

        return graphql({
          schema,
          rootValue,
          source: options.source ?? mutation,
          variableValues: { input },
          contextValue: context,
        });
      }

      await t.test(
        "users and admins create their own drafts with resolved authors",
        async () => {
          for (const person of [
            { session: sessions.ada, id: "ada", name: "Ada" },
            { session: sessions.admin, id: "admin", name: "Admin" },
          ]) {
            const before = await posts.countDocuments();
            const title = `GraphQL draft by ${person.name}`;

            const result = await execute(person.session, {
              title: `  ${title}  `,
            });

            assert.equal(result.errors, undefined);

            const stored = await posts.findOne({ title });
            assert.ok(stored);
            assert.equal(stored.authorId, person.id);
            assert.equal(stored.status, "draft");
            assert.equal(await posts.countDocuments(), before + 1);

            assert.equal(
              JSON.stringify(result.data),
              JSON.stringify({
                createDraft: {
                  id: stored._id,
                  title,
                  status: "DRAFT",
                  author: {
                    id: person.id,
                    name: person.name,
                  },
                },
              }),
            );
          }
        },
      );

      await t.test(
        "rejects anonymous and invalid requests without inserting",
        async () => {
          const scenarios = [
            {
              session: null,
              input: { title: "Anonymous creation" },
              options: {},
              code: "UNAUTHENTICATED",
            },
            {
              session: sessions.ada,
              input: { title: " \t\n " },
              options: {},
              code: "BAD_USER_INPUT",
            },
            {
              session: sessions.ada,
              input: { title: "a".repeat(201) },
              options: {},
              code: "BAD_USER_INPUT",
            },
            {
              session: sessions.ada,
              input: { title: "Missing request header" },
              options: { authHeader: "" },
              code: "FORBIDDEN",
            },
            {
              session: sessions.ada,
              input: { title: "Disallowed origin" },
              options: { origin: "https://untrusted.example" },
              code: "FORBIDDEN",
            },
          ];

          for (const scenario of scenarios) {
            const before = await posts.countDocuments();

            const result = await execute(
              scenario.session,
              scenario.input,
              scenario.options,
            );

            assert.equal(result.data?.createDraft, null);
            assert.equal(result.errors?.length, 1);
            assert.equal(result.errors?.[0]?.extensions.code, scenario.code);
            assert.deepEqual(result.errors?.[0]?.path, ["createDraft"]);
            assert.equal(await posts.countDocuments(), before);
          }
        },
      );

      await t.test(
        "rejects ownership, status, and ID input fields",
        async () => {
          for (const extra of [
            { authorId: "grace" },
            { status: "published" },
            { id: "client-selected-id" },
          ]) {
            const before = await posts.countDocuments();

            const result = await execute(sessions.ada, {
              title: "Attempted field override",
              ...extra,
            });

            // INVALID VARIABLES ARE REJECTED BEFORE RESOLVER EXECUTION.
            assert.ok(result.errors?.length);
            assert.equal(result.data, undefined);
            assert.equal(await posts.countDocuments(), before);
          }
        },
      );

      await t.test(
        "new drafts remain visible only to their author and admins",
        async () => {
          const title = `Visibility ${randomUUID()}`;

          const created = await execute(sessions.ada, { title });
          assert.equal(created.errors, undefined);

          const stored = await posts.findOne({ title });
          assert.ok(stored);

          const source = /* GraphQL */ `
            query {
              posts(first: 20) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          `;

          for (const scenario of [
            { session: null, visible: false },
            { session: sessions.grace, visible: false },
            { session: sessions.ada, visible: true },
            { session: sessions.admin, visible: true },
          ]) {
            const result = await execute(scenario.session, {}, { source });

            assert.equal(result.errors, undefined);
            assert.ok(result.data);

            assert.equal(
              JSON.stringify(result.data).includes(stored._id),
              scenario.visible,
            );
          }
        },
      );

      await t.test(
        "reports authentication and write failures without inserting",
        async () => {
          const unavailableClient = new MongoClient(url);
          const unavailableDatabase = unavailableClient.db(
            database.databaseName,
          );
          await unavailableClient.close();

          const scenarios = [
            {
              options: { authenticationDatabase: unavailableDatabase },
              message: "Authentication temporarily unavailable",
            },
            {
              options: { database: unavailableDatabase },
              message: "Draft creation temporarily unavailable",
            },
          ];

          for (const scenario of scenarios) {
            const before = await posts.countDocuments();

            const result = await execute(
              sessions.ada,
              { title: "Unavailable storage" },
              scenario.options,
            );

            assert.equal(result.data?.createDraft, null);
            assert.equal(result.errors?.length, 1);
            assert.equal(
              result.errors?.[0]?.extensions.code,
              "SERVICE_UNAVAILABLE",
            );
            assert.equal(result.errors?.[0]?.message, scenario.message);
            assert.equal(await posts.countDocuments(), before);
          }
        },
      );
    });
  } finally {
    try {
      // REMOVE ONLY THIS TEST'S UNIQUELY NAMED DATABASE.
      await database.dropDatabase();
    } finally {
      await client.close();
    }
  }
});

/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Service: author edits own draft or published post | Normalizes and updates only the title |
 * | Service: admin edits another author's draft or published post | Updates title while preserving ownership, ID, and status |
 * | Service: anonymous edit | Throws PostAuthenticationRequiredError; all posts unchanged |
 * | Service: non-author edit | Throws PostNotFoundError for draft and published posts; all posts unchanged |
 * | Service: missing or inaccessible post | Returns the same Post not found error; all posts unchanged |
 * | Service: invalid title or post ID | Throws the corresponding validation error; all posts unchanged |
 * | Service: extra protected input properties | Changes only title; ignores replacement ID, author, and status |
 * | Service: existing title submitted again | Succeeds with the unchanged post |
 * | Service: storage unavailable | Propagates failure; all posts unchanged |
 * | GraphQL: author or admin edits authorized draft or published post | Returns normalized title and resolved author; preserves ownership and status |
 * | GraphQL: anonymous edit | Returns UNAUTHENTICATED; all posts unchanged |
 * | GraphQL: missing or inaccessible post | Returns identical NOT_FOUND errors; all posts unchanged |
 * | GraphQL: invalid title or empty ID | Returns BAD_USER_INPUT; all posts unchanged |
 * | GraphQL: missing custom header or untrusted origin | Returns FORBIDDEN; all posts unchanged |
 * | GraphQL: protected input fields | Rejects variables before resolver execution; all posts unchanged |
 * | GraphQL: authentication or update storage fails | Returns generic SERVICE_UNAVAILABLE; all posts unchanged |
 *
 * Reading guide:
 * - Direct service tests check ownership and title-only updates; GraphQL tests check public errors.
 * - Full collection snapshots prove rejected edits changed no post, not just the target title.
 * - Missing and inaccessible posts share an error to avoid revealing protected records.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { updatePostTitle } from "../../src/posts/service.js";
import {
  InvalidPostIdError,
  InvalidPostTitleError,
  PostAuthenticationRequiredError,
  PostNotFoundError,
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

test("post title editing service", async (t) => {
  const url = process.env.TEST_MONGO_URL;
  const configuredDatabase = process.env.TEST_MONGO_DB;

  if (!url || configuredDatabase !== "graphql_engineering_lab_test") {
    throw new Error("Dedicated integration-test database is required");
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 3000,
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const database = client.db(`graphql_lab_test_edit_${suffix}`);
  const posts = database.collection<PostDocument>("posts");

  const ada: Actor = { userId: "ada", role: "user" };
  const grace: Actor = { userId: "grace", role: "user" };
  const admin: Actor = { userId: "admin", role: "admin" };

  const fixtures: PostDocument[] = [
    {
      _id: "ada-draft",
      title: "Ada draft",
      authorId: "ada",
      status: "draft",
    },
    {
      _id: "ada-published",
      title: "Ada published",
      authorId: "ada",
      status: "published",
    },
    {
      _id: "grace-draft",
      title: "Grace draft",
      authorId: "grace",
      status: "draft",
    },
    {
      _id: "grace-published",
      title: "Grace published",
      authorId: "grace",
      status: "published",
    },
  ];

  // Sort snapshots so equality detects document changes rather than collection iteration order.
  const snapshot = (): Promise<PostDocument[]> =>
    posts.find({}).sort({ _id: 1 }).toArray();

  try {
    await client.connect();
    await posts.insertMany(fixtures);

    await t.test("authors edit their draft and published titles", async () => {
      for (const id of ["ada-draft", "ada-published"]) {
        const before = await posts.findOne({ _id: id });
        assert.ok(before);

        const updated = await updatePostTitle(database, ada, id, {
          title: "  Updated  title  ",
        });

        assert.deepEqual(updated, {
          ...before,
          title: "Updated  title",
        });

        assert.deepEqual(await posts.findOne({ _id: id }), updated);
      }
    });

    await t.test(
      "admins edit another author's posts without changing ownership or status",
      async () => {
        for (const id of ["grace-draft", "grace-published"]) {
          const before = await posts.findOne({ _id: id });
          assert.ok(before);

          const updated = await updatePostTitle(database, admin, id, {
            title: "Admin edited this title",
          });

          assert.deepEqual(updated, {
            ...before,
            title: "Admin edited this title",
          });

          assert.deepEqual(await posts.findOne({ _id: id }), updated);
        }
      },
    );

    await t.test("anonymous edits leave all posts unchanged", async () => {
      const before = await snapshot();

      await assert.rejects(
        updatePostTitle(database, null, "ada-draft", {
          title: "Anonymous edit",
        }),
        PostAuthenticationRequiredError,
      );

      assert.deepEqual(await snapshot(), before);
    });

    await t.test(
      "non-authors cannot edit draft or published posts",
      async () => {
        const before = await snapshot();

        for (const id of ["ada-draft", "ada-published"]) {
          await assert.rejects(
            updatePostTitle(database, grace, id, {
              title: "Unauthorized edit",
            }),
            PostNotFoundError,
          );
        }

        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "missing and inaccessible posts produce the same error",
      async () => {
        const before = await snapshot();

        for (const id of ["missing-post", "grace-draft"]) {
          await assert.rejects(
            updatePostTitle(database, ada, id, {
              title: "Attempted edit",
            }),
            (error: unknown) => {
              assert.ok(error instanceof PostNotFoundError);
              assert.equal(error.message, "Post not found");
              return true;
            },
          );
        }

        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test("invalid titles leave posts unchanged", async () => {
      const before = await snapshot();

      for (const title of ["", " \t\n ", "a".repeat(201)]) {
        await assert.rejects(
          updatePostTitle(database, ada, "ada-draft", { title }),
          InvalidPostTitleError,
        );
      }

      assert.deepEqual(await snapshot(), before);
    });

    await t.test("invalid IDs leave posts unchanged", async () => {
      const before = await snapshot();

      for (const id of ["", "a".repeat(257)]) {
        await assert.rejects(
          updatePostTitle(database, ada, id, {
            title: "Valid title",
          }),
          InvalidPostIdError,
        );
      }

      assert.deepEqual(await snapshot(), before);
    });

    await t.test(
      "extra input properties cannot change protected fields",
      async () => {
        const before = await posts.findOne({ _id: "ada-draft" });
        assert.ok(before);

        const input = {
          title: "Only the title changes",
          _id: "replacement-id",
          authorId: "grace",
          status: "published",
        };

        const updated = await updatePostTitle(
          database,
          ada,
          "ada-draft",
          input,
        );

        assert.deepEqual(updated, {
          ...before,
          title: input.title,
        });

        assert.deepEqual(await posts.findOne({ _id: "ada-draft" }), updated);

        assert.equal(await posts.findOne({ _id: input._id }), null);
      },
    );

    await t.test("setting the existing title still succeeds", async () => {
      const before = await posts.findOne({ _id: "ada-draft" });
      assert.ok(before);

      const updated = await updatePostTitle(database, ada, before._id, {
        title: before.title,
      });

      assert.deepEqual(updated, before);
      assert.deepEqual(await posts.findOne({ _id: before._id }), before);
    });

    await t.test(
      "propagates storage failure without changing posts",
      async () => {
        const before = await snapshot();

        const unavailableClient = new MongoClient(url);
        const unavailableDatabase = unavailableClient.db(database.databaseName);
        await unavailableClient.close();

        await assert.rejects(
          updatePostTitle(unavailableDatabase, ada, "ada-draft", {
            title: "Unavailable storage",
          }),
        );

        assert.deepEqual(await snapshot(), before);
      },
    );
    await t.test("GraphQL post editing", async (t) => {
      const password = await hashPassword("GraphQL editing fixture password!");

      await database.collection<UserDocument>("users").insertMany([
        { _id: "ada", name: "Ada" },
        { _id: "grace", name: "Grace" },
        { _id: "admin", name: "Admin" },
      ]);

      await database.collection<AccountDocument>("accounts").insertMany([
        { _id: "ada", username: "ada", role: "user", password },
        { _id: "admin", username: "admin", role: "admin", password },
      ]);

      const sessions = {
        ada: await createSession(database, "ada"),
        admin: await createSession(database, "admin"),
      };

      const mutation = /* GraphQL */ `
        mutation UpdatePost($id: ID!, $input: UpdatePostInput!) {
          updatePost(id: $id, input: $input) {
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
      }

      async function executeUpdate(
        session: CreatedSession | null,
        id: string,
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
          throw new Error("Post editing invoked a login or cookie helper");
        };

        const context: GraphQLContext = {
          requestId: randomUUID(),
          database: requestDatabase,
          logDatabaseCall: () => {},
          userLoader: createUserLoader(
            requestDatabase,
            () => {},
            "update-post-test",
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
          source: mutation,
          variableValues: { id, input },
          contextValue: context,
        });
      }

      await t.test(
        "authors and admins edit draft and published titles",
        async () => {
          const scenarios = [
            {
              session: sessions.ada,
              ids: ["ada-draft", "ada-published"],
              authorId: "ada",
              authorName: "Ada",
            },
            {
              session: sessions.admin,
              ids: ["grace-draft", "grace-published"],
              authorId: "grace",
              authorName: "Grace",
            },
          ];

          for (const scenario of scenarios) {
            for (const id of scenario.ids) {
              const before = await posts.findOne({ _id: id });
              assert.ok(before);

              const title = `Edited through GraphQL: ${id}`;

              const result = await executeUpdate(scenario.session, id, {
                title: `  ${title}  `,
              });

              assert.equal(result.errors, undefined);
              assert.equal(
                JSON.stringify(result.data),
                JSON.stringify({
                  updatePost: {
                    id,
                    title,
                    status: before.status === "draft" ? "DRAFT" : "PUBLISHED",
                    author: {
                      id: scenario.authorId,
                      name: scenario.authorName,
                    },
                  },
                }),
              );

              // OWNERSHIP AND STATUS MUST SURVIVE THE UPDATE.
              assert.deepEqual(await posts.findOne({ _id: id }), {
                ...before,
                title,
              });
            }
          }
        },
      );

      await t.test("rejected edits leave all posts unchanged", async () => {
        const scenarios = [
          {
            session: null,
            id: "ada-draft",
            title: "Anonymous edit",
            options: {},
            code: "UNAUTHENTICATED",
          },
          {
            session: sessions.ada,
            id: "grace-draft",
            title: "Unauthorized draft edit",
            options: {},
            code: "NOT_FOUND",
          },
          {
            session: sessions.ada,
            id: "grace-published",
            title: "Unauthorized published edit",
            options: {},
            code: "NOT_FOUND",
          },
          {
            session: sessions.ada,
            id: "missing-post",
            title: "Missing post edit",
            options: {},
            code: "NOT_FOUND",
          },
          {
            session: sessions.ada,
            id: "ada-draft",
            title: " \t\n ",
            options: {},
            code: "BAD_USER_INPUT",
          },
          {
            session: sessions.ada,
            id: "ada-draft",
            title: "a".repeat(201),
            options: {},
            code: "BAD_USER_INPUT",
          },
          {
            session: sessions.ada,
            id: "",
            title: "Valid title",
            options: {},
            code: "BAD_USER_INPUT",
          },
          {
            session: sessions.ada,
            id: "ada-draft",
            title: "Missing header",
            options: { authHeader: "" },
            code: "FORBIDDEN",
          },
          {
            session: sessions.ada,
            id: "ada-draft",
            title: "Untrusted origin",
            options: { origin: "https://untrusted.example" },
            code: "FORBIDDEN",
          },
        ];

        for (const scenario of scenarios) {
          const before = await snapshot();

          const result = await executeUpdate(
            scenario.session,
            scenario.id,
            { title: scenario.title },
            scenario.options,
          );

          assert.equal(result.data?.updatePost, null);
          assert.equal(result.errors?.length, 1);
          assert.equal(result.errors?.[0]?.extensions.code, scenario.code);
          assert.deepEqual(result.errors?.[0]?.path, ["updatePost"]);

          if (scenario.code === "NOT_FOUND") {
            assert.equal(result.errors?.[0]?.message, "Post not found");
          }

          assert.deepEqual(await snapshot(), before);
        }
      });

      await t.test("GraphQL rejects protected input fields", async () => {
        for (const extra of [
          { authorId: "grace" },
          { status: "published" },
          { id: "replacement-id" },
        ]) {
          const before = await snapshot();

          const result = await executeUpdate(sessions.ada, "ada-draft", {
            title: "Attempted override",
            ...extra,
          });

          assert.ok(result.errors?.length);
          assert.equal(result.data, undefined);
          assert.deepEqual(await snapshot(), before);
        }
      });

      await t.test(
        "authentication and update failures return generic errors",
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
              message: "Post update temporarily unavailable",
            },
          ];

          for (const scenario of scenarios) {
            const before = await snapshot();

            const result = await executeUpdate(
              sessions.ada,
              "ada-draft",
              { title: "Unavailable storage" },
              scenario.options,
            );

            assert.equal(result.data?.updatePost, null);
            assert.equal(result.errors?.length, 1);
            assert.equal(
              result.errors?.[0]?.extensions.code,
              "SERVICE_UNAVAILABLE",
            );
            assert.equal(result.errors?.[0]?.message, scenario.message);
            assert.deepEqual(await snapshot(), before);
          }
        },
      );
    });
  } finally {
    try {
      await database.dropDatabase();
    } finally {
      await client.close();
    }
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { findVisiblePost, listVisiblePosts } from "../../src/posts/service.js";
import { InvalidPostIdError } from "../../src/posts/errors.js";
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
import { createUserLoader } from "../../src/loaders.js";

test("single-post visibility service", async (t) => {
  const url = process.env.TEST_MONGO_URL;
  const configuredDatabase = process.env.TEST_MONGO_DB;

  if (!url || configuredDatabase !== "graphql_engineering_lab_test") {
    throw new Error("Dedicated integration-test database is required");
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 3000,
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const database = client.db(`graphql_lab_test_find_${suffix}`);
  const posts = database.collection<PostDocument>("posts");

  const ada: Actor = { userId: "ada", role: "user" };
  const grace: Actor = { userId: "grace", role: "user" };
  const admin: Actor = { userId: "admin", role: "admin" };

  const fixtures: PostDocument[] = [
    {
      _id: "ada-published",
      title: "Ada published",
      authorId: "ada",
      status: "published",
    },
    {
      _id: "ada-draft",
      title: "Ada draft",
      authorId: "ada",
      status: "draft",
    },
    {
      _id: "grace-draft",
      title: "Grace draft",
      authorId: "grace",
      status: "draft",
    },
  ];

  try {
    await client.connect();
    await posts.insertMany(fixtures);

    await t.test("everyone can read published posts", async () => {
      const published = fixtures.find((post) => post._id === "ada-published");
      assert.ok(published);

      for (const actor of [null, ada, grace, admin]) {
        assert.deepEqual(
          await findVisiblePost(database, actor, published._id),
          published,
        );
      }
    });

    await t.test("only the author and admins can read a draft", async () => {
      const scenarios = [
        {
          id: "ada-draft",
          allowed: [ada, admin],
          denied: [null, grace],
        },
        {
          id: "grace-draft",
          allowed: [grace, admin],
          denied: [null, ada],
        },
      ];

      for (const scenario of scenarios) {
        const expected = fixtures.find((post) => post._id === scenario.id);
        assert.ok(expected);

        for (const actor of scenario.allowed) {
          assert.deepEqual(
            await findVisiblePost(database, actor, scenario.id),
            expected,
          );
        }

        for (const actor of scenario.denied) {
          assert.equal(
            await findVisiblePost(database, actor, scenario.id),
            null,
          );
        }
      }
    });

    await t.test(
      "missing and inaccessible posts both return null",
      async () => {
        for (const actor of [null, grace]) {
          assert.equal(
            await findVisiblePost(database, actor, "missing-post"),
            null,
          );

          assert.equal(
            await findVisiblePost(database, actor, "ada-draft"),
            null,
          );
        }

        assert.equal(
          await findVisiblePost(database, admin, "missing-post"),
          null,
        );
      },
    );

    await t.test(
      "single-post and list visibility remain consistent",
      async () => {
        for (const actor of [null, ada, grace, admin]) {
          const page = await listVisiblePosts(database, actor, {
            pageSize: 20,
            afterId: null,
          });

          const listedIds = new Set(page.posts.map((post) => post._id));

          for (const fixture of fixtures) {
            const found = await findVisiblePost(database, actor, fixture._id);

            assert.equal(found !== null, listedIds.has(fixture._id));
          }
        }
      },
    );

    await t.test("rejects invalid IDs", async () => {
      for (const id of ["", "a".repeat(257)]) {
        await assert.rejects(
          findVisiblePost(database, ada, id),
          InvalidPostIdError,
        );
      }
    });

    await t.test("does not trim IDs into a different lookup", async () => {
      assert.equal(
        await findVisiblePost(database, admin, " ada-published "),
        null,
      );
    });

    await t.test(
      "propagates database failure instead of returning null",
      async () => {
        const unavailableClient = new MongoClient(url);
        const unavailableDatabase = unavailableClient.db(database.databaseName);
        await unavailableClient.close();

        await assert.rejects(
          findVisiblePost(unavailableDatabase, null, "ada-published"),
        );
      },
    );
    await t.test("GraphQL single-post lookup", async (t) => {
      const password = await hashPassword("Single post fixture password!");

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

      const source = `
    query FindPost($id: ID!) {
      hello
      post(id: $id) {
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
        database?: GraphQLContext["database"];
        authenticationDatabase?: GraphQLContext["database"];
      }

      async function executePost(
        session: CreatedSession | null,
        id: string,
        options: RequestOptions = {},
      ) {
        const requestDatabase = options.database ?? database;
        const authenticationDatabase =
          options.authenticationDatabase ?? database;

        const token = readSessionCookie(
          session ? `session=${session.token}` : undefined,
        );

        const unexpectedCall = (): never => {
          throw new Error("Post query invoked a mutation helper");
        };

        const context: GraphQLContext = {
          requestId: randomUUID(),
          database: requestDatabase,
          logDatabaseCall: () => {},
          userLoader: createUserLoader(
            requestDatabase,
            () => {},
            "find-post-test",
          ),
          sessionToken: token,
          getActor: createRequestActor(() =>
            resolveSession(authenticationDatabase, token),
          ),
          verifyCredentials: async () => unexpectedCall(),
          beginLogin: unexpectedCall,
          assertAuthRequest: unexpectedCall,
          setSessionCookie: unexpectedCall,
          clearSessionCookie: unexpectedCall,
        };

        return graphql({
          schema,
          rootValue,
          source,
          variableValues: { id },
          contextValue: context,
        });
      }

      await t.test(
        "returns authorized posts with status and author",
        async () => {
          const callers = [
            {
              session: null,
              visibleIds: ["ada-published"],
            },
            {
              session: sessions.ada,
              visibleIds: ["ada-published", "ada-draft"],
            },
            {
              session: sessions.grace,
              visibleIds: ["ada-published", "grace-draft"],
            },
            {
              session: sessions.admin,
              visibleIds: fixtures.map((post) => post._id),
            },
          ];

          for (const caller of callers) {
            for (const fixture of fixtures) {
              const result = await executePost(caller.session, fixture._id);

              assert.equal(result.errors, undefined);

              if (!caller.visibleIds.includes(fixture._id)) {
                assert.equal(result.data?.post, null);
                continue;
              }

              assert.equal(
                JSON.stringify(result.data?.post),
                JSON.stringify({
                  id: fixture._id,
                  title: fixture.title,
                  status: fixture.status === "draft" ? "DRAFT" : "PUBLISHED",
                  author: {
                    id: fixture.authorId,
                    name: fixture.authorId === "ada" ? "Ada" : "Grace",
                  },
                }),
              );
            }
          }
        },
      );

      await t.test(
        "missing and inaccessible posts have identical responses",
        async () => {
          for (const session of [null, sessions.grace]) {
            const missing = await executePost(session, "missing-post");
            const inaccessible = await executePost(session, "ada-draft");

            assert.equal(missing.errors, undefined);
            assert.equal(inaccessible.errors, undefined);
            assert.equal(missing.data?.post, null);
            assert.equal(inaccessible.data?.post, null);

            assert.equal(
              JSON.stringify(missing.data),
              JSON.stringify(inaccessible.data),
            );
          }
        },
      );

      await t.test(
        "invalid IDs return BAD_USER_INPUT at the post field",
        async () => {
          for (const id of ["", "a".repeat(257)]) {
            const result = await executePost(null, id);

            assert.equal(result.data?.post, null);
            assert.equal(result.errors?.length, 1);
            assert.equal(result.errors?.[0]?.extensions.code, "BAD_USER_INPUT");
            assert.deepEqual(result.errors?.[0]?.path, ["post"]);

            assert.equal(
              result.data?.hello,
              "Hello from GraphQL Engineering Lab",
            );
          }
        },
      );

      await t.test(
        "authentication and post-storage failures preserve partial data",
        async () => {
          const unavailableClient = new MongoClient(url);
          const unavailableDatabase = unavailableClient.db(
            database.databaseName,
          );
          await unavailableClient.close();

          const scenarios = [
            {
              session: sessions.ada,
              options: {
                authenticationDatabase: unavailableDatabase,
              },
              message: "Authentication temporarily unavailable",
            },
            {
              session: null,
              options: {
                database: unavailableDatabase,
              },
              message: "Post temporarily unavailable",
            },
          ];

          for (const scenario of scenarios) {
            const result = await executePost(
              scenario.session,
              "ada-published",
              scenario.options,
            );

            assert.equal(result.data?.post, null);
            assert.equal(result.errors?.length, 1);
            assert.equal(
              result.errors?.[0]?.extensions.code,
              "SERVICE_UNAVAILABLE",
            );
            assert.equal(result.errors?.[0]?.message, scenario.message);
            assert.deepEqual(result.errors?.[0]?.path, ["post"]);

            assert.equal(
              result.data?.hello,
              "Hello from GraphQL Engineering Lab",
            );
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

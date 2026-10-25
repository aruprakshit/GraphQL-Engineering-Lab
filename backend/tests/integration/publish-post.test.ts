/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Service: author or admin publishes a draft | Changes only status to published and persists the result |
 * | Service: anonymous publication | Throws PostAuthenticationRequiredError; posts unchanged |
 * | Service: non-author targets a draft or published post | Throws the same PostNotFoundError without exposing publication state; posts unchanged |
 * | Service: missing post | Throws the same Post not found error; posts unchanged |
 * | Service: author or admin repeats publication | Throws PostPublicationConflictError; posts unchanged |
 * | Service: empty or oversized ID | Throws InvalidPostIdError; posts unchanged |
 * | Service: concurrent author and admin publication | Exactly one success and one conflict; stored post is published |
 * | Service: anonymous visibility before and after publication | Draft is hidden before publication and visible afterward |
 * | Service: storage unavailable | Propagates failure; posts unchanged |
 * | GraphQL: author or admin publishes a draft | Returns original author and title; persists published status |
 * | GraphQL: repeated publication by author or admin | Returns CONFLICT with Post is no longer a draft; posts unchanged |
 * | GraphQL: anonymous publication | Returns UNAUTHENTICATED; posts unchanged |
 * | GraphQL: missing or inaccessible post | Returns identical NOT_FOUND errors; posts unchanged |
 * | GraphQL: empty or oversized ID | Returns BAD_USER_INPUT; posts unchanged |
 * | GraphQL: missing custom header or untrusted origin | Returns FORBIDDEN; posts unchanged |
 * | GraphQL: concurrent publication requests | Exactly one success and one CONFLICT; stored post is published |
 * | GraphQL: anonymous query before and after publication | Hides the draft before publication and includes it afterward |
 * | GraphQL: authentication or write storage fails | Returns generic SERVICE_UNAVAILABLE; posts unchanged |
 *
 * Reading guide:
 * - Publication changes draft to published; repeating it is a conflict, not an idempotent success.
 * - Concurrent calls must yield exactly one successful state transition.
 * - Service and GraphQL cases separately verify authorization, visibility, and sanitized failures.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { listVisiblePosts, publishPost } from "../../src/posts/service.js";
import {
  InvalidPostIdError,
  PostAuthenticationRequiredError,
  PostNotFoundError,
  PostPublicationConflictError,
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
import { createTestProfileLoader } from "../helpers/profile-loader.js";

// Purpose: Compare direct service transitions with GraphQL behavior and concurrent requests.
test("post publication service", async (t) => {
  const url = process.env.TEST_MONGO_URL;
  const configuredDatabase = process.env.TEST_MONGO_DB;

  if (!url || configuredDatabase !== "graphql_engineering_lab_test") {
    throw new Error("Dedicated integration-test database is required");
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 3000,
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const database = client.db(`graphql_lab_test_publish_${suffix}`);
  const posts = database.collection<PostDocument>("posts");

  const ada: Actor = { userId: "ada", role: "user" };
  const grace: Actor = { userId: "grace", role: "user" };
  const admin: Actor = { userId: "admin", role: "admin" };

  async function insertPost(
    status: PostDocument["status"] = "draft",
  ): Promise<PostDocument> {
    const post: PostDocument = {
      _id: randomUUID(),
      title: "Publication fixture",
      authorId: ada.userId,
      status,
    };

    await posts.insertOne(post);
    return post;
  }

  // Compare complete sorted documents to catch unintended title, owner, or status changes.
  const snapshot = (): Promise<PostDocument[]> =>
    posts.find({}).sort({ _id: 1 }).toArray();

  try {
    await client.connect();

    // Purpose: Persist the state transition while retaining the original identity, title, and author.
    await t.test(
      "authors and admins publish drafts without changing other fields",
      async () => {
        for (const actor of [ada, admin]) {
          const before = await insertPost();

          const published = await publishPost(database, actor, before._id);

          assert.deepEqual(published, {
            ...before,
            status: "published",
          });

          assert.deepEqual(await posts.findOne({ _id: before._id }), published);
        }
      },
    );

    // Purpose: Anonymous callers must not cause any state transition.
    await t.test("anonymous publication leaves posts unchanged", async () => {
      const draft = await insertPost();
      const before = await snapshot();

      await assert.rejects(
        publishPost(database, null, draft._id),
        PostAuthenticationRequiredError,
      );

      assert.deepEqual(await snapshot(), before);
    });

    // Purpose: Unauthorized callers must not learn whether another author's post is already published.
    await t.test(
      "non-authors cannot publish drafts or inspect publication state",
      async () => {
        for (const status of ["draft", "published"] as const) {
          const post = await insertPost(status);
          const before = await snapshot();

          await assert.rejects(
            publishPost(database, grace, post._id),
            (error: unknown) => {
              assert.ok(error instanceof PostNotFoundError);
              assert.equal(error.message, "Post not found");
              return true;
            },
          );

          assert.deepEqual(await snapshot(), before);
        }
      },
    );

    // Purpose: A nonexistent ID must be indistinguishable from an inaccessible post.
    await t.test("missing posts produce the same not-found error", async () => {
      const before = await snapshot();

      await assert.rejects(
        publishPost(database, ada, "missing-post"),
        (error: unknown) => {
          assert.ok(error instanceof PostNotFoundError);
          assert.equal(error.message, "Post not found");
          return true;
        },
      );

      assert.deepEqual(await snapshot(), before);
    });

    // Purpose: Already-published records conflict even when the caller is an admin.
    await t.test(
      "repeated publication conflicts for authors and admins",
      async () => {
        for (const actor of [ada, admin]) {
          const draft = await insertPost();

          await publishPost(database, actor, draft._id);

          const before = await snapshot();

          await assert.rejects(
            publishPost(database, actor, draft._id),
            (error: unknown) => {
              assert.ok(error instanceof PostPublicationConflictError);
              assert.equal(error.message, "Post is no longer a draft");
              return true;
            },
          );

          assert.deepEqual(await snapshot(), before);
        }
      },
    );

    // Purpose: Reject invalid IDs before they can select an unintended record.
    await t.test("invalid IDs cause no changes", async () => {
      const before = await snapshot();

      for (const id of ["", "a".repeat(257)]) {
        await assert.rejects(
          publishPost(database, ada, id),
          InvalidPostIdError,
        );
      }

      assert.deepEqual(await snapshot(), before);
    });

    // Purpose: Start both transitions together; exactly one may change draft to published.
    await t.test(
      "concurrent attempts produce one success and one conflict",
      async () => {
        const draft = await insertPost();

        // START BOTH OPERATIONS WITHOUT AWAITING THE FIRST.
        // Collect both outcomes because one conflict is expected; neither operation waits for the other.
        const results = await Promise.allSettled([
          publishPost(database, ada, draft._id),
          publishPost(database, admin, draft._id),
        ]);

        let successes = 0;
        let conflicts = 0;

        for (const result of results) {
          if (result.status === "fulfilled") {
            successes += 1;

            assert.deepEqual(result.value, {
              ...draft,
              status: "published",
            });
          } else {
            conflicts += 1;

            assert.ok(result.reason instanceof PostPublicationConflictError);
          }
        }

        assert.equal(successes, 1);
        assert.equal(conflicts, 1);

        assert.deepEqual(await posts.findOne({ _id: draft._id }), {
          ...draft,
          status: "published",
        });
      },
    );

    // Purpose: Read visibility must change as a consequence of the successful transition.
    await t.test(
      "publication makes the post visible to anonymous callers",
      async () => {
        const draft = await insertPost();

        const before = await listVisiblePosts(database, null, {
          pageSize: 20,
          afterId: null,
        });

        assert.equal(
          before.posts.some((post) => post._id === draft._id),
          false,
        );

        await publishPost(database, ada, draft._id);

        const after = await listVisiblePosts(database, null, {
          pageSize: 20,
          afterId: null,
        });

        assert.equal(
          after.posts.some((post) => post._id === draft._id),
          true,
        );
      },
    );

    // Purpose: An unavailable client must not make publication appear successful.
    await t.test(
      "propagates storage failure without changing posts",
      async () => {
        const draft = await insertPost();
        const before = await snapshot();

        const unavailableClient = new MongoClient(url);
        const unavailableDatabase = unavailableClient.db(database.databaseName);
        await unavailableClient.close();

        await assert.rejects(publishPost(unavailableDatabase, ada, draft._id));

        assert.deepEqual(await snapshot(), before);
      },
    );

    // Purpose: Add session identity, request trust, response authors, and public error codes.
    await t.test("GraphQL publication", async (t) => {
      const password = await hashPassword(
        "GraphQL publication fixture password!",
      );

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
        mutation PublishPost($id: ID!) {
          publishPost(id: $id) {
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
        id: string,
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
          throw new Error("Publication invoked a login or cookie helper");
        };

        const context: GraphQLContext = {
          requestId: randomUUID(),
          database: requestDatabase,
          logDatabaseCall: () => {},
          userLoader: createTestProfileLoader(
            requestDatabase,
            "publish-post-test",
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
          variableValues: { id },
          contextValue: context,
        });
      }

      // Purpose: Publishing as admin must preserve the original author; repetition must conflict.
      await t.test(
        "authors and admins publish with the original author",
        async () => {
          for (const session of [sessions.ada, sessions.admin]) {
            const draft = await insertPost();

            const result = await execute(session, draft._id);

            assert.equal(result.errors, undefined);
            assert.equal(
              JSON.stringify(result.data),
              JSON.stringify({
                publishPost: {
                  id: draft._id,
                  title: draft.title,
                  status: "PUBLISHED",
                  author: { id: "ada", name: "Ada" },
                },
              }),
            );

            assert.deepEqual(await posts.findOne({ _id: draft._id }), {
              ...draft,
              status: "published",
            });

            // REPEATING PUBLICATION MUST CONFLICT, INCLUDING FOR ADMINS.
            const before = await snapshot();
            const repeated = await execute(session, draft._id);

            assert.equal(repeated.data?.publishPost, null);
            assert.equal(repeated.errors?.length, 1);
            assert.equal(repeated.errors?.[0]?.extensions.code, "CONFLICT");
            assert.equal(
              repeated.errors?.[0]?.message,
              "Post is no longer a draft",
            );
            assert.deepEqual(await snapshot(), before);
          }
        },
      );

      // Purpose: Check all denied cases against a full before-and-after snapshot.
      await t.test("rejected publication leaves posts unchanged", async () => {
        const draft = await insertPost();
        const published = await insertPost("published");

        const scenarios = [
          {
            session: null,
            id: draft._id,
            options: {},
            code: "UNAUTHENTICATED",
          },
          {
            session: sessions.grace,
            id: draft._id,
            options: {},
            code: "NOT_FOUND",
          },
          {
            session: sessions.grace,
            id: published._id,
            options: {},
            code: "NOT_FOUND",
          },
          {
            session: sessions.ada,
            id: "missing-post",
            options: {},
            code: "NOT_FOUND",
          },
          {
            session: sessions.ada,
            id: "",
            options: {},
            code: "BAD_USER_INPUT",
          },
          {
            session: sessions.ada,
            id: "a".repeat(257),
            options: {},
            code: "BAD_USER_INPUT",
          },
          {
            session: sessions.ada,
            id: draft._id,
            options: { authHeader: "" },
            code: "FORBIDDEN",
          },
          {
            session: sessions.ada,
            id: draft._id,
            options: { origin: "https://untrusted.example" },
            code: "FORBIDDEN",
          },
        ];

        for (const scenario of scenarios) {
          const before = await snapshot();

          const result = await execute(
            scenario.session,
            scenario.id,
            scenario.options,
          );

          assert.equal(result.data?.publishPost, null);
          assert.equal(result.errors?.length, 1);
          assert.equal(result.errors?.[0]?.extensions.code, scenario.code);
          assert.deepEqual(result.errors?.[0]?.path, ["publishPost"]);

          if (scenario.code === "NOT_FOUND") {
            assert.equal(result.errors?.[0]?.message, "Post not found");
          }

          assert.deepEqual(await snapshot(), before);
        }
      });

      // Purpose: Independent GraphQL contexts must still share the same atomic storage transition.
      await t.test(
        "concurrent GraphQL requests yield one success and one conflict",
        async () => {
          const draft = await insertPost();

          const results = await Promise.all([
            execute(sessions.ada, draft._id),
            execute(sessions.admin, draft._id),
          ]);

          const successful = results.filter(
            (result) => result.errors === undefined,
          );

          const conflicted = results.filter(
            (result) => result.errors?.[0]?.extensions.code === "CONFLICT",
          );

          assert.equal(successful.length, 1);
          assert.equal(conflicted.length, 1);
          assert.equal(conflicted[0]?.data?.publishPost, null);

          assert.deepEqual(await posts.findOne({ _id: draft._id }), {
            ...draft,
            status: "published",
          });
        },
      );

      // Purpose: Use an anonymous query to prove published content becomes publicly readable.
      await t.test(
        "published posts become visible through anonymous GraphQL queries",
        async () => {
          const draft = await insertPost();

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

          const before = await execute(null, draft._id, { source });

          assert.equal(before.errors, undefined);
          assert.ok(before.data);
          assert.equal(JSON.stringify(before.data).includes(draft._id), false);

          const publication = await execute(sessions.ada, draft._id);
          assert.equal(publication.errors, undefined);

          const after = await execute(null, draft._id, { source });

          assert.equal(after.errors, undefined);
          assert.ok(after.data);
          assert.equal(JSON.stringify(after.data).includes(draft._id), true);
        },
      );

      // Purpose: Separate authentication and post-write failures while preserving every document.
      await t.test(
        "authentication and write failures return generic errors",
        async () => {
          const draft = await insertPost();

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
              message: "Post publication temporarily unavailable",
            },
          ];

          for (const scenario of scenarios) {
            const before = await snapshot();

            const result = await execute(
              sessions.ada,
              draft._id,
              scenario.options,
            );

            assert.equal(result.data?.publishPost, null);
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

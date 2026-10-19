/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Service: anonymous caller | Returns only published posts |
 * | Service: signed-in author | Returns published posts and only that author's drafts |
 * | Service: admin caller | Returns every post |
 * | Hidden drafts before or after visible posts | Do not consume page slots or imply another visible page |
 * | Pagination for an author | Returns consecutive pages from the authorized set with correct hasNextPage |
 * | Cursor points to a hidden draft | Uses its position without granting access to hidden posts |
 * | Cursor follows the last visible post | Returns an empty page with hasNextPage: false |
 * | Invalid page size or cursor boundary from a direct service caller | Rejects invalid arguments |
 * | GraphQL: anonymous, author, and admin sessions | Returns authorized posts with matching author names, encoded cursors, and pageInfo |
 * | GraphQL: author requests consecutive pages | Preserves encoded cursors and correct pageInfo across authorized pages |
 * | GraphQL: authentication storage fails | Returns generic SERVICE_UNAVAILABLE at posts and data: null; no anonymous fallback |
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import type { PostDocument, UserDocument } from "../../src/models.js";
import type { Actor } from "../../src/auth/models.js";
import { listVisiblePosts } from "../../src/posts/service.js";
import { graphql } from "graphql";
import { schema } from "../../src/graphql.js";
import { rootValue } from "../../src/resolvers/index.js";
import type { GraphQLContext } from "../../src/graphql-context.js";
import type { AccountDocument, CreatedSession } from "../../src/auth/models.js";
import { hashPassword } from "../../src/auth/passwords.js";
import { createSession, resolveSession } from "../../src/auth/sessions.js";
import { readSessionCookie } from "../../src/auth/session-cookie.js";
import { createRequestActor } from "../../src/auth/request-actor.js";
import { createUserLoader } from "../../src/loaders.js";
import { encodePostCursor } from "../../src/pagination.js";
import { InvalidPostStatusError } from "../../src/posts/errors.js";
import type { ListPostsOptions } from "../../src/posts/service.js";

test("post service visibility and pagination", async (t) => {
  const url = process.env.TEST_MONGO_URL;
  const configuredDatabase = process.env.TEST_MONGO_DB;

  if (!url || configuredDatabase !== "graphql_engineering_lab_test") {
    throw new Error("Dedicated integration-test database is required");
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 3000,
  });

  // OWN THIS DATABASE SO OTHER FIXTURES CANNOT AFFECT PAGINATION.
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const databaseName = `${configuredDatabase}_posts_${suffix}`;

  const database = client.db(databaseName);

  const ada: Actor = { userId: "ada", role: "user" };
  const grace: Actor = { userId: "grace", role: "user" };
  const admin: Actor = { userId: "admin", role: "admin" };

  const fixtures: PostDocument[] = [
    {
      _id: "post-01",
      title: "Published by Grace",
      authorId: "grace",
      status: "published",
    },
    {
      _id: "post-02",
      title: "Grace draft",
      authorId: "grace",
      status: "draft",
    },
    {
      _id: "post-03",
      title: "Ada draft",
      authorId: "ada",
      status: "draft",
    },
    {
      _id: "post-04",
      title: "Published by Ada",
      authorId: "ada",
      status: "published",
    },
    {
      _id: "post-05",
      title: "Another Grace draft",
      authorId: "grace",
      status: "draft",
    },
    {
      _id: "post-06",
      title: "Another Ada draft",
      authorId: "ada",
      status: "draft",
    },
  ];

  try {
    await client.connect();
    await database.collection<PostDocument>("posts").insertMany(fixtures);

    await t.test("anonymous callers see only published posts", async () => {
      const result = await listVisiblePosts(database, null, {
        pageSize: 20,
        afterId: null,
      });

      assert.deepEqual(
        result.posts.map((post) => post._id),
        ["post-01", "post-04"],
      );
      assert.equal(result.hasNextPage, false);
    });

    await t.test(
      "users see published posts and only their own drafts",
      async () => {
        const scenarios = [
          {
            actor: ada,
            expected: ["post-01", "post-03", "post-04", "post-06"],
          },
          {
            actor: grace,
            expected: ["post-01", "post-02", "post-04", "post-05"],
          },
        ];

        for (const { actor, expected } of scenarios) {
          const result = await listVisiblePosts(database, actor, {
            pageSize: 20,
            afterId: null,
          });

          assert.deepEqual(
            result.posts.map((post) => post._id),
            expected,
          );
          assert.equal(result.hasNextPage, false);
        }
      },
    );

    await t.test("admins see every post", async () => {
      const result = await listVisiblePosts(database, admin, {
        pageSize: 20,
        afterId: null,
      });

      assert.deepEqual(
        result.posts.map((post) => post._id),
        fixtures.map((post) => post._id),
      );
      assert.equal(result.hasNextPage, false);
    });

    await t.test(
      "hidden drafts do not consume page slots or imply another page",
      async () => {
        const result = await listVisiblePosts(database, null, {
          pageSize: 2,
          afterId: null,
        });

        assert.deepEqual(
          result.posts.map((post) => post._id),
          ["post-01", "post-04"],
        );

        // DRAFTS EXIST AFTER POST-04, BUT NONE ARE VISIBLE.
        assert.equal(result.hasNextPage, false);
      },
    );

    await t.test("paginates through the visible set", async () => {
      const first = await listVisiblePosts(database, ada, {
        pageSize: 2,
        afterId: null,
      });

      assert.deepEqual(
        first.posts.map((post) => post._id),
        ["post-01", "post-03"],
      );
      assert.equal(first.hasNextPage, true);

      const second = await listVisiblePosts(database, ada, {
        pageSize: 2,
        afterId: "post-03",
      });

      assert.deepEqual(
        second.posts.map((post) => post._id),
        ["post-04", "post-06"],
      );
      assert.equal(second.hasNextPage, false);
    });

    await t.test(
      "a cursor is a position, not permission to read a draft",
      async () => {
        const result = await listVisiblePosts(database, null, {
          pageSize: 2,
          afterId: "post-02",
        });

        assert.deepEqual(
          result.posts.map((post) => post._id),
          ["post-04"],
        );
        assert.equal(result.hasNextPage, false);
      },
    );

    await t.test(
      "returns an empty final page after the last visible post",
      async () => {
        const result = await listVisiblePosts(database, null, {
          pageSize: 2,
          afterId: "post-04",
        });

        assert.deepEqual(result.posts, []);
        assert.equal(result.hasNextPage, false);
      },
    );

    await t.test("enforces pagination limits for direct callers", async () => {
      for (const pageSize of [0, -1, 21, 1.5, Number.NaN]) {
        await assert.rejects(
          listVisiblePosts(database, ada, {
            pageSize,
            afterId: null,
          }),
          /pageSize must be an integer/,
        );
      }

      for (const afterId of ["", "a".repeat(257)]) {
        await assert.rejects(
          listVisiblePosts(database, ada, {
            pageSize: 2,
            afterId,
          }),
          /Invalid post cursor boundary/,
        );
      }
    });

    await t.test(
      "GraphQL applies session identity and post visibility",
      async (t) => {
        const password = await hashPassword(
          "Post visibility fixture password!",
        );

        await database.collection<UserDocument>("users").insertMany([
          { _id: "ada", name: "Ada" },
          { _id: "grace", name: "Grace" },
          { _id: "admin", name: "Admin" },
        ]);

        await database.collection<AccountDocument>("accounts").insertMany([
          {
            _id: "ada",
            username: "ada",
            role: "user",
            password,
          },
          {
            _id: "grace",
            username: "grace",
            role: "user",
            password,
          },
          {
            _id: "admin",
            username: "admin",
            role: "admin",
            password,
          },
        ]);

        const sessions = {
          ada: await createSession(database, "ada"),
          grace: await createSession(database, "grace"),
          admin: await createSession(database, "admin"),
        };

        const source = /* GraphQL */ `
          query VisiblePosts($first: Int!, $after: String) {
            posts(first: $first, after: $after) {
              edges {
                cursor
                node {
                  id
                  author {
                    name
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `;

        async function executePosts(
          session: CreatedSession | null,
          first = 20,
          after: string | null = null,
          authenticationDatabase = database,
          options: {
            source?: string;
            variables?: Record<string, unknown>;
          } = {},
        ) {
          const cookie = session ? `session=${session.token}` : undefined;
          const token = readSessionCookie(cookie);

          const unexpectedCall = (): never => {
            throw new Error("Posts query invoked a mutation helper");
          };

          const context: GraphQLContext = {
            requestId: randomUUID(),
            database,
            logDatabaseCall: () => {},
            userLoader: createUserLoader(
              database,
              () => {},
              "post-visibility-test",
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
            source: options.source ?? source,
            variableValues: { first, after, ...options.variables },
            contextValue: context,
          });
        }
        const filteredSource = /* GraphQL */ `
          query FilteredPosts(
            $first: Int!
            $after: String
            $status: PostStatus
          ) {
            posts(first: $first, after: $after, status: $status) {
              edges {
                cursor
                node {
                  id
                  status
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `;

        function executeFilteredPosts(
          session: CreatedSession | null,
          status: unknown,
          first = 20,
          after: string | null = null,
        ) {
          return executePosts(session, first, after, database, {
            source: filteredSource,
            variables: status === undefined ? {} : { status },
          });
        }

        function expectedFilteredData(ids: string[], hasNextPage = false) {
          return {
            posts: {
              edges: ids.map((id) => {
                const fixture = fixtures.find((post) => post._id === id);
                assert.ok(fixture);

                return {
                  cursor: encodePostCursor(id),
                  node: {
                    id,
                    status: fixture.status === "draft" ? "DRAFT" : "PUBLISHED",
                  },
                };
              }),
              pageInfo: {
                hasNextPage,
                endCursor: ids.length
                  ? encodePostCursor(ids[ids.length - 1]!)
                  : null,
              },
            },
          };
        }
        await t.test(
          "status filtering preserves authorization and maps enum values",
          async () => {
            const callers = [
              {
                session: null,
                all: ["post-01", "post-04"],
                drafts: [],
              },
              {
                session: sessions.ada,
                all: ["post-01", "post-03", "post-04", "post-06"],
                drafts: ["post-03", "post-06"],
              },
              {
                session: sessions.grace,
                all: ["post-01", "post-02", "post-04", "post-05"],
                drafts: ["post-02", "post-05"],
              },
              {
                session: sessions.admin,
                all: fixtures.map((post) => post._id),
                drafts: ["post-02", "post-03", "post-05", "post-06"],
              },
            ];

            for (const caller of callers) {
              for (const status of [undefined, null, "DRAFT", "PUBLISHED"]) {
                const expectedIds =
                  status === "DRAFT"
                    ? caller.drafts
                    : status === "PUBLISHED"
                      ? ["post-01", "post-04"]
                      : caller.all;

                const result = await executeFilteredPosts(
                  caller.session,
                  status,
                );

                assert.equal(result.errors, undefined);
                assert.equal(
                  JSON.stringify(result.data),
                  JSON.stringify(expectedFilteredData(expectedIds)),
                );
              }
            }
          },
        );

        await t.test(
          "filtered pagination uses only matching visible posts",
          async () => {
            const scenarios = [
              {
                session: sessions.admin,
                status: "DRAFT",
                first: 2,
                after: null,
                ids: ["post-02", "post-03"],
                hasNextPage: true,
              },
              {
                session: sessions.admin,
                status: "DRAFT",
                first: 2,
                after: encodePostCursor("post-03"),
                ids: ["post-05", "post-06"],
                hasNextPage: false,
              },
              {
                session: sessions.admin,
                status: "DRAFT",
                first: 2,
                after: encodePostCursor("post-06"),
                ids: [],
                hasNextPage: false,
              },
              {
                session: sessions.ada,
                status: "DRAFT",
                first: 1,
                after: encodePostCursor("post-03"),
                ids: ["post-06"],
                hasNextPage: false,
              },
              {
                session: null,
                status: "PUBLISHED",
                first: 1,
                after: null,
                ids: ["post-01"],
                hasNextPage: true,
              },
              {
                session: null,
                status: "PUBLISHED",
                first: 1,
                after: encodePostCursor("post-01"),
                ids: ["post-04"],
                hasNextPage: false,
              },
            ];

            for (const scenario of scenarios) {
              const result = await executeFilteredPosts(
                scenario.session,
                scenario.status,
                scenario.first,
                scenario.after,
              );

              assert.equal(result.errors, undefined);
              assert.equal(
                JSON.stringify(result.data),
                JSON.stringify(
                  expectedFilteredData(scenario.ids, scenario.hasNextPage),
                ),
              );
            }
          },
        );

        await t.test(
          "GraphQL rejects invalid enum input before execution",
          async () => {
            for (const status of ["draft", "ARCHIVED", "", 123]) {
              const result = await executeFilteredPosts(sessions.admin, status);

              assert.ok(result.errors?.length);
              assert.equal(result.data, undefined);
            }
          },
        );
        await t.test(
          "returns only the posts visible to each caller",
          async () => {
            const scenarios = [
              {
                session: null,
                ids: ["post-01", "post-04"],
                authors: ["Grace", "Ada"],
              },
              {
                session: sessions.ada,
                ids: ["post-01", "post-03", "post-04", "post-06"],
                authors: ["Grace", "Ada", "Ada", "Ada"],
              },
              {
                session: sessions.grace,
                ids: ["post-01", "post-02", "post-04", "post-05"],
                authors: ["Grace", "Grace", "Ada", "Grace"],
              },
              {
                session: sessions.admin,
                ids: fixtures.map((post) => post._id),
                authors: ["Grace", "Grace", "Ada", "Ada", "Grace", "Ada"],
              },
            ];

            for (const scenario of scenarios) {
              const result = await executePosts(scenario.session);

              assert.equal(result.errors, undefined);

              const expectedEdges = scenario.ids.map((id, index) => ({
                cursor: encodePostCursor(id),
                node: {
                  id,
                  author: { name: scenario.authors[index] },
                },
              }));

              assert.equal(
                JSON.stringify(result.data),
                JSON.stringify({
                  posts: {
                    edges: expectedEdges,
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: encodePostCursor(scenario.ids.at(-1)!),
                    },
                  },
                }),
              );
            }
          },
        );

        await t.test("preserves cursors across authorized pages", async () => {
          const expectedPages = [
            {
              after: null,
              ids: ["post-01", "post-03"],
              hasNextPage: true,
            },
            {
              after: encodePostCursor("post-03"),
              ids: ["post-04", "post-06"],
              hasNextPage: false,
            },
          ];

          for (const page of expectedPages) {
            const result = await executePosts(sessions.ada, 2, page.after);

            assert.equal(result.errors, undefined);
            assert.equal(
              JSON.stringify(result.data),
              JSON.stringify({
                posts: {
                  edges: page.ids.map((id) => ({
                    cursor: encodePostCursor(id),
                    node: {
                      id,
                      author: {
                        name: id === "post-01" ? "Grace" : "Ada",
                      },
                    },
                  })),
                  pageInfo: {
                    hasNextPage: page.hasNextPage,
                    endCursor: encodePostCursor(page.ids.at(-1)!),
                  },
                },
              }),
            );
          }
        });

        await t.test(
          "does not fall back to anonymous posts when authentication fails",
          async () => {
            const unavailableClient = new MongoClient(url);
            const unavailableDatabase = unavailableClient.db(databaseName);
            await unavailableClient.close();

            const result = await executePosts(
              sessions.ada,
              20,
              null,
              unavailableDatabase,
            );

            // posts IS NON-NULL, SO ITS ERROR PROPAGATES TO THE ROOT.
            assert.equal(result.data, null);
            assert.equal(result.errors?.length, 1);
            assert.equal(
              result.errors?.[0]?.extensions.code,
              "SERVICE_UNAVAILABLE",
            );
            assert.equal(
              result.errors?.[0]?.message,
              "Authentication temporarily unavailable",
            );
            assert.deepEqual(result.errors?.[0]?.path, ["posts"]);
          },
        );
      },
    );
    await t.test(
      "status filters narrow the authorized result set",
      async () => {
        const scenarios: {
          actor: Actor | null;
          status: PostDocument["status"];
          expected: string[];
        }[] = [
          {
            actor: null,
            status: "draft",
            expected: [],
          },
          {
            actor: null,
            status: "published",
            expected: ["post-01", "post-04"],
          },
          {
            actor: ada,
            status: "draft",
            expected: ["post-03", "post-06"],
          },
          {
            actor: ada,
            status: "published",
            expected: ["post-01", "post-04"],
          },
          {
            actor: grace,
            status: "draft",
            expected: ["post-02", "post-05"],
          },
          {
            actor: grace,
            status: "published",
            expected: ["post-01", "post-04"],
          },
          {
            actor: admin,
            status: "draft",
            expected: ["post-02", "post-03", "post-05", "post-06"],
          },
          {
            actor: admin,
            status: "published",
            expected: ["post-01", "post-04"],
          },
        ];

        for (const { actor, status, expected } of scenarios) {
          const result = await listVisiblePosts(database, actor, {
            pageSize: 20,
            afterId: null,
            status,
          });

          assert.deepEqual(
            result.posts.map((post) => post._id),
            expected,
          );
          assert.equal(result.hasNextPage, false);

          for (const post of result.posts) {
            assert.equal(post.status, status);
          }
        }
      },
    );
    await t.test(
      "omitted and null status preserve unfiltered visibility",
      async () => {
        const scenarios = [
          { actor: null, expected: ["post-01", "post-04"] },
          {
            actor: ada,
            expected: ["post-01", "post-03", "post-04", "post-06"],
          },
          {
            actor: grace,
            expected: ["post-01", "post-02", "post-04", "post-05"],
          },
          {
            actor: admin,
            expected: fixtures.map((post) => post._id),
          },
        ];

        for (const { actor, expected } of scenarios) {
          for (const status of [undefined, null]) {
            const result = await listVisiblePosts(database, actor, {
              pageSize: 20,
              afterId: null,
              status,
            });

            assert.deepEqual(
              result.posts.map((post) => post._id),
              expected,
            );
            assert.equal(result.hasNextPage, false);
          }
        }
      },
    );
    await t.test("paginates only matching authorized drafts", async () => {
      const first = await listVisiblePosts(database, admin, {
        pageSize: 2,
        afterId: null,
        status: "draft",
      });

      assert.deepEqual(
        first.posts.map((post) => post._id),
        ["post-02", "post-03"],
      );
      assert.equal(first.hasNextPage, true);

      const second = await listVisiblePosts(database, admin, {
        pageSize: 2,
        afterId: "post-03",
        status: "draft",
      });

      assert.deepEqual(
        second.posts.map((post) => post._id),
        ["post-05", "post-06"],
      );
      assert.equal(second.hasNextPage, false);

      const end = await listVisiblePosts(database, admin, {
        pageSize: 2,
        afterId: "post-06",
        status: "draft",
      });

      assert.deepEqual(end.posts, []);
      assert.equal(end.hasNextPage, false);

      // GRACE'S POST-05 MUST NOT CONSUME ADA'S PAGE SLOT.
      const adaPage = await listVisiblePosts(database, ada, {
        pageSize: 1,
        afterId: "post-03",
        status: "draft",
      });

      assert.deepEqual(
        adaPage.posts.map((post) => post._id),
        ["post-06"],
      );
      assert.equal(adaPage.hasNextPage, false);
    });
    await t.test(
      "published pagination ignores intervening and trailing drafts",
      async () => {
        const first = await listVisiblePosts(database, null, {
          pageSize: 1,
          afterId: null,
          status: "published",
        });

        assert.deepEqual(
          first.posts.map((post) => post._id),
          ["post-01"],
        );
        assert.equal(first.hasNextPage, true);

        const second = await listVisiblePosts(database, null, {
          pageSize: 1,
          afterId: "post-01",
          status: "published",
        });

        assert.deepEqual(
          second.posts.map((post) => post._id),
          ["post-04"],
        );
        assert.equal(second.hasNextPage, false);
      },
    );
    await t.test(
      "rejects unsupported status values before querying",
      async () => {
        for (const status of ["archived", "DRAFT", "", 123, {}]) {
          let databaseCalls = 0;

          // INTENTIONALLY BYPASS TYPES TO SIMULATE INVALID RUNTIME INPUT.
          const options = {
            pageSize: 2,
            afterId: null,
            status,
          } as unknown as ListPostsOptions;

          await assert.rejects(
            listVisiblePosts(database, ada, options, () => {
              databaseCalls += 1;
            }),
            InvalidPostStatusError,
          );

          assert.equal(databaseCalls, 0);
        }
      },
    );
  } finally {
    try {
      // DELETE ONLY THE UNIQUE TEST DATABASE CREATED ABOVE.
      await database.dropDatabase();
    } finally {
      await client.close();
    }
  }
});

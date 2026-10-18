import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import type { Actor } from "../../src/auth/models.js";
import type { PostDocument } from "../../src/models.js";
import { listVisiblePosts, publishPost } from "../../src/posts/service.js";
import {
  InvalidPostIdError,
  PostAuthenticationRequiredError,
  PostNotFoundError,
  PostPublicationConflictError,
} from "../../src/posts/errors.js";

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

  const snapshot = (): Promise<PostDocument[]> =>
    posts.find({}).sort({ _id: 1 }).toArray();

  try {
    await client.connect();

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

    await t.test("anonymous publication leaves posts unchanged", async () => {
      const draft = await insertPost();
      const before = await snapshot();

      await assert.rejects(
        publishPost(database, null, draft._id),
        PostAuthenticationRequiredError,
      );

      assert.deepEqual(await snapshot(), before);
    });

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

    await t.test(
      "concurrent attempts produce one success and one conflict",
      async () => {
        const draft = await insertPost();

        // START BOTH OPERATIONS WITHOUT AWAITING THE FIRST.
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
  } finally {
    try {
      await database.dropDatabase();
    } finally {
      await client.close();
    }
  }
});

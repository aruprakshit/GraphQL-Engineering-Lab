import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import type { PostDocument } from "../../src/models.js";
import type { Actor } from "../../src/auth/models.js";
import { listVisiblePosts } from "../../src/posts/service.js";

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
  } finally {
    try {
      // DELETE ONLY THE UNIQUE TEST DATABASE CREATED ABOVE.
      await database.dropDatabase();
    } finally {
      await client.close();
    }
  }
});

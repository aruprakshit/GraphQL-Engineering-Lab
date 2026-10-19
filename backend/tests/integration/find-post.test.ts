import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import type { Actor } from "../../src/auth/models.js";
import type { PostDocument } from "../../src/models.js";
import { findVisiblePost, listVisiblePosts } from "../../src/posts/service.js";
import { InvalidPostIdError } from "../../src/posts/errors.js";

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
  } finally {
    try {
      await database.dropDatabase();
    } finally {
      await client.close();
    }
  }
});

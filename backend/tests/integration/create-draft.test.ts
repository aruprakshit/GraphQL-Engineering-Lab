import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import type { Actor } from "../../src/auth/models.js";
import type { PostDocument } from "../../src/models.js";
import { createDraft, listVisiblePosts } from "../../src/posts/service.js";
import {
  InvalidPostTitleError,
  PostAuthenticationRequiredError,
} from "../../src/posts/errors.js";

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
  } finally {
    try {
      // REMOVE ONLY THIS TEST'S UNIQUELY NAMED DATABASE.
      await database.dropDatabase();
    } finally {
      await client.close();
    }
  }
});

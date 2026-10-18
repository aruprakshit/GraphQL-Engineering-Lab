import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import type { Actor } from "../../src/auth/models.js";
import type { PostDocument } from "../../src/models.js";
import { updatePostTitle } from "../../src/posts/service.js";
import {
  InvalidPostIdError,
  InvalidPostTitleError,
  PostAuthenticationRequiredError,
  PostNotFoundError,
} from "../../src/posts/errors.js";

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

  const snapshot = () => posts.find({}).sort({ _id: 1 }).toArray();

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
  } finally {
    try {
      await database.dropDatabase();
    } finally {
      await client.close();
    }
  }
});

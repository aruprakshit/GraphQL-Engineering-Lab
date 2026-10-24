import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import {
  findPublicProfiles,
  InvalidStoredProfileError,
} from "../../src/profiles.js";
import { once } from "node:events";
import { createApp } from "../../src/app.js";

// Allow invalid fixture values deliberately: the lookup must validate
// actual stored data rather than trust TypeScript declarations.
interface ProfileFixture {
  _id: string;
  name: unknown;
  privateNote?: string;
}

// Verify the lookup against real MongoDB:
// - public-field mapping and omission of missing IDs;
// - duplicate IDs do not duplicate results;
// - UTF-8 byte boundaries;
// - one invalid profile rejects the entire batch.
test("public profile lookup", async (t) => {
  const mongoUrl = process.env.TEST_MONGO_URL;

  if (!mongoUrl) {
    throw new Error("TEST_MONGO_URL must be configured");
  }

  const client = new MongoClient(mongoUrl, {
    serverSelectionTimeoutMS: 3000,
  });

  const database = client.db(`profiles_${randomUUID()}`);
  const users = database.collection<ProfileFixture>("users");

  t.after(async () => {
    try {
      await database.dropDatabase();
    } finally {
      await client.close();
    }
  });

  await client.connect();

  async function seed(profiles: ProfileFixture[]): Promise<void> {
    await users.deleteMany({});

    if (profiles.length > 0) {
      await users.insertMany(profiles);
    }
  }

  await t.test("returns public fields and omits missing IDs", async () => {
    await seed([
      {
        _id: "user-1",
        name: "Ada",
        privateNote: "Must not appear in the response",
      },
      { _id: "user-3", name: "Linus" },
      { _id: "unrequested", name: "Another user" },
    ]);

    const result = await findPublicProfiles(database, {
      ids: ["user-3", "missing-user", "user-1", "user-3"],
    });

    // Response order is unspecified by the service contract.
    result.sort((left, right) => left.id.localeCompare(right.id));

    assert.deepEqual(result, [
      { id: "user-1", displayName: "Ada" },
      { id: "user-3", displayName: "Linus" },
    ]);
  });

  await t.test("returns an empty result when no profiles exist", async () => {
    await seed([]);

    assert.deepEqual(
      await findPublicProfiles(database, {
        ids: ["missing-user"],
      }),
      [],
    );
  });

  await t.test("accepts a name of exactly 128 UTF-8 bytes", async () => {
    const name = "é".repeat(64);

    assert.equal(Buffer.byteLength(name, "utf8"), 128);

    await seed([{ _id: "boundary-user", name }]);

    assert.deepEqual(
      await findPublicProfiles(database, {
        ids: ["boundary-user"],
      }),
      [{ id: "boundary-user", displayName: name }],
    );
  });

  await t.test("rejects a name exceeding 128 UTF-8 bytes", async () => {
    await seed([
      {
        _id: "oversized-user",
        name: "é".repeat(65),
      },
    ]);

    await assert.rejects(
      findPublicProfiles(database, {
        ids: ["oversized-user"],
      }),
      InvalidStoredProfileError,
    );
  });

  await t.test("rejects the whole batch for one invalid profile", async () => {
    await seed([
      { _id: "valid-user", name: "Ada" },
      { _id: "invalid-user", name: 123 },
    ]);

    await assert.rejects(
      findPublicProfiles(database, {
        ids: ["valid-user", "invalid-user"],
      }),
      InvalidStoredProfileError,
    );
  });

  await t.test("rejects an empty stored name", async () => {
    await seed([{ _id: "empty-name", name: "" }]);

    await assert.rejects(
      findPublicProfiles(database, {
        ids: ["empty-name"],
      }),
      InvalidStoredProfileError,
    );
  });

  // Exercise the assembled app with real MongoDB, rather than a stub.
  await t.test(
    "application connects HTTP requests to profile storage",
    async (t) => {
      const token = "ab".repeat(32);
      let lookupCalls = 0;

      const app = createApp({
        serviceToken: token,
        lookupProfiles: (input) => {
          lookupCalls += 1;
          return findPublicProfiles(database, input);
        },
      });

      const server = app.listen(0, "127.0.0.1");

      t.after(async () => {
        server.closeAllConnections();

        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      });

      await once(server, "listening");

      const address = server.address();
      assert.ok(address && typeof address === "object");

      const baseUrl = `http://127.0.0.1:${address.port}`;

      interface TestHttpResponse {
        status: number;
        body: unknown;
      }

      async function send(
        ids: string[],
        authenticated = true,
      ): Promise<TestHttpResponse> {
        const headers = new Headers({
          "Content-Type": "application/json",
        });

        if (authenticated) {
          headers.set("Authorization", `Bearer ${token}`);
        }

        const response = await fetch(`${baseUrl}/internal/users/batch`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ids }),
        });

        return {
          status: response.status,
          body: await response.json(),
        };
      }

      await t.test("health does not perform a profile lookup", async () => {
        const before = lookupCalls;
        const response = await fetch(`${baseUrl}/health`);

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          status: "ok",
          service: "graphql-user-service",
        });
        assert.equal(lookupCalls, before);
      });

      await t.test(
        "returns stored profiles through the batch endpoint",
        async () => {
          await seed([
            {
              _id: "http-user",
              name: "Ada",
              privateNote: "Must not leave storage",
            },
          ]);

          const before = lookupCalls;
          const response = await send([
            "http-user",
            "missing-user",
            "http-user",
          ]);

          assert.equal(response.status, 200);
          assert.deepEqual(response.body, {
            users: [{ id: "http-user", displayName: "Ada" }],
          });
          assert.equal(lookupCalls, before + 1);
        },
      );

      await t.test("rejects unauthorized requests before lookup", async () => {
        const before = lookupCalls;
        const response = await send(["http-user"], false);

        assert.equal(response.status, 401);
        assert.deepEqual(response.body, {
          error: {
            code: "UNAUTHORIZED",
            message: "Service authentication required",
          },
        });
        assert.equal(lookupCalls, before);
      });

      await t.test("rejects invalid input before lookup", async () => {
        const before = lookupCalls;
        const response = await send([]);

        assert.equal(response.status, 400);
        assert.equal(lookupCalls, before);
      });

      await t.test(
        "returns a generic failure for corrupt stored data",
        async () => {
          await seed([
            { _id: "valid-user", name: "Ada" },
            { _id: "invalid-user", name: 123 },
          ]);

          const response = await send(["valid-user", "invalid-user"]);

          assert.equal(response.status, 500);
          assert.deepEqual(response.body, {
            error: {
              code: "INTERNAL_SERVER_ERROR",
              message: "Unable to complete profile lookup",
            },
          });
        },
      );
    },
  );
});

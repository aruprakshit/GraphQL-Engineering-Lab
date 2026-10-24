import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { MongoNetworkError } from "mongodb";
import { createBatchRouter } from "./batch-route.js";
import type { ProfileLookup } from "./batch-route.js";
import { InvalidStoredProfileError } from "./profiles.js";

interface TestHttpResponse {
  status: number;
  body: unknown;
}

// Verify that missing profiles, dependency failures, and unexpected
// failures remain distinct without exposing internal error details.
test("batch route handles lookup outcomes", async (t) => {
  const token = "ab".repeat(32);
  let lookup: ProfileLookup = async () => [];

  const app = express();

  app.use(
    createBatchRouter({
      serviceToken: token,
      lookupProfiles: (input) => lookup(input),
    }),
  );

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

  const url = `http://127.0.0.1:${address.port}/internal/users/batch`;

  async function send(): Promise<TestHttpResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: ["user-1"] }),
    });

    return {
      status: response.status,
      body: await response.json(),
    };
  }

  await t.test("returns an empty successful result for missing users", async () => {
    lookup = async () => [];

    const response = await send();

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { users: [] });
  });

  await t.test("returns a generic 503 for database failure", async () => {
    lookup = async () => {
      throw new MongoNetworkError("Private database connection details");
    };

    const response = await send();

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "User service temporarily unavailable",
      },
    });
  });

  await t.test("returns a generic 500 for invalid stored data", async () => {
    lookup = async () => {
      throw new InvalidStoredProfileError();
    };

    const response = await send();

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to complete profile lookup",
      },
    });
  });

  await t.test("does not expose unexpected error details", async () => {
    lookup = async () => {
      throw new Error("Private implementation details");
    };

    const response = await send();

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to complete profile lookup",
      },
    });
  });

  await t.test("rejects an oversized lookup response", async () => {
    // Deliberately bypass the real lookup's profile validation to
    // exercise the route's independent response-size guard.
    lookup = async () => [
      {
        id: "user-1",
        displayName: "a".repeat(256 * 1024),
      },
    ];

    const response = await send();

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to complete profile lookup",
      },
    });
  });
});

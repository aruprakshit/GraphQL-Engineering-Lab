import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { createBatchRouter } from "./batch-route.js";

interface RequestOptions {
  authorization?: string | null;
  contentType?: string | null;
  body?: string;
}

interface TestHttpResponse {
  status: number;
  body: unknown;
}

// Test the complete HTTP pipeline with a controlled lookup.
// Rejected requests must never reach profile lookup.
test("batch route validates requests before lookup", async (t) => {
  const token = "ab".repeat(32);
  let lookupCalls = 0;

  const app = express();

  app.use(
    createBatchRouter({
      serviceToken: token,
      lookupProfiles: async (input) => {
        lookupCalls += 1;
        assert.deepEqual(input, { ids: ["user-1"] });

        return [{ id: "user-1", displayName: "Ada" }];
      },
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

  async function send(options: RequestOptions = {}): Promise<TestHttpResponse> {
    const headers = new Headers();

    const authorization =
      options.authorization === undefined
        ? `Bearer ${token}`
        : options.authorization;

    const contentType =
      options.contentType === undefined
        ? "application/json"
        : options.contentType;

    if (authorization !== null) {
      headers.set("Authorization", authorization);
    }

    if (contentType !== null) {
      headers.set("Content-Type", contentType);
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: options.body ?? JSON.stringify({ ids: ["user-1"] }),
    });

    return {
      status: response.status,
      body: await response.json(),
    };
  }

  await t.test("returns profiles for a valid request", async () => {
    const before = lookupCalls;
    const response = await send();

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      users: [{ id: "user-1", displayName: "Ada" }],
    });
    assert.equal(lookupCalls, before + 1);
  });

  const rejectedCases: {
    name: string;
    options: RequestOptions;
    status: number;
    code: string;
  }[] = [
    {
      name: "missing authentication",
      options: { authorization: null },
      status: 401,
      code: "UNAUTHORIZED",
    },
    {
      name: "incorrect authentication",
      options: { authorization: `Bearer ${"cd".repeat(32)}` },
      status: 401,
      code: "UNAUTHORIZED",
    },
    {
      name: "unsupported content type",
      options: { contentType: "text/plain" },
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    },
    {
      name: "malformed JSON",
      options: { body: '{"ids":' },
      status: 400,
      code: "INVALID_INPUT",
    },
    {
      name: "invalid batch input",
      options: { body: JSON.stringify({ ids: [] }) },
      status: 400,
      code: "INVALID_INPUT",
    },
    {
      name: "oversized body",
      options: {
        body: JSON.stringify({ ids: ["a".repeat(32 * 1024)] }),
      },
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    },
    {
      name: "unauthorized malformed body",
      options: {
        authorization: null,
        body: '{"ids":',
      },
      status: 401,
      code: "UNAUTHORIZED",
    },
  ];

  for (const scenario of rejectedCases) {
    await t.test(`rejects ${scenario.name}`, async () => {
      const before = lookupCalls;
      const response = await send(scenario.options);

      assert.equal(response.status, scenario.status);
      assert.ok(
        typeof response.body === "object" &&
          response.body !== null &&
          "error" in response.body,
      );
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(response.body, "error")?.value.code,
        scenario.code,
      );
      assert.equal(lookupCalls, before);
    });
  }
});

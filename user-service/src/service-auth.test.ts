import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { test } from "node:test";
import express from "express";
import { createServiceAuth } from "./service-auth.js";

interface TestHttpResponse {
  status: number;
  body: string;
}

// Exercise real HTTP headers, including duplicates.
// Rejected requests must never reach the protected handler.
test("service authentication protects the route", async (t) => {
  const token = "ab".repeat(32);
  const app = express();
  let handlerCalls = 0;

  app.post("/internal/users/batch", createServiceAuth(token), (_req, res) => {
    handlerCalls += 1;
    res.status(204).end();
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

  const url = new URL(`http://127.0.0.1:${address.port}/internal/users/batch`);

  function send(authorization?: string | string[]): Promise<TestHttpResponse> {
    return new Promise<TestHttpResponse>((resolve, reject) => {
      const outgoing = request(
        url,
        {
          method: "POST",
          headers:
            authorization === undefined ? {} : { Authorization: authorization },
        },
        (incoming) => {
          incoming.setEncoding("utf8");
          let body = "";

          incoming.on("data", (chunk: string) => {
            body += chunk;
          });

          incoming.on("error", reject);

          incoming.on("end", () => {
            resolve({
              status: incoming.statusCode ?? 0,
              body,
            });
          });
        },
      );

      outgoing.on("error", reject);
      outgoing.end();
    });
  }

  const deniedCases: {
    name: string;
    authorization?: string | string[];
  }[] = [
    { name: "missing header" },
    { name: "wrong scheme", authorization: `Basic ${token}` },
    { name: "missing token", authorization: "Bearer" },
    { name: "short token", authorization: "Bearer ab" },
    {
      name: "incorrect token",
      authorization: `Bearer ${"cd".repeat(32)}`,
    },
    {
      name: "token casing changed",
      authorization: `Bearer ${token.toUpperCase()}`,
    },
    {
      name: "duplicate headers",
      authorization: [`Bearer ${token}`, `Bearer ${token}`],
    },
  ];

  for (const scenario of deniedCases) {
    await t.test(`rejects ${scenario.name}`, async () => {
      const before = handlerCalls;
      const response = await send(scenario.authorization);

      assert.equal(response.status, 401);
      assert.deepEqual(JSON.parse(response.body), {
        error: {
          code: "UNAUTHORIZED",
          message: "Service authentication required",
        },
      });
      assert.equal(handlerCalls, before);
      assert.equal(response.body.includes(token), false);
    });
  }

  await t.test("accepts the configured token", async () => {
    const before = handlerCalls;
    const response = await send(`Bearer ${token}`);

    assert.equal(response.status, 204);
    assert.equal(handlerCalls, before + 1);
  });

  await t.test("accepts a case-insensitive Bearer scheme", async () => {
    const before = handlerCalls;
    const response = await send(`bearer ${token}`);

    assert.equal(response.status, 204);
    assert.equal(handlerCalls, before + 1);
  });
});

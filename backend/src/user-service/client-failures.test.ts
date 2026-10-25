import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { RequestListener } from "node:http";
import { test } from "node:test";
import { createUserServiceClient } from "./client.js";
import type { UserServiceFailureReason } from "./errors.js";

test("user service client handles HTTP failures", async (t) => {
  // Why: exercise real fetch behavior against controlled HTTP responses,
  // including cancellation, redirects, and delayed response bodies.

  // Arrange
  let requests = 0;
  let handler: RequestListener = (_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"users":[]}');
  };

  const server = createServer((request, response) => {
    requests += 1;
    request.resume();
    handler(request, response);
  });

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

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const client = createUserServiceClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    serviceToken: "ab".repeat(32),
  });

  const cases: {
    name: string;
    status: number;
    contentType: string;
    body: string;
    reason: UserServiceFailureReason;
  }[] = [
    {
      name: "non-200 response",
      status: 503,
      contentType: "application/json",
      body: '{"error":"Private storage details"}',
      reason: "HTTP_ERROR",
    },
    {
      name: "unexpected content type",
      status: 200,
      contentType: "text/html",
      body: "<html>Not a profile response</html>",
      reason: "INVALID_RESPONSE",
    },
    {
      name: "malformed JSON",
      status: 200,
      contentType: "application/json",
      body: '{"users":',
      reason: "INVALID_RESPONSE",
    },
    {
      name: "invalid profile shape",
      status: 200,
      contentType: "application/json",
      body: '{"users":[{"id":"user-1","displayName":123}]}',
      reason: "INVALID_RESPONSE",
    },
    {
      name: "duplicate returned ID",
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        users: [
          { id: "user-1", displayName: "Ada" },
          { id: "user-1", displayName: "Ada" },
        ],
      }),
      reason: "INVALID_RESPONSE",
    },
    {
      name: "unrequested returned ID",
      status: 200,
      contentType: "application/json",
      body: '{"users":[{"id":"other-user","displayName":"Other"}]}',
      reason: "INVALID_RESPONSE",
    },
    {
      name: "oversized response body",
      status: 200,
      contentType: "application/json",
      body: JSON.stringify("a".repeat(256 * 1024)),
      reason: "RESPONSE_TOO_LARGE",
    },
  ];

  // Act and Assert: execute each failure independently.
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      // Why: a failed dependency response must reject with a generic
      // message and must not trigger an application retry.

      // Arrange
      const before = requests;

      handler = (_request, response) => {
        response.writeHead(scenario.status, {
          "Content-Type": scenario.contentType,
        });
        response.end(scenario.body);
      };

      // Act
      const operation = client.findProfiles(["user-1"]);

      // Assert
      await assert.rejects(operation, {
        name: "UserServiceUnavailableError",
        message: "User service temporarily unavailable",
        reason: scenario.reason,
      });
      assert.equal(requests, before + 1);
    });
  }

  await t.test("rejects redirects without following them", async () => {
    // Why: the configured endpoint must not redirect the client to
    // another location. Only one HTTP request should reach this server.

    // Arrange
    const before = requests;

    handler = (_request, response) => {
      response.writeHead(302, {
        Location: "/redirect-target",
      });
      response.end();
    };

    // Act
    const operation = client.findProfiles(["user-1"]);

    // Assert
    await assert.rejects(operation, {
      name: "UserServiceUnavailableError",
      message: "User service temporarily unavailable",
      reason: "HTTP_ERROR",
    });
    assert.equal(requests, before + 1);
  });

  await t.test("times out while waiting for response headers", async () => {
    // Why: a service that accepts a connection but never responds
    // must not keep the caller waiting indefinitely.

    // Arrange
    const before = requests;

    handler = () => {
      // Deliberately leave the response open without sending headers.
    };

    // Act
    const operation = client.findProfiles(["user-1"]);

    // Assert
    await assert.rejects(operation, {
      name: "UserServiceUnavailableError",
      message: "User service temporarily unavailable",
      reason: "TIMEOUT",
    });
    assert.equal(requests, before + 1);
  });

  await t.test("keeps the deadline active while reading the body", async () => {
    // Why: fetch resolves when headers arrive. Clearing the timer then
    // would allow an unfinished response body to hang indefinitely.

    // Arrange
    const before = requests;

    handler = (_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
      });
      response.flushHeaders();
      response.write('{"users":');

      // Deliberately do not finish the response.
    };

    // Act
    const operation = client.findProfiles(["user-1"]);

    // Assert
    await assert.rejects(operation, {
      name: "UserServiceUnavailableError",
      message: "User service temporarily unavailable",
      reason: "TIMEOUT",
    });
    assert.equal(requests, before + 1);
  });

  await t.test(
    "classifies a dropped connection as a network failure",
    async () => {
      // Why: transport failure is different from receiving an HTTP error
      // response. Neither should expose low-level connection details.

      // Arrange
      handler = (request) => {
        request.socket.destroy();
      };

      // Act
      const operation = client.findProfiles(["user-1"]);

      // Assert
      await assert.rejects(operation, {
        name: "UserServiceUnavailableError",
        message: "User service temporarily unavailable",
        reason: "NETWORK_ERROR",
      });
    },
  );
});

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createUserServiceClient } from "./client.js";
import { InvalidUserServiceInputError } from "./errors.js";
import type { PublicProfile } from "./types.js";

interface RecordedRequest {
  method: string | undefined;
  path: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

interface FixtureServer {
  baseUrl: string;
  requests: RecordedRequest[];
}

const serviceToken = "ab".repeat(32);

async function startFixtureServer(
  t: TestContext,
  users: PublicProfile[] = [],
): Promise<FixtureServer> {
  const requests: RecordedRequest[] = [];

  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");

    request.on("data", (chunk: string) => {
      body += chunk;
    });

    request.on("end", () => {
      requests.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body,
      });

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ users }));
    });
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

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
  };
}

test("sends an authenticated batch and returns existing profiles", async (t) => {
  // Why: verify the actual HTTP contract, including deduplication,
  // fixed headers, missing profiles, and unordered response acceptance.

  // Arrange
  const users = [
    { id: "user-1", displayName: "Ada" },
    { id: "user-3", displayName: "Linus" },
  ];
  const fixture = await startFixtureServer(t, users);
  const client = createUserServiceClient({
    baseUrl: fixture.baseUrl,
    serviceToken,
  });

  // Act
  const profiles = await client.findProfiles([
    "user-3",
    "missing-user",
    "user-1",
    "user-3",
  ]);

  // Assert
  assert.deepEqual(profiles, users);
  assert.equal(fixture.requests.length, 1);

  const request = fixture.requests[0]!;

  assert.equal(request.method, "POST");
  assert.equal(request.path, "/internal/users/batch");
  assert.equal(request.headers.authorization, `Bearer ${serviceToken}`);
  assert.equal(request.headers.accept, "application/json");
  assert.equal(request.headers["content-type"], "application/json");
  assert.equal(request.headers.cookie, undefined);

  assert.deepEqual(JSON.parse(request.body), {
    ids: ["user-3", "missing-user", "user-1"],
  });
});

test("makes no HTTP request for empty input", async (t) => {
  // Why: an empty lookup should resolve locally rather than send a
  // request the service would reject for containing no IDs.

  // Arrange
  const fixture = await startFixtureServer(t);
  const client = createUserServiceClient({
    baseUrl: fixture.baseUrl,
    serviceToken,
  });

  // Act
  const profiles = await client.findProfiles([]);

  // Assert
  assert.deepEqual(profiles, []);
  assert.equal(fixture.requests.length, 0);
});

test("rejects invalid IDs before sending HTTP requests", async (t) => {
  // Why: validate the complete input first. Even an invalid ID after
  // 100 valid IDs must prevent the first batch from being sent.

  // Arrange
  const fixture = await startFixtureServer(t);
  const client = createUserServiceClient({
    baseUrl: fixture.baseUrl,
    serviceToken,
  });
  const ids = [
    ...Array.from({ length: 100 }, (_, index) => `user-${index}`),
    "",
  ];

  // Act
  const operation = client.findProfiles(ids);

  // Assert
  await assert.rejects(operation, InvalidUserServiceInputError);
  assert.equal(fixture.requests.length, 0);
});

test("sends 101 unique IDs as two bounded requests", async (t) => {
  // Why: verify the assembled client uses the batching helper and sends
  // both groups without losing or repeating IDs.

  // Arrange
  const fixture = await startFixtureServer(t);
  const client = createUserServiceClient({
    baseUrl: fixture.baseUrl,
    serviceToken,
  });
  const ids = Array.from({ length: 101 }, (_, index) => `user-${index}`);

  // Act
  const profiles = await client.findProfiles(ids);

  // Assert
  assert.deepEqual(profiles, []);
  assert.equal(fixture.requests.length, 2);
  assert.deepEqual(JSON.parse(fixture.requests[0]!.body), {
    ids: ids.slice(0, 100),
  });
  assert.deepEqual(JSON.parse(fixture.requests[1]!.body), {
    ids: ids.slice(100),
  });

  for (const request of fixture.requests) {
    assert.ok(Buffer.byteLength(request.body, "utf8") <= 32 * 1024);
  }
});

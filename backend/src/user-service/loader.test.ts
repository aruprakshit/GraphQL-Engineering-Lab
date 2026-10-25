import assert from "node:assert/strict";
import { test } from "node:test";
import { UserServiceUnavailableError } from "./errors.js";
import { createProfileLoader } from "./loader.js";
import type { UserServiceClient } from "./types.js";

test("restores order, preserves missing profiles, and deduplicates keys", async () => {
  // Why: service response order is unspecified, but DataLoader must
  // return one result per original key, including duplicates and missing IDs.

  // Arrange
  const calls: string[][] = [];
  const ada = { id: "user-1", displayName: "Ada" };
  const linus = { id: "user-3", displayName: "Linus" };

  const client: UserServiceClient = {
    async findProfiles(ids) {
      calls.push([...ids]);

      return [ada, linus];
    },
  };

  const loader = createProfileLoader(client, "loader-order-test");

  // Act
  const results = await loader.loadMany([
    "user-3",
    "missing-user",
    "user-1",
    "user-3",
  ]);

  // Assert
  assert.deepEqual(results, [linus, null, ada, linus]);
  assert.deepEqual(calls, [["user-3", "missing-user", "user-1"]]);
});

test("caches an existing profile within one loader", async () => {
  // Why: repeated author fields in the same request should reuse the
  // resolved profile instead of making another client call.

  // Arrange
  let calls = 0;
  const ada = { id: "user-1", displayName: "Ada" };

  const client: UserServiceClient = {
    async findProfiles() {
      calls += 1;
      return [ada];
    },
  };

  const loader = createProfileLoader(client, "loader-cache-test");

  // Act
  const first = await loader.load("user-1");
  const second = await loader.load("user-1");

  // Assert
  assert.deepEqual(first, ada);
  assert.deepEqual(second, ada);
  assert.equal(calls, 1);
});

test("caches a missing profile within one loader", async () => {
  // Why: an absent profile should not trigger repeated lookups for
  // every post that references the same missing author.

  // Arrange
  let calls = 0;

  const client: UserServiceClient = {
    async findProfiles() {
      calls += 1;
      return [];
    },
  };

  const loader = createProfileLoader(client, "loader-missing-test");

  // Act
  const first = await loader.load("missing-user");
  const second = await loader.load("missing-user");

  // Assert
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(calls, 1);
});

test("keeps caches isolated between request loaders", async () => {
  // Why: sharing the HTTP client must not share cached profile data.
  // A new GraphQL request needs a fresh loader and a fresh lookup.

  // Arrange
  let calls = 0;
  let displayName = "Ada";

  const client: UserServiceClient = {
    async findProfiles() {
      calls += 1;
      return [{ id: "user-1", displayName }];
    },
  };

  const firstRequestLoader = createProfileLoader(client, "request-1");
  const secondRequestLoader = createProfileLoader(client, "request-2");

  // Act
  const initial = await firstRequestLoader.load("user-1");

  displayName = "Ada Updated";

  const cached = await firstRequestLoader.load("user-1");
  const fresh = await secondRequestLoader.load("user-1");

  // Assert
  assert.deepEqual(initial, {
    id: "user-1",
    displayName: "Ada",
  });
  assert.deepEqual(cached, {
    id: "user-1",
    displayName: "Ada",
  });
  assert.deepEqual(fresh, {
    id: "user-1",
    displayName: "Ada Updated",
  });
  assert.equal(calls, 2);
});

test("propagates dependency failure instead of returning missing profiles", async () => {
  // Why: an outage must remain an error. Returning null would falsely
  // claim the requested profiles do not exist.

  // Arrange
  let calls = 0;
  const failure = new UserServiceUnavailableError("TIMEOUT");

  const client: UserServiceClient = {
    async findProfiles() {
      calls += 1;
      throw failure;
    },
  };

  const loader = createProfileLoader(client, "loader-failure-test");

  // Act
  const operation = Promise.all([loader.load("user-1"), loader.load("user-3")]);

  // Assert
  await assert.rejects(operation, (error: unknown) => error === failure);
  assert.equal(calls, 1);
});

test("makes no client call when no keys are loaded", async () => {
  // Why: merely creating a request-scoped loader must not fetch users.
  // Queries that do not select authors should not need the user service.

  // Arrange
  let calls = 0;

  const client: UserServiceClient = {
    async findProfiles() {
      calls += 1;
      return [];
    },
  };

  const loader = createProfileLoader(client, "loader-empty-test");

  // Act
  const results = await loader.loadMany([]);

  // Assert
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

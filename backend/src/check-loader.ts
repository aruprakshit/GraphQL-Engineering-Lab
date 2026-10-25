import assert from "node:assert/strict";
import { createUserServiceClient } from "./user-service/client.js";
import { parseUserServiceOptions } from "./user-service/config.js";
import { UserServiceUnavailableError } from "./user-service/errors.js";
import { createProfileLoader } from "./user-service/loader.js";
import type { UserServiceClient } from "./user-service/types.js";

async function checkLoader(): Promise<void> {
  const options = parseUserServiceOptions({
    baseUrl: process.env.USER_SERVICE_URL,
    serviceToken: process.env.USER_SERVICE_TOKEN,
  });

  const httpClient = createUserServiceClient(options);
  const calls: string[][] = [];

  // Observe loader-to-client calls while retaining real HTTP behavior.
  const observedClient: UserServiceClient = {
    async findProfiles(ids) {
      calls.push([...ids]);
      return httpClient.findProfiles(ids);
    },
  };

  // Arrange
  const loader = createProfileLoader(observedClient, "loader-check");

  // Act
  const results = await loader.loadMany([
    "user-3",
    "missing-user",
    "user-1",
    "user-3",
  ]);

  // Assert
  assert.deepEqual(
    results.map((profile) => {
      if (profile instanceof Error) {
        throw profile;
      }

      return profile?.displayName ?? null;
    }),
    ["Linus", null, "Ada", "Linus"],
  );
  assert.deepEqual(calls, [["user-3", "missing-user", "user-1"]]);

  // Why: another lookup in this request must use its cached profile.
  // Act
  await loader.load("user-3");

  // Assert
  assert.equal(calls.length, 1);

  // Why: a separate request must not reuse the first request's cache.
  // Arrange
  const nextLoader = createProfileLoader(observedClient, "next-request-check");

  // Act
  const fresh = await nextLoader.load("user-3");

  // Assert
  assert.equal(fresh?.displayName, "Linus");
  assert.deepEqual(calls, [["user-3", "missing-user", "user-1"], ["user-3"]]);

  console.log(
    "Service-backed loader ordering, missing-profile, cache, and request-isolation checks passed",
  );
}

checkLoader().catch((error: unknown) => {
  console.error({
    event: "loader_check_failed",
    reason:
      error instanceof UserServiceUnavailableError
        ? error.reason
        : "CHECK_FAILED",
  });

  process.exitCode = 1;
});

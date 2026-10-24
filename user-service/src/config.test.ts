import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "./config.js";

// Configuration must reject missing or malformed credentials before
// the service starts accepting requests.
test("accepts a valid service token", () => {
  const token = "ab".repeat(32);

  assert.deepEqual(readConfig({ USER_SERVICE_TOKEN: token }), {
    serviceToken: token,
  });
});

test("rejects missing or malformed service tokens", () => {
  const invalidTokens = [
    undefined,
    "",
    "ab".repeat(31),
    "ab".repeat(33),
    "AB".repeat(32),
    "zz".repeat(32),
    ` ${"ab".repeat(32)}`,
    `${"ab".repeat(32)} `,
  ];

  for (const token of invalidTokens) {
    assert.throws(
      () => readConfig({ USER_SERVICE_TOKEN: token }),
      /USER_SERVICE_TOKEN must contain exactly 64 lowercase hexadecimal characters/,
    );
  }
});

// Startup errors should describe the configuration problem without
// echoing the supplied credential into logs.
test("does not expose an invalid token in its error message", () => {
  const token = "secret-value-that-must-not-be-logged";

  assert.throws(
    () => readConfig({ USER_SERVICE_TOKEN: token }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(token), false);
      return true;
    },
  );
});

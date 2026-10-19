/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Generate two tokens | Valid distinct 64-character lowercase hex tokens |
 * | Hash token repeatedly | Consistent hex hash different from raw token |
 * | Malformed input | Validation returns false; hashing invalid string throws |
 *
 * Reading guide:
 * - Generation produces the client token; hashing produces the database lookup key.
 * - Validation rejects malformed values before they can become database queries.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
} from "./session-tokens.js";

test("generates valid distinct session tokens", () => {
  // ACT
  const first = generateSessionToken();
  const second = generateSessionToken();

  // ASSERT
  assert.equal(isSessionToken(first), true);
  assert.equal(first.length, 64);
  assert.equal(isSessionToken(second), true);
  assert.notEqual(first, second);
});

test("hashes a token consistently without returning the raw token", () => {
  // ARRANGE
  const token = generateSessionToken();

  // ACT
  const hash = hashSessionToken(token);

  // ASSERT
  assert.equal(hashSessionToken(token), hash);
  assert.match(hash, /^[0-9a-f]{64}$/);
  // MongoDB stores the derived lookup key, never the raw browser token.
  assert.notEqual(hash, token);
});

test("rejects malformed token inputs", () => {
  // ARRANGE
  const invalidInputs: unknown[] = [
    undefined,
    null,
    123,
    "",
    "a".repeat(63),
    "a".repeat(65),
    "g".repeat(64),
    "A".repeat(64),
    ` ${"a".repeat(64)}`,
  ];

  // ACT AND ASSERT
  for (const input of invalidInputs) {
    assert.equal(isSessionToken(input), false);
  }

  assert.throws(
    () => hashSessionToken("invalid"),
    /Invalid session token format/,
  );
});

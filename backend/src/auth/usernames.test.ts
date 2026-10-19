/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Whitespace and capitalization | Trimmed lowercase username |
 * | Supported characters and length boundaries | Accepted |
 * | Invalid length or unsupported characters | Throws |
 *
 * Reading guide:
 * - Username normalization is intentional: surrounding whitespace and case are ignored.
 * - Accepted characters and length boundaries are checked separately from normalization.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUsername } from "./usernames.js";

test("normalizes username whitespace and capitalization", () => {
  // ACT
  const username = normalizeUsername(" Ada ");

  // ASSERT
  assert.equal(username, "ada");
});

test("accepts supported username characters and length boundaries", () => {
  // ACT AND ASSERT
  assert.equal(normalizeUsername("user_123"), "user_123");
  assert.equal(normalizeUsername("abc"), "abc");
  assert.equal(normalizeUsername("a".repeat(32)), "a".repeat(32));
});

test("rejects unsupported usernames", () => {
  // ARRANGE
  const invalidNames = [
    "",
    "ab",
    "a".repeat(33),
    "ada grace",
    "ada@example.com",
    "ada-name",
  ];

  // ACT AND ASSERT
  for (const username of invalidNames) {
    assert.throws(() => normalizeUsername(username));
  }
});

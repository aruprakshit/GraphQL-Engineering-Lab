/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Valid session cookie | Returns token |
 * | Unrelated cookies or surrounding whitespace | Returns session token |
 * | Missing session or different name/case | Returns null |
 * | Malformed, quoted, or encoded value | Returns null |
 * | Duplicate session cookies | Returns null, even for identical tokens |
 *
 * Reading guide:
 * - Synthetic tokens test extraction without MongoDB or real credentials.
 * - Duplicate session names are ambiguous, so neither value should be accepted.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readSessionCookie } from "./session-cookie.js";

const token = "a".repeat(64);
const otherToken = "b".repeat(64);

// Purpose: Accept the exact raw token format issued by our cookie helper.
test("reads the session token", () => {
  assert.equal(readSessionCookie(`session=${token}`), token);
});

// Purpose: Ignore unrelated cookies rather than assuming session is the first entry.
test("finds the session among unrelated cookies", () => {
  assert.equal(
    readSessionCookie(`theme=dark; session=${token}; language=en`),
    token,
  );
});

// Purpose: Cookie separator whitespace must not become part of the token.
test("handles whitespace around cookie entries", () => {
  assert.equal(readSessionCookie(` theme=dark ; session=${token} `), token);
});

// Purpose: Cookie names are exact and case-sensitive; similar names must not authenticate.
test("returns null when no session cookie exists", () => {
  assert.equal(readSessionCookie(undefined), null);
  assert.equal(readSessionCookie(""), null);
  assert.equal(readSessionCookie("theme=dark"), null);
  assert.equal(readSessionCookie(`other_session=${token}`), null);
  assert.equal(readSessionCookie(`Session=${token}`), null);
});

// Purpose: Malformed syntax, quoting, encoding, or extra content must not become a valid token.
test("rejects malformed session values", () => {
  // Exercise malformed syntax as well as values that fail the token format.
  for (const header of [
    "session",
    "session=",
    "session=invalid",
    `session=${"a".repeat(63)}`,
    `session=${"A".repeat(64)}`,
    `session="${token}"`,
    `session=${token}=extra`,
    `session=%61${"a".repeat(63)}`,
  ]) {
    assert.equal(readSessionCookie(header), null);
  }
});

// Purpose: Choosing either duplicate value would be ambiguous, even when both values match.
test("rejects duplicate session cookies", () => {
  for (const header of [
    `session=${token}; session=${otherToken}`,
    `session=${token}; session=${token}`,
    `session=; session=${token}`,
    `session=${token}; session`,
  ]) {
    assert.equal(readSessionCookie(header), null);
  }
});

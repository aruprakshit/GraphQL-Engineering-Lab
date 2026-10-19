/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Surrounding and internal whitespace | Trims surrounding whitespace and preserves internal spacing and tabs |
 * | Titles of 1 or 200 characters | Accepts both length boundaries |
 * | Whitespace surrounding a maximum-length title | Applies the length limit after trimming |
 * | Unicode supplementary characters | Counts code points; accepts 200 emoji and rejects 201 |
 * | Empty, whitespace-only, or oversized title | Throws InvalidPostTitleError |
 * | Non-string input | Throws InvalidPostTitleError without coercion |
 *
 * Reading guide:
 * - Only surrounding whitespace is removed; internal formatting stays intact.
 * - Length is measured after trimming and in Unicode code points, including emoji.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidPostTitleError } from "./errors.js";
import { normalizePostTitle } from "./titles.js";

// Purpose: Normalize only the edges so deliberate internal title formatting survives.
test("trims surrounding whitespace and preserves internal whitespace", () => {
  assert.equal(
    normalizePostTitle(" \n Learning  GraphQL\twith MongoDB \t"),
    "Learning  GraphQL\twith MongoDB",
  );
});

// Purpose: Both inclusive boundaries must be accepted, not just typical titles.
test("accepts titles at the minimum and maximum lengths", () => {
  assert.equal(normalizePostTitle("A"), "A");

  const maximum = "a".repeat(200);
  assert.equal(normalizePostTitle(maximum), maximum);
});

// Purpose: Remove surrounding whitespace before deciding whether the title is too long.
test("applies the length limit after trimming", () => {
  const maximum = "a".repeat(200);

  assert.equal(normalizePostTitle(`  ${maximum}\n`), maximum);
});

// Purpose: Emoji expose the difference between Unicode code points and UTF-16 code units.
test("counts Unicode code points rather than UTF-16 code units", () => {
  // Each emoji uses two UTF-16 code units but counts as one allowed code point.
  const maximum = "🚀".repeat(200);

  assert.equal(normalizePostTitle(maximum), maximum);

  assert.throws(
    () => normalizePostTitle("🚀".repeat(201)),
    InvalidPostTitleError,
  );
});

// Purpose: Blank content and content beyond the maximum must share the validation error.
test("rejects empty, whitespace-only, and oversized titles", () => {
  for (const title of ["", " \t\n ", "a".repeat(201)]) {
    assert.throws(() => normalizePostTitle(title), InvalidPostTitleError);
  }
});

// Purpose: Numbers, arrays, and objects must not be coerced into unintended titles.
test("rejects non-string input without coercion", () => {
  for (const value of [undefined, null, 123, {}, ["A title"]]) {
    assert.throws(() => normalizePostTitle(value), InvalidPostTitleError);
  }
});

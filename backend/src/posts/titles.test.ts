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
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidPostTitleError } from "./errors.js";
import { normalizePostTitle } from "./titles.js";

test("trims surrounding whitespace and preserves internal whitespace", () => {
  assert.equal(
    normalizePostTitle(" \n Learning  GraphQL\twith MongoDB \t"),
    "Learning  GraphQL\twith MongoDB",
  );
});

test("accepts titles at the minimum and maximum lengths", () => {
  assert.equal(normalizePostTitle("A"), "A");

  const maximum = "a".repeat(200);
  assert.equal(normalizePostTitle(maximum), maximum);
});

test("applies the length limit after trimming", () => {
  const maximum = "a".repeat(200);

  assert.equal(normalizePostTitle(`  ${maximum}\n`), maximum);
});

test("counts Unicode code points rather than UTF-16 code units", () => {
  const maximum = "🚀".repeat(200);

  assert.equal(normalizePostTitle(maximum), maximum);

  assert.throws(
    () => normalizePostTitle("🚀".repeat(201)),
    InvalidPostTitleError,
  );
});

test("rejects empty, whitespace-only, and oversized titles", () => {
  for (const title of ["", " \t\n ", "a".repeat(201)]) {
    assert.throws(() => normalizePostTitle(title), InvalidPostTitleError);
  }
});

test("rejects non-string input without coercion", () => {
  for (const value of [undefined, null, 123, {}, ["A title"]]) {
    assert.throws(() => normalizePostTitle(value), InvalidPostTitleError);
  }
});

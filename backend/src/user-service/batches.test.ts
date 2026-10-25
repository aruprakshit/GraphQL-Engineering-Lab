import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProfileBatches,
  MAX_BATCH_IDS,
  MAX_REQUEST_BYTES,
} from "./batches.js";
import { InvalidUserServiceInputError } from "./errors.js";

test("returns no batches for empty input", () => {
  // Why: no IDs means no HTTP requests, not one request with an empty array.
  // Arrange
  const ids: string[] = [];

  // Act
  const batches = buildProfileBatches(ids);

  // Assert
  assert.deepEqual(batches, []);
});

test("deduplicates IDs without changing their values or order", () => {
  // Why: avoid repeated lookups while preserving opaque IDs, first-seen
  // order, and the caller's original array.
  // Arrange
  const ids = ["user-3", "user-1", "user-3", " User-2 "];

  // Act
  const batches = buildProfileBatches(ids);

  // Assert
  assert.deepEqual(batches, [
    {
      ids: ["user-3", "user-1", " User-2 "],
      body: JSON.stringify({
        ids: ["user-3", "user-1", " User-2 "],
      }),
    },
  ]);
  assert.deepEqual(ids, ["user-3", "user-1", "user-3", " User-2 "]);
});

test("accepts exactly 100 IDs in one batch", () => {
  // Why: the count limit is inclusive. Small IDs at the limit should
  // fit in one request rather than create an unnecessary extra batch.
  // Arrange
  const ids = Array.from({ length: 100 }, (_, index) => `user-${index}`);

  // Act
  const batches = buildProfileBatches(ids);

  // Assert
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0]?.ids, ids);
});

test("splits 101 IDs into batches of 100 and 1", () => {
  // Why: the 101st ID must start a new batch without being lost, repeated,
  // or reordered. Flattening all batches must recover the original IDs.
  // Arrange
  const ids = Array.from({ length: 101 }, (_, index) => `user-${index}`);

  // Act
  const batches = buildProfileBatches(ids);

  // Assert
  assert.deepEqual(
    batches.map((batch) => batch.ids.length),
    [100, 1],
  );
  assert.deepEqual(
    batches.flatMap((batch) => batch.ids),
    ids,
  );
});

test("splits batches when UTF-8 bytes exceed the request budget", () => {
  // Why: each 界 uses three UTF-8 bytes. Individually valid IDs can
  // exhaust the byte budget before the 100-ID count limit is reached.
  // Arrange
  const ids = Array.from(
    { length: 100 },
    (_, index) => `${"界".repeat(250)}${index.toString().padStart(3, "0")}`,
  );
  const unsplitBytes = Buffer.byteLength(JSON.stringify({ ids }), "utf8");

  // Act
  const batches = buildProfileBatches(ids);

  // Assert
  assert.ok(unsplitBytes > MAX_REQUEST_BYTES);
  assert.ok(batches.length > 1);
  assert.ok(batches[0]!.ids.length < MAX_BATCH_IDS);
  assert.deepEqual(
    batches.flatMap((batch) => batch.ids),
    ids,
  );

  for (const batch of batches) {
    assert.ok(batch.ids.length <= MAX_BATCH_IDS);
    assert.ok(Buffer.byteLength(batch.body, "utf8") <= MAX_REQUEST_BYTES);
    assert.deepEqual(JSON.parse(batch.body), { ids: batch.ids });
  }
});

test("accounts for JSON escaping when splitting batches", () => {
  // Why: a null character becomes the six-character JSON escape \\u0000.
  // Measuring raw IDs would underestimate the transmitted body size.
  // Each serialized batch must fit and decode back to the unchanged IDs.
  // Arrange
  const ids = Array.from(
    { length: 100 },
    (_, index) => `${"\0".repeat(250)}${index.toString().padStart(3, "0")}`,
  );

  // Act
  const batches = buildProfileBatches(ids);

  // Assert
  assert.ok(batches.length > 1);
  assert.deepEqual(
    batches.flatMap((batch) => batch.ids),
    ids,
  );

  for (const batch of batches) {
    assert.ok(Buffer.byteLength(batch.body, "utf8") <= MAX_REQUEST_BYTES);
    assert.deepEqual(JSON.parse(batch.body), { ids: batch.ids });
  }
});

test("rejects empty IDs", () => {
  // Why: one invalid ID must reject caller input before any HTTP request;
  // it must not be silently omitted or reported as a dependency outage.
  // Arrange
  const ids = ["user-1", ""];

  // Act: defer execution until the exception assertion runs.
  const action = () => buildProfileBatches(ids);

  // Assert
  assert.throws(action, InvalidUserServiceInputError);
});

test("rejects IDs exceeding 256 UTF-16 code units", () => {
  // Why: an oversized ID violates the per-ID contract even if one request
  // could otherwise fit within the overall byte budget.
  // Arrange
  const ids = ["a".repeat(257)];

  // Act: defer execution until the exception assertion runs.
  const action = () => buildProfileBatches(ids);

  // Assert
  assert.throws(action, InvalidUserServiceInputError);
});

test("accepts an ID at the 256-code-unit boundary", () => {
  // Why: the per-ID length limit is inclusive; exactly 256 code units
  // must be accepted without truncation or normalization.
  // Arrange
  const id = "a".repeat(256);

  // Act
  const batches = buildProfileBatches([id]);

  // Assert
  assert.deepEqual(batches[0]?.ids, [id]);
});

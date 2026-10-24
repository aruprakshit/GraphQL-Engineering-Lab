import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProfileBatches,
  MAX_BATCH_IDS,
  MAX_REQUEST_BYTES,
} from "./batches.js";
import { InvalidUserServiceInputError } from "./errors.js";

// Empty input requires no HTTP requests.
test("returns no batches for empty input", () => {
  assert.deepEqual(buildProfileBatches([]), []);
});

// Repeated IDs should be looked up once.
// Keep the order in which each unique ID first appeared.
test("deduplicates IDs without changing their values or order", () => {
  const ids = ["user-3", "user-1", "user-3", " User-2 "];

  assert.deepEqual(buildProfileBatches(ids), [
    {
      ids: ["user-3", "user-1", " User-2 "],
      body: JSON.stringify({
        ids: ["user-3", "user-1", " User-2 "],
      }),
    },
  ]);

  assert.deepEqual(ids, ["user-3", "user-1", "user-3", " User-2 "]);
});

// 100 short IDs fit in one request.
test("accepts exactly 100 IDs in one batch", () => {
  const ids = Array.from({ length: 100 }, (_, index) => `user-${index}`);

  const batches = buildProfileBatches(ids);

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0]?.ids, ids);
});

// The 101st ID starts a second request.
// No ID should be lost when a batch is saved.
test("splits 101 IDs into batches of 100 and 1", () => {
  const ids = Array.from({ length: 101 }, (_, index) => `user-${index}`);

  const batches = buildProfileBatches(ids);

  assert.deepEqual(
    batches.map((batch) => batch.ids.length),
    [100, 1],
  );
  assert.deepEqual(
    batches.flatMap((batch) => batch.ids),
    ids,
  );
});

// Each "界" occupies three UTF-8 bytes.
// These IDs satisfy the character limit, but their JSON exceeds
// 32 KiB before we reach 100 entries.
test("splits batches when UTF-8 bytes exceed the request budget", () => {
  const ids = Array.from(
    { length: 100 },
    (_, index) => `${"界".repeat(250)}${index.toString().padStart(3, "0")}`,
  );

  assert.ok(
    Buffer.byteLength(JSON.stringify({ ids }), "utf8") > MAX_REQUEST_BYTES,
  );

  const batches = buildProfileBatches(ids);

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

// A null character becomes the six-character JSON escape "\\u0000".
// Measuring the unescaped ID strings would underestimate request size.
test("accounts for JSON escaping when splitting batches", () => {
  const ids = Array.from(
    { length: 100 },
    (_, index) => `${"\0".repeat(250)}${index.toString().padStart(3, "0")}`,
  );

  const batches = buildProfileBatches(ids);

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

// Invalid IDs are caller errors, not dependency failures.
test("rejects empty IDs", () => {
  assert.throws(
    () => buildProfileBatches(["user-1", ""]),
    InvalidUserServiceInputError,
  );
});

test("rejects IDs exceeding 256 UTF-16 code units", () => {
  assert.throws(
    () => buildProfileBatches(["a".repeat(257)]),
    InvalidUserServiceInputError,
  );
});

test("accepts an ID at the 256-code-unit boundary", () => {
  const id = "a".repeat(256);

  assert.deepEqual(buildProfileBatches([id])[0]?.ids, [id]);
});

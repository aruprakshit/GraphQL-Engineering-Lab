import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidBatchInputError, parseBatchInput } from "./batch-input.js";

// Validation preserves identifiers and duplicates.
// The storage lookup will deduplicate after validation.
test("preserves valid IDs without normalizing them", () => {
  const input = {
    ids: ["user-1", "User-1", " user-1 ", "user-1"],
  };

  const result = parseBatchInput(input);

  assert.deepEqual(result, input);
  assert.notEqual(result.ids, input.ids);
});

test("accepts one ID at the maximum ID length", () => {
  const id = "a".repeat(256);

  assert.deepEqual(parseBatchInput({ ids: [id] }), {
    ids: [id],
  });
});

test("accepts exactly 100 IDs", () => {
  const ids = Array.from({ length: 100 }, (_, index) => `user-${index}`);

  assert.deepEqual(parseBatchInput({ ids }), { ids });
});

// Reject malformed shapes and values before any storage lookup.
test("rejects invalid batch input", async (t) => {
  const cases: { name: string; input: unknown }[] = [
    { name: "null", input: null },
    { name: "a string", input: "user-1" },
    { name: "an array", input: ["user-1"] },
    { name: "missing ids", input: {} },
    {
      name: "unknown fields",
      input: { ids: ["user-1"], role: "admin" },
    },
    { name: "ids is not an array", input: { ids: "user-1" } },
    { name: "empty batch", input: { ids: [] } },
    {
      name: "more than 100 IDs",
      input: { ids: Array.from({ length: 101 }, () => "user-1") },
    },
    { name: "empty ID", input: { ids: [""] } },
    { name: "non-string ID", input: { ids: [123] } },
    { name: "null ID", input: { ids: [null] } },
    {
      name: "ID longer than 256 characters",
      input: { ids: ["a".repeat(257)] },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () => parseBatchInput(scenario.input),
        InvalidBatchInputError,
      );
    });
  }
});

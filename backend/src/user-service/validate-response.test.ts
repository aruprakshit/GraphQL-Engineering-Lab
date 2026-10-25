import assert from "node:assert/strict";
import { test } from "node:test";
import { validateProfileResponse } from "./validate-response.js";

test("accepts profiles in a different order from the request", () => {
  // Why: MongoDB and the service do not promise request ordering.
  // The later DataLoader integration will restore key order.

  // Arrange
  const requestedIds = ["user-1", "user-3"];
  const input = {
    users: [
      { id: "user-3", displayName: "Linus" },
      { id: "user-1", displayName: "Ada" },
    ],
  };

  // Act
  const profiles = validateProfileResponse(input, requestedIds);

  // Assert
  assert.deepEqual(profiles, input.users);
});

test("accepts omitted profiles", () => {
  // Why: a missing profile is a successful lookup outcome,
  // not an invalid response or dependency failure.

  // Arrange
  const requestedIds = ["user-1", "user-3"];
  const input = {
    users: [{ id: "user-1", displayName: "Ada" }],
  };

  // Act
  const profiles = validateProfileResponse(input, requestedIds);

  // Assert
  assert.deepEqual(profiles, input.users);
});

test("accepts an empty result", () => {
  // Why: none of the requested profiles may exist.

  // Arrange
  const requestedIds = ["missing-user"];
  const input = { users: [] };

  // Act
  const profiles = validateProfileResponse(input, requestedIds);

  // Assert
  assert.deepEqual(profiles, []);
});

test("accepts profile fields exactly at their limits", () => {
  // Why: both limits are inclusive. The name limit measures UTF-8
  // bytes, while the ID limit measures UTF-16 code units.

  // Arrange
  const id = "a".repeat(256);
  const displayName = "é".repeat(64);
  const input = { users: [{ id, displayName }] };

  // Act
  const profiles = validateProfileResponse(input, [id]);

  // Assert
  assert.equal(Buffer.byteLength(displayName, "utf8"), 128);
  assert.deepEqual(profiles, input.users);
});

test("rejects invalid batch responses", async (t) => {
  // Why: valid JSON is still untrusted. Reject malformed structures,
  // invalid fields, unexpected data, and inconsistent response IDs.

  // Arrange
  const cases: { name: string; input: unknown }[] = [
    { name: "null envelope", input: null },
    { name: "missing users", input: {} },
    { name: "users is not an array", input: { users: {} } },
    {
      name: "unexpected envelope field",
      input: { users: [], internalDetails: "private" },
    },
    {
      name: "null profile",
      input: { users: [null] },
    },
    {
      name: "missing display name",
      input: { users: [{ id: "user-1" }] },
    },
    {
      name: "non-string display name",
      input: { users: [{ id: "user-1", displayName: 123 }] },
    },
    {
      name: "empty display name",
      input: { users: [{ id: "user-1", displayName: "" }] },
    },
    {
      name: "display name exceeds UTF-8 byte limit",
      input: {
        users: [{ id: "user-1", displayName: "é".repeat(65) }],
      },
    },
    {
      name: "non-string ID",
      input: { users: [{ id: 123, displayName: "Ada" }] },
    },
    {
      name: "empty ID",
      input: { users: [{ id: "", displayName: "Ada" }] },
    },
    {
      name: "oversized ID",
      input: {
        users: [{ id: "a".repeat(257), displayName: "Ada" }],
      },
    },
    {
      name: "unexpected profile field",
      input: {
        users: [{ id: "user-1", displayName: "Ada", privateNote: "private" }],
      },
    },
    {
      name: "duplicate returned ID",
      input: {
        users: [
          { id: "user-1", displayName: "Ada" },
          { id: "user-1", displayName: "Ada" },
        ],
      },
    },
    {
      name: "unrequested returned ID",
      input: {
        users: [{ id: "user-2", displayName: "Grace" }],
      },
    },
  ];

  // Act and Assert: check each invalid response independently.
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      // Why: this response must fail with our generic dependency error,
      // rather than leaking validation details or accepting partial data.

      // Arrange
      const requestedIds = ["user-1", "user-3"];

      // Act: defer execution so assert.throws observes the exception.
      const action = () =>
        validateProfileResponse(scenario.input, requestedIds);

      // Assert
      assert.throws(action, {
        name: "UserServiceUnavailableError",
        message: "User service temporarily unavailable",
        reason: "INVALID_RESPONSE",
      });
    });
  }
});

test("checks returned IDs against this batch, not another batch", () => {
  // Why: user-3 might belong to another request in the same overall
  // lookup. It is still invalid in a response to the user-1 batch.

  // Arrange
  const batchIds = ["user-1"];
  const input = {
    users: [{ id: "user-3", displayName: "Linus" }],
  };

  // Act
  const action = () => validateProfileResponse(input, batchIds);

  // Assert
  assert.throws(action, {
    name: "UserServiceUnavailableError",
    message: "User service temporarily unavailable",
    reason: "INVALID_RESPONSE",
  });
});

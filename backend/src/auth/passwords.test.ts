/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Correct password | Returns true |
 * | Incorrect password | Returns false |
 * | Password whitespace | Exact password succeeds; trimmed password fails |
 * | Same password hashed twice | Fresh salts and hashes; both verify |
 * | Malformed credentials or unsupported parameters | Returns false |
 * | Tested password length limits | Hashing rejects; short-password verification returns false |
 *
 * Reading guide:
 * - The suite hashes a shared fixture once, then varies passwords or stored records.
 * - Password whitespace is significant; invalid stored parameters must not trigger costly hashing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./passwords.js";

// Purpose: Share one valid hash while testing verification, record validation, and password boundaries.
test("password hashing and verification", async (t) => {
  // ARRANGE: HASH ONE VALID PASSWORD FOR THE VERIFICATION CASES
  const password = "A long learning password!";
  const stored = await hashPassword(password);

  // Purpose: Successful verification checks the supplied password against its stored salt and parameters.
  await t.test("accepts the correct password", async () => {
    // ACT
    const matches = await verifyPassword(password, stored);

    // ASSERT
    assert.equal(matches, true);
  });

  // Purpose: A well-formed but wrong password must return false rather than authenticate.
  await t.test("rejects an incorrect password", async () => {
    // ACT
    const matches = await verifyPassword(
      "A different learning password!",
      stored,
    );

    // ASSERT
    assert.equal(matches, false);
  });

  // Purpose: Trimming would change the secret; only the original whitespace must verify.
  await t.test("preserves password whitespace", async () => {
    // ARRANGE
    const spacedPassword = "  A long learning password!  ";
    const spacedRecord = await hashPassword(spacedPassword);

    // ACT AND ASSERT
    assert.equal(await verifyPassword(spacedPassword, spacedRecord), true);
    assert.equal(
      await verifyPassword(spacedPassword.trim(), spacedRecord),
      false,
    );
  });

  // Purpose: Two hashes of one password should differ while both remain verifiable.
  await t.test("uses a fresh salt for the same password", async () => {
    // ACT
    const secondRecord = await hashPassword(password);

    // ASSERT
    assert.notEqual(secondRecord.salt, stored.salt);
    assert.notEqual(secondRecord.hash, stored.hash);
    assert.equal(await verifyPassword(password, secondRecord), true);
  });

  // Purpose: Reject corrupt records and unsafe parameters before attempting expensive work.
  await t.test("rejects malformed stored credentials", async () => {
    // ARRANGE
    // Treat stored records as untrusted input, including unsupported hashing parameters.
    const malformedRecords: unknown[] = [
      null,
      {},
      { ...stored, algorithm: "unknown" },
      { ...stored, version: 2 },
      { ...stored, salt: "invalid" },
      { ...stored, hash: "00" },
      { ...stored, parameters: null },
      {
        ...stored,
        parameters: { ...stored.parameters, N: 2 ** 30 },
      },
    ];

    // ACT AND ASSERT
    for (const record of malformedRecords) {
      assert.equal(await verifyPassword(password, record), false);
    }
  });

  // Purpose: Hash creation rejects bad input; verification returns false for the tested short password.
  await t.test("rejects passwords outside the input limits", async () => {
    // ACT AND ASSERT
    await assert.rejects(hashPassword("short"), /15 and 128/);
    await assert.rejects(hashPassword("x".repeat(129)), /15 and 128/);

    assert.equal(await verifyPassword("short", stored), false);
  });
});

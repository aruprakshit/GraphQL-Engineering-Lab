import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import type { UserDocument } from "../../src/models.js";
import type {
  AccountDocument,
  SessionDocument,
} from "../../src/auth/models.js";
import { hashPassword } from "../../src/auth/passwords.js";
import {
  hashSessionToken,
  generateSessionToken,
} from "../../src/auth/session-tokens.js";
import {
  createSession,
  resolveSession,
  revokeSession,
} from "../../src/auth/sessions.js";

test("creates a hashed session with eight-hour expiry and resolves its actor", async (t) => {
  // 1. ARRANGE: REQUIRE THE DEDICATED TEST DATABASE
  const url = process.env.TEST_MONGO_URL;
  const databaseName = process.env.TEST_MONGO_DB;

  if (!url || databaseName !== "graphql_engineering_lab_test") {
    throw new Error("Dedicated integration-test database is required");
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 3000,
  });

  const userId = `session-test-${randomUUID()}`;
  const database = client.db(databaseName);

  try {
    await client.connect();

    // 2. ARRANGE: CREATE INDEPENDENT USER AND ACCOUNT FIXTURES
    const password = await hashPassword("Integration fixture password!");

    await database.collection<UserDocument>("users").insertOne({
      _id: userId,
      name: "Session test user",
    });

    await database.collection<AccountDocument>("accounts").insertOne({
      _id: userId,
      username: userId,
      role: "user",
      password,
    });

    const now = new Date();

    // 3. ACT: CREATE AND RESOLVE A SESSION
    const created = await createSession(database, userId, now);
    const tokenHash = hashSessionToken(created.token);

    const stored = await database
      .collection<SessionDocument>("sessions")
      .findOne({ _id: tokenHash });

    const actor = await resolveSession(database, created.token, now);

    // 4. ASSERT: VERIFY STORAGE, EXPIRY, AND IDENTITY
    assert.ok(stored, "Session document must exist");

    assert.deepEqual(Object.keys(stored).sort(), [
      "_id",
      "accountId",
      "createdAt",
      "expiresAt",
    ]);

    assert.equal(stored._id, tokenHash);
    assert.notEqual(stored._id, created.token);
    assert.equal(stored.accountId, userId);
    assert.equal(stored.createdAt.getTime(), now.getTime());

    const expectedExpiry = now.getTime() + 8 * 60 * 60 * 1000;

    assert.equal(stored.expiresAt.getTime(), expectedExpiry);
    assert.equal(created.expiresAt.getTime(), expectedExpiry);

    assert.deepEqual(actor, {
      userId,
      role: "user",
    });

    await t.test("rejects unknown and malformed tokens", async () => {
      // ACT AND ASSERT
      assert.equal(
        await resolveSession(database, generateSessionToken(), now),
        null,
      );

      assert.equal(await resolveSession(database, "invalid", now), null);
      assert.equal(await resolveSession(database, undefined, now), null);
    });

    await t.test("enforces expiry without waiting for cleanup", async () => {
      // ARRANGE
      const session = await createSession(database, userId, now);

      // ACT AND ASSERT: VALID JUST BEFORE EXPIRY
      assert.deepEqual(
        await resolveSession(
          database,
          session.token,
          new Date(session.expiresAt.getTime() - 1),
        ),
        { userId, role: "user" },
      );

      // ACT AND ASSERT: INVALID AT THE EXACT EXPIRY TIME
      assert.equal(
        await resolveSession(database, session.token, session.expiresAt),
        null,
      );

      // THE DOCUMENT STILL EXISTS: LOOKUP ENFORCED THE EXPIRY
      assert.ok(
        await database.collection<SessionDocument>("sessions").findOne({
          _id: hashSessionToken(session.token),
        }),
      );
    });

    await t.test("revokes one session without affecting another", async () => {
      // ARRANGE
      const first = await createSession(database, userId, now);
      const second = await createSession(database, userId, now);

      assert.notEqual(first.token, second.token);

      // ACT: REPEATED REVOCATION MUST BE SAFE
      await revokeSession(database, first.token);
      await revokeSession(database, first.token);

      // ASSERT
      assert.equal(await resolveSession(database, first.token, now), null);

      assert.deepEqual(await resolveSession(database, second.token, now), {
        userId,
        role: "user",
      });

      assert.equal(
        await database.collection<SessionDocument>("sessions").findOne({
          _id: hashSessionToken(first.token),
        }),
        null,
      );
    });

    await t.test("reads the current account role", async () => {
      // ARRANGE
      const session = await createSession(database, userId, now);

      try {
        // ACT: CHANGE ROLE AFTER SESSION CREATION
        await database
          .collection<AccountDocument>("accounts")
          .updateOne({ _id: userId }, { $set: { role: "admin" } });

        // ASSERT
        assert.deepEqual(await resolveSession(database, session.token, now), {
          userId,
          role: "admin",
        });
      } finally {
        await database
          .collection<AccountDocument>("accounts")
          .updateOne({ _id: userId }, { $set: { role: "user" } });
      }
    });

    await t.test("rejects a session whose public user is missing", async () => {
      // ARRANGE
      const session = await createSession(database, userId, now);

      try {
        // ACT
        await database
          .collection<UserDocument>("users")
          .deleteOne({ _id: userId });

        // ASSERT
        assert.equal(await resolveSession(database, session.token, now), null);

        await assert.rejects(
          createSession(database, userId, now),
          /unavailable account/,
        );
      } finally {
        await database.collection<UserDocument>("users").insertOne({
          _id: userId,
          name: "Session test user",
        });
      }
    });

    await t.test("rejects a session whose account is missing", async () => {
      // ARRANGE
      const session = await createSession(database, userId, now);

      const account = await database
        .collection<AccountDocument>("accounts")
        .findOne({ _id: userId });

      assert.ok(account);

      try {
        // ACT
        await database
          .collection<AccountDocument>("accounts")
          .deleteOne({ _id: userId });

        // ASSERT
        assert.equal(await resolveSession(database, session.token, now), null);

        await assert.rejects(
          createSession(database, userId, now),
          /unavailable account/,
        );
      } finally {
        // RESTORE THE FIXTURE WITHOUT PRINTING ITS CREDENTIALS
        await database
          .collection<AccountDocument>("accounts")
          .insertOne(account);
      }
    });
  } finally {
    // 5. CLEAN UP ONLY THIS TEST'S FIXTURES
    try {
      await database
        .collection<SessionDocument>("sessions")
        .deleteMany({ accountId: userId });

      await database
        .collection<AccountDocument>("accounts")
        .deleteOne({ _id: userId });

      await database
        .collection<UserDocument>("users")
        .deleteOne({ _id: userId });
    } finally {
      await client.close();
    }
  }
});

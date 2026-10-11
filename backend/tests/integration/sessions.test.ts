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
import { hashSessionToken } from "../../src/auth/session-tokens.js";
import { createSession, resolveSession } from "../../src/auth/sessions.js";

test("creates a hashed session with eight-hour expiry and resolves its actor", async () => {
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

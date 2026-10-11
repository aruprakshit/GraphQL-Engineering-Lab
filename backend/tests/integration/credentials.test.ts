import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import type { UserDocument } from "../../src/models.js";
import type { AccountDocument } from "../../src/auth/models.js";
import {
  createCredentialVerifier,
  InvalidLoginInputError,
} from "../../src/auth/credentials.js";
import { hashPassword } from "../../src/auth/passwords.js";

test("credential verification", async (t) => {
  // 1. ARRANGE: REQUIRE THE ISOLATED TEST DATABASE
  const url = process.env.TEST_MONGO_URL;
  const databaseName = process.env.TEST_MONGO_DB;

  if (!url || databaseName !== "graphql_engineering_lab_test") {
    throw new Error("Dedicated integration-test database is required");
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 3000,
  });
  const database = client.db(databaseName);

  const userId = `credential-test-${randomUUID()}`;
  const username = `test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const password = "Credential fixture password!";

  try {
    await client.connect();

    await database.collection<UserDocument>("users").insertOne({
      _id: userId,
      name: "Credential test user",
    });

    await database.collection<AccountDocument>("accounts").insertOne({
      _id: userId,
      username,
      role: "user",
      password: await hashPassword(password),
    });

    const verifyCredentials = await createCredentialVerifier(database);

    await t.test("returns only identity for valid credentials", async () => {
      // ACT: ALSO EXERCISE USERNAME NORMALIZATION
      const identity = await verifyCredentials({
        username: ` ${username.toUpperCase()} `,
        password,
      });

      // ASSERT
      assert.deepEqual(identity, {
        userId,
        name: "Credential test user",
        role: "user",
      });
    });

    await t.test("rejects incorrect passwords", async () => {
      assert.equal(
        await verifyCredentials({
          username,
          password: "A different fixture password!",
        }),
        null,
      );
    });

    await t.test("rejects unknown usernames", async () => {
      assert.equal(
        await verifyCredentials({
          username: `other_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
          password,
        }),
        null,
      );
    });

    await t.test("rejects invalid credential input", async () => {
      await assert.rejects(
        verifyCredentials({ username: "!", password }),
        InvalidLoginInputError,
      );

      await assert.rejects(
        verifyCredentials({ username, password: "short" }),
        InvalidLoginInputError,
      );
    });

    await t.test("reads the current account role", async () => {
      try {
        await database
          .collection<AccountDocument>("accounts")
          .updateOne({ _id: userId }, { $set: { role: "admin" } });

        assert.deepEqual(await verifyCredentials({ username, password }), {
          userId,
          name: "Credential test user",
          role: "admin",
        });
      } finally {
        await database
          .collection<AccountDocument>("accounts")
          .updateOne({ _id: userId }, { $set: { role: "user" } });
      }
    });

    await t.test("rejects an account without a public user", async () => {
      try {
        await database
          .collection<UserDocument>("users")
          .deleteOne({ _id: userId });

        assert.equal(await verifyCredentials({ username, password }), null);
      } finally {
        await database.collection<UserDocument>("users").insertOne({
          _id: userId,
          name: "Credential test user",
        });
      }
    });

    await t.test("does not create sessions during verification", async () => {
      assert.equal(
        await database.collection("sessions").countDocuments({
          accountId: userId,
        }),
        0,
      );
    });
  } finally {
    try {
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

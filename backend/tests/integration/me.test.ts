/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Valid session cookie | Returns public user identity and role |
 * | Missing, malformed, or unknown session token | Returns me: null without errors |
 * | Expired session | Returns me: null |
 * | Revoked session | Returns me: null |
 * | Account role changes after login | Next request returns the updated role |
 * | Session account is deleted | Returns me: null |
 * | Public user is deleted | Returns me: null |
 * | Authentication storage fails | Returns SERVICE_UNAVAILABLE at me instead of anonymous access |
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { graphql } from "graphql";
import { MongoClient } from "mongodb";
import { schema } from "../../src/graphql.js";
import { rootValue } from "../../src/resolvers/index.js";
import type { GraphQLContext } from "../../src/graphql-context.js";
import type { UserDocument } from "../../src/models.js";
import type {
  AccountDocument,
  SessionDocument,
} from "../../src/auth/models.js";
import { hashPassword } from "../../src/auth/passwords.js";
import {
  createSession,
  resolveSession,
  revokeSession,
} from "../../src/auth/sessions.js";
import { generateSessionToken } from "../../src/auth/session-tokens.js";
import { readSessionCookie } from "../../src/auth/session-cookie.js";
import { createRequestActor } from "../../src/auth/request-actor.js";
import { createUserLoader } from "../../src/loaders.js";

const query = `
  query CurrentUser {
    me {
      id
      name
      role
    }
  }
`;

test("GraphQL current user", async (t) => {
  const url = process.env.TEST_MONGO_URL;
  const databaseName = process.env.TEST_MONGO_DB;

  if (!url || databaseName !== "graphql_engineering_lab_test") {
    throw new Error("Dedicated integration-test database is required");
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 3000,
  });

  const database = client.db(databaseName);
  const userId = `me-test-${randomUUID()}`;

  const user: UserDocument = {
    _id: userId,
    name: "Current user fixture",
  };

  try {
    await client.connect();

    const account: AccountDocument = {
      _id: userId,
      username: `test_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      role: "user",
      password: await hashPassword("Current user fixture password!"),
    };

    await database.collection<UserDocument>("users").insertOne(user);
    await database.collection<AccountDocument>("accounts").insertOne(account);

    async function executeMe(
      cookieHeader?: string,
      requestDatabase = database,
    ) {
      const token = readSessionCookie(cookieHeader);

      const unexpectedLoginCall = (): never => {
        throw new Error("Query.me must not invoke login helpers");
      };

      const context: GraphQLContext = {
        requestId: randomUUID(),
        database: requestDatabase,
        logDatabaseCall: () => {},
        userLoader: createUserLoader(requestDatabase, () => {}, "me-test"),
        getActor: createRequestActor(() =>
          resolveSession(requestDatabase, token),
        ),
        verifyCredentials: async () => unexpectedLoginCall(),
        beginLogin: unexpectedLoginCall,
        assertAuthRequest: unexpectedLoginCall,
        setSessionCookie: unexpectedLoginCall,
        sessionToken: null,
        clearSessionCookie: () => {
          throw new Error("Login must not clear the session cookie");
        },
      };

      return graphql({
        schema,
        rootValue,
        source: query,
        contextValue: context,
      });
    }

    await t.test("returns public identity for a valid session", async () => {
      const session = await createSession(database, userId);

      const result = await executeMe(`session=${session.token}`);

      assert.equal(result.errors, undefined);
      assert.equal(
        JSON.stringify(result.data),
        JSON.stringify({
          me: {
            id: userId,
            name: user.name,
            role: "USER",
          },
        }),
      );
    });

    await t.test(
      "returns null for missing, malformed, or unknown tokens",
      async () => {
        for (const cookie of [
          undefined,
          "theme=dark",
          "session=invalid",
          `session=${generateSessionToken()}`,
        ]) {
          const result = await executeMe(cookie);

          assert.equal(result.errors, undefined);
          assert.equal(result.data?.me, null);
        }
      },
    );

    await t.test("returns null for an expired session", async () => {
      // CREATE AN ALREADY EXPIRED SESSION WITHOUT WAITING.
      const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000);
      const session = await createSession(database, userId, nineHoursAgo);

      const result = await executeMe(`session=${session.token}`);

      assert.equal(result.errors, undefined);
      assert.equal(result.data?.me, null);
    });

    await t.test("returns null for a revoked session", async () => {
      const session = await createSession(database, userId);

      await revokeSession(database, session.token);

      const result = await executeMe(`session=${session.token}`);

      assert.equal(result.errors, undefined);
      assert.equal(result.data?.me, null);
    });

    await t.test("reads the current role on the next request", async () => {
      const session = await createSession(database, userId);
      const cookie = `session=${session.token}`;

      const before = await executeMe(cookie);

      assert.equal(before.errors, undefined);
      assert.equal(
        JSON.stringify(before.data),
        JSON.stringify({
          me: { id: userId, name: user.name, role: "USER" },
        }),
      );

      try {
        await database
          .collection<AccountDocument>("accounts")
          .updateOne({ _id: userId }, { $set: { role: "admin" } });

        const after = await executeMe(cookie);

        assert.equal(after.errors, undefined);
        assert.equal(
          JSON.stringify(after.data),
          JSON.stringify({
            me: { id: userId, name: user.name, role: "ADMIN" },
          }),
        );
      } finally {
        await database
          .collection<AccountDocument>("accounts")
          .updateOne({ _id: userId }, { $set: { role: "user" } });
      }
    });

    await t.test("returns null when the account is deleted", async () => {
      const session = await createSession(database, userId);

      try {
        await database
          .collection<AccountDocument>("accounts")
          .deleteOne({ _id: userId });

        const result = await executeMe(`session=${session.token}`);

        assert.equal(result.errors, undefined);
        assert.equal(result.data?.me, null);
      } finally {
        await database
          .collection<AccountDocument>("accounts")
          .insertOne(account);
      }
    });

    await t.test("returns null when the public user is deleted", async () => {
      const session = await createSession(database, userId);

      try {
        await database
          .collection<UserDocument>("users")
          .deleteOne({ _id: userId });

        const result = await executeMe(`session=${session.token}`);

        assert.equal(result.errors, undefined);
        assert.equal(result.data?.me, null);
      } finally {
        await database.collection<UserDocument>("users").insertOne(user);
      }
    });

    await t.test(
      "reports authentication storage failure instead of anonymous access",
      async () => {
        const session = await createSession(database, userId);

        const unavailableClient = new MongoClient(url);
        const unavailableDatabase = unavailableClient.db(databaseName);

        await unavailableClient.close();

        const result = await executeMe(
          `session=${session.token}`,
          unavailableDatabase,
        );

        assert.equal(result.data?.me, null);
        assert.equal(result.errors?.length, 1);
        assert.equal(
          result.errors?.[0]?.extensions.code,
          "SERVICE_UNAVAILABLE",
        );
        assert.equal(
          result.errors?.[0]?.message,
          "Authentication temporarily unavailable",
        );
        assert.deepEqual(result.errors?.[0]?.path, ["me"]);
      },
    );
  } finally {
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

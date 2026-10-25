/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Valid session with another active session | Returns logout: true, clears cookie, and revokes only the supplied session |
 * | Missing, malformed, or already revoked session | Returns logout: true and clears cookie |
 * | Request missing the required authentication header | Returns FORBIDDEN without revoking session or clearing cookie |
 * | Session storage fails | Returns generic SERVICE_UNAVAILABLE, preserves session, and does not clear cookie |
 *
 * Reading guide:
 * - The cookie callback counts clearing attempts; MongoDB proves actual revocation.
 * - Logout must not verify passwords or resolve an actor, so unrelated helpers throw if called.
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
import { createAuthRequestGuard } from "../../src/auth/request-guard.js";
import {
  createSession,
  resolveSession,
  revokeSession,
} from "../../src/auth/sessions.js";
import { readSessionCookie } from "../../src/auth/session-cookie.js";
import { createTestProfileLoader } from "../helpers/profile-loader.js";

// Purpose: Compare cookie-clearing callbacks with actual MongoDB revocation, not response data alone.
test("GraphQL logout", async (t) => {
  const url = process.env.TEST_MONGO_URL;
  const databaseName = process.env.TEST_MONGO_DB;

  if (!url || databaseName !== "graphql_engineering_lab_test") {
    throw new Error("Dedicated integration-test database is required");
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 3000,
  });

  const database = client.db(databaseName);
  const userId = `logout-test-${randomUUID()}`;

  try {
    await client.connect();

    await database.collection<UserDocument>("users").insertOne({
      _id: userId,
      name: "Logout fixture",
    });

    await database.collection<AccountDocument>("accounts").insertOne({
      _id: userId,
      username: `test_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      role: "user",
      password: await hashPassword("Logout fixture password!"),
    });

    async function executeLogout(
      cookieHeader?: string,
      authHeader = "1",
      requestDatabase = database,
    ) {
      // A successful result must clear the cookie once; rejected operations must not clear it.
      let clearCalls = 0;

      const unexpectedCall = (): never => {
        throw new Error("Logout invoked an unrelated authentication helper");
      };

      const guard = createAuthRequestGuard("http://localhost:4000");

      const context: GraphQLContext = {
        requestId: randomUUID(),
        database: requestDatabase,
        logDatabaseCall: () => {},
        userLoader: createTestProfileLoader(requestDatabase, "logout-test"),
        sessionToken: readSessionCookie(cookieHeader),
        getActor: async () => unexpectedCall(),
        verifyCredentials: async () => unexpectedCall(),
        beginLogin: unexpectedCall,
        setSessionCookie: unexpectedCall,
        assertAuthRequest: () => {
          guard({
            method: "POST",
            origin: "http://localhost:4000",
            authHeader,
          });
        },
        clearSessionCookie: () => {
          clearCalls += 1;
        },
      };

      const result = await graphql({
        schema,
        rootValue,
        source: "mutation { logout }",
        contextValue: context,
      });

      return { result, clearCalls };
    }

    // Purpose: Keep a second active session to prove logout targets only the supplied token.
    await t.test("revokes only the supplied session", async () => {
      const first = await createSession(database, userId);
      const second = await createSession(database, userId);

      const { result, clearCalls } = await executeLogout(
        `session=${first.token}`,
      );

      assert.equal(result.errors, undefined);
      assert.equal(result.data?.logout, true);
      assert.equal(clearCalls, 1);

      assert.equal(await resolveSession(database, first.token), null);
      assert.deepEqual(await resolveSession(database, second.token), {
        userId,
        role: "user",
      });
    });

    // Purpose: Repeated logout is safe when there is no active session left to revoke.
    await t.test(
      "succeeds for missing, malformed, or revoked sessions",
      async () => {
        const session = await createSession(database, userId);
        await revokeSession(database, session.token);

        for (const cookie of [
          undefined,
          "session=invalid",
          `session=${session.token}`,
        ]) {
          const { result, clearCalls } = await executeLogout(cookie);

          assert.equal(result.errors, undefined);
          assert.equal(result.data?.logout, true);
          assert.equal(clearCalls, 1);
        }
      },
    );

    // Purpose: A rejected request must retain both the usable session and its cookie.
    await t.test(
      "rejects an untrusted request without revoking its session",
      async () => {
        const session = await createSession(database, userId);

        const { result, clearCalls } = await executeLogout(
          `session=${session.token}`,
          "",
        );

        assert.equal(result.data?.logout, null);
        assert.equal(result.errors?.[0]?.extensions.code, "FORBIDDEN");
        assert.equal(clearCalls, 0);

        assert.deepEqual(await resolveSession(database, session.token), {
          userId,
          role: "user",
        });
      },
    );

    // Purpose: Do not clear the client cookie or claim revocation when storage could not be reached.
    await t.test("does not clear the cookie when storage fails", async () => {
      const session = await createSession(database, userId);

      const unavailableClient = new MongoClient(url);
      const unavailableDatabase = unavailableClient.db(databaseName);
      await unavailableClient.close();

      const { result, clearCalls } = await executeLogout(
        `session=${session.token}`,
        "1",
        unavailableDatabase,
      );

      assert.equal(result.data?.logout, null);
      assert.equal(result.errors?.length, 1);
      assert.equal(result.errors?.[0]?.extensions.code, "SERVICE_UNAVAILABLE");
      assert.equal(
        result.errors?.[0]?.message,
        "Logout temporarily unavailable",
      );
      assert.equal(clearCalls, 0);

      // FAILURE MUST NOT CLAIM THAT THE SESSION WAS REVOKED.
      assert.deepEqual(await resolveSession(database, session.token), {
        userId,
        role: "user",
      });
    });
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

/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Valid credentials through GraphQL | Public identity; stored session passed to cookie callback; no token in data |
 * | Wrong password or unknown username | Same UNAUTHENTICATED error; no session or cookie issued |
 * | Short password | BAD_USER_INPUT; no session or cookie issued |
 * | Missing custom header | FORBIDDEN; no session or cookie issued |
 * | Two login aliases | First succeeds; second BAD_USER_INPUT; one session issued |
 * | Requests sharing two-attempt IP allowance | Third request TOO_MANY_REQUESTS with retry delay |
 * | Simulated verification capacity exhaustion | SERVICE_UNAVAILABLE with retry delay; no session or cookie issued |
 * | Closed database during session creation | Generic SERVICE_UNAVAILABLE; no session or cookie issued |
 *
 * Reading guide:
 * - The real GraphQL schema and rootValue must dispatch login to its registered resolver.
 * - The cookie callback captures issued sessions; separate HTTP tests check cookie attributes.
 * - Injected failures isolate error mapping, while MongoDB confirms whether sessions were created.
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
  CreatedSession,
  SessionDocument,
} from "../../src/auth/models.js";
import { createCredentialVerifier } from "../../src/auth/credentials.js";
import { hashPassword } from "../../src/auth/passwords.js";
import { hashSessionToken } from "../../src/auth/session-tokens.js";
import { createUserLoader } from "../../src/loaders.js";
import { createAuthRequestGuard } from "../../src/auth/request-guard.js";
import { createLoginAttemptGuard } from "../../src/auth/login-attempt.js";
import { createLoginRateLimiter } from "../../src/auth/login-rate-limit.js";
import { CapacityExceededError } from "../../src/auth/concurrency.js";

const mutation = `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      user {
        id
        name
        role
      }
    }
  }
`;

interface LoginTestOptions {
  source?: string;
  rateLimiter?: ReturnType<typeof createLoginRateLimiter>;
  verifyCredentials?: GraphQLContext["verifyCredentials"];
  database?: GraphQLContext["database"];
}

// Purpose: Execute the registered GraphQL mutation with real storage and captured cookie side effects.
test("GraphQL login", async (t) => {
  const url = process.env.TEST_MONGO_URL;
  const databaseName = process.env.TEST_MONGO_DB;

  if (!url || databaseName !== "graphql_engineering_lab_test") {
    throw new Error("Dedicated integration-test database is required");
  }

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 3000,
  });

  const database = client.db(databaseName);
  const userId = `login-test-${randomUUID()}`;
  const username = `test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const password = "Login integration fixture password!";

  try {
    await client.connect();

    await database.collection<UserDocument>("users").insertOne({
      _id: userId,
      name: "Login test user",
    });

    await database.collection<AccountDocument>("accounts").insertOne({
      _id: userId,
      username,
      role: "user",
      password: await hashPassword(password),
    });

    const verifyCredentials = await createCredentialVerifier(database);

    // EACH CALL REPRESENTS A NEW REQUEST.
    async function executeLogin(
      input: { username: string; password: string },
      authHeader: string | undefined = "1",
      options: LoginTestOptions = {},
    ) {
      // Capture the cookie side effect without opening an HTTP server or exposing a real token.
      const issuedSessions: CreatedSession[] = [];

      const assertAuthRequest = createAuthRequestGuard("http://localhost:4000");

      const context: GraphQLContext = {
        requestId: randomUUID(),
        database: options.database ?? database,
        logDatabaseCall: () => {},
        userLoader: createUserLoader(database, () => {}, "login-test"),
        verifyCredentials: options.verifyCredentials ?? verifyCredentials,
        assertAuthRequest: () => {
          assertAuthRequest({
            method: "POST",
            origin: "http://localhost:4000",
            authHeader,
          });
        },
        beginLogin: createLoginAttemptGuard({
          assertAuthRequest: () => {
            assertAuthRequest({
              method: "POST",
              origin: "http://localhost:4000",
              authHeader,
            });
          },
          // Most cases use independent limits; the IP-limit test explicitly supplies a shared instance.
          rateLimiter: options.rateLimiter ?? createLoginRateLimiter(),
          clientIp: "test-client",
        }),
        setSessionCookie: (session) => {
          issuedSessions.push(session);
        },
        getActor: async () => null,
        sessionToken: null,
        clearSessionCookie: () => {
          throw new Error("Login must not clear the session cookie");
        },
      };

      const result = await graphql({
        schema,
        rootValue,
        source: options.source ?? mutation,
        variableValues: { input },
        contextValue: context,
      });

      return { result, issuedSessions };
    }

    const countSessions = () =>
      database
        .collection<SessionDocument>("sessions")
        .countDocuments({ accountId: userId });

    // Purpose: A successful response requires a persisted hashed session and exactly one issued cookie.
    await t.test("returns identity and issues a stored session", async () => {
      const before = await countSessions();

      const { result, issuedSessions } = await executeLogin({
        username,
        password,
      });

      assert.equal(result.errors, undefined);
      assert.ok(result.data);

      // GRAPHQL RESULT OBJECTS MAY HAVE NULL PROTOTYPES.
      assert.equal(
        JSON.stringify(result.data),
        JSON.stringify({
          login: {
            user: {
              id: userId,
              name: "Login test user",
              role: "USER",
            },
          },
        }),
      );

      assert.equal(issuedSessions.length, 1);

      const session = issuedSessions[0];
      assert.ok(session);

      const stored = await database
        .collection<SessionDocument>("sessions")
        .findOne({ _id: hashSessionToken(session.token) });

      assert.ok(stored);
      assert.equal(stored.accountId, userId);
      assert.equal(stored.expiresAt.getTime(), session.expiresAt.getTime());
      assert.equal(await countSessions(), before + 1);

      // THE TOKEN BELONGS IN THE COOKIE, NOT GRAPHQL DATA.
      assert.equal(JSON.stringify(result.data).includes(session.token), false);
    });

    // Purpose: Keep public messages identical so callers cannot distinguish unknown accounts.
    await t.test(
      "rejects wrong and unknown credentials identically",
      async () => {
        const before = await countSessions();

        const unknownUsername = `other_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

        for (const input of [
          { username, password: "An incorrect fixture password!" },
          { username: unknownUsername, password },
        ]) {
          const { result, issuedSessions } = await executeLogin(input);

          assert.equal(result.data?.login, null);
          assert.equal(result.errors?.length, 1);
          assert.equal(result.errors?.[0]?.extensions.code, "UNAUTHENTICATED");
          assert.equal(
            result.errors?.[0]?.message,
            "Invalid username or password",
          );
          assert.equal(issuedSessions.length, 0);
        }

        assert.equal(await countSessions(), before);
      },
    );

    // Purpose: Invalid input must not create a session or issue a cookie.
    await t.test("rejects invalid password input", async () => {
      const before = await countSessions();

      const { result, issuedSessions } = await executeLogin({
        username,
        password: "short",
      });

      assert.equal(result.data?.login, null);
      assert.equal(result.errors?.[0]?.extensions.code, "BAD_USER_INPUT");
      assert.equal(issuedSessions.length, 0);
      assert.equal(await countSessions(), before);
    });

    // Purpose: Reject the request before credential verification can produce a session.
    await t.test("rejects a request without the custom header", async () => {
      const before = await countSessions();

      const { result, issuedSessions } = await executeLogin(
        { username, password },
        "",
      );

      assert.equal(result.data?.login, null);
      assert.equal(result.errors?.[0]?.extensions.code, "FORBIDDEN");
      assert.equal(issuedSessions.length, 0);
      assert.equal(await countSessions(), before);
    });

    // Purpose: Top-level mutations execute sequentially; the first session survives the rejected alias.
    await t.test(
      "allows only the first login alias to attempt login",
      async () => {
        const before = await countSessions();

        const { result, issuedSessions } = await executeLogin(
          { username, password },
          "1",
          {
            source: /* GraphQL */ `
              mutation LoginTwice($input: LoginInput!) {
                first: login(input: $input) {
                  user {
                    id
                  }
                }
                second: login(input: $input) {
                  user {
                    id
                  }
                }
              }
            `,
          },
        );

        assert.equal(
          JSON.stringify(result.data),
          JSON.stringify({
            first: { user: { id: userId } },
            second: null,
          }),
        );

        assert.equal(result.errors?.length, 1);
        assert.deepEqual(result.errors?.[0]?.path, ["second"]);
        assert.equal(result.errors?.[0]?.extensions.code, "BAD_USER_INPUT");
        assert.equal(issuedSessions.length, 1);
        assert.equal(await countSessions(), before + 1);
      },
    );
    // Purpose: Reuse one limiter across helper calls so attempt counts persist across requests.
    await t.test(
      "shares the login limit across requests from one IP",
      async () => {
        const before = await countSessions();
        const rateLimiter = createLoginRateLimiter({ limit: 2 });

        // INVALID INPUT STILL CONSUMES AN ATTEMPT, WITHOUT EXPENSIVE HASHING.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const { result, issuedSessions } = await executeLogin(
            { username, password: "short" },
            "1",
            { rateLimiter },
          );

          assert.equal(result.errors?.[0]?.extensions.code, "BAD_USER_INPUT");
          assert.equal(issuedSessions.length, 0);
        }

        const { result, issuedSessions } = await executeLogin(
          { username, password },
          "1",
          { rateLimiter },
        );

        assert.equal(result.data?.login, null);
        assert.equal(result.errors?.[0]?.extensions.code, "TOO_MANY_REQUESTS");

        const retryAfterSeconds =
          result.errors?.[0]?.extensions.retryAfterSeconds;

        assert.equal(typeof retryAfterSeconds, "number");
        assert.ok(Number(retryAfterSeconds) > 0);

        assert.equal(issuedSessions.length, 0);
        assert.equal(await countSessions(), before);
      },
    );

    // Purpose: Inject capacity exhaustion to test error mapping independently of limiter scheduling.
    await t.test(
      "reports exhausted password verification capacity",
      async () => {
        const before = await countSessions();

        const { result, issuedSessions } = await executeLogin(
          { username, password },
          "1",
          {
            verifyCredentials: async () => {
              throw new CapacityExceededError();
            },
          },
        );

        assert.equal(result.data?.login, null);
        assert.equal(
          result.errors?.[0]?.extensions.code,
          "SERVICE_UNAVAILABLE",
        );
        assert.equal(result.errors?.[0]?.extensions.retryAfterSeconds, 1);
        assert.equal(issuedSessions.length, 0);
        assert.equal(await countSessions(), before);
      },
    );
    // Purpose: A verified password is not success when session storage fails; no cookie may be issued.
    await t.test(
      "hides session database failures and issues no cookie",
      async () => {
        const before = await countSessions();

        const unavailableClient = new MongoClient(url);
        const unavailableDatabase = unavailableClient.db(databaseName);

        await unavailableClient.close();

        const { result, issuedSessions } = await executeLogin(
          { username, password },
          "1",
          {
            database: unavailableDatabase,
            verifyCredentials: async () => ({
              userId,
              name: "Login test user",
              role: "user",
            }),
          },
        );

        assert.equal(result.data?.login, null);
        assert.equal(result.errors?.length, 1);
        assert.equal(
          result.errors?.[0]?.extensions.code,
          "SERVICE_UNAVAILABLE",
        );
        assert.equal(
          result.errors?.[0]?.message,
          "Login temporarily unavailable",
        );

        assert.equal(issuedSessions.length, 0);
        assert.equal(await countSessions(), before);
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

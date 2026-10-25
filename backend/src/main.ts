import express from "express";
import { connectDatabase, database } from "./database.js";
import { createHandler } from "graphql-http/lib/use/express";
import { schema } from "./graphql.js";
import { rootValue } from "./resolvers/index.js";
import { ruruHTML } from "ruru/server";
import { serveStatic } from "ruru/static";
import { requestLogging } from "./request-logging.js";
import { createCredentialVerifier } from "./auth/credentials.js";
import { setSessionCookie, clearSessionCookie } from "./auth/cookies.js";
import type { CreatedSession } from "./auth/models.js";
import { createAuthRequestGuard } from "./auth/request-guard.js";
import { createLoginRateLimiter } from "./auth/login-rate-limit.js";
import { createLoginAttemptGuard } from "./auth/login-attempt.js";
import { readSessionCookie } from "./auth/session-cookie.js";
import { resolveSession } from "./auth/sessions.js";
import { createRequestActor } from "./auth/request-actor.js";
import { executeWithQueryBudget } from "./execute-with-query-budget.js";
import { createProfileLoader } from "./user-service/loader.js";
import { createUserServiceClient } from "./user-service/client.js";
import { parseUserServiceOptions } from "./user-service/config.js";

interface LearningCheck {
  _id: string;
  message: string;
}

const userServiceClient = createUserServiceClient(
  parseUserServiceOptions({
    baseUrl: process.env.USER_SERVICE_URL,
    serviceToken: process.env.USER_SERVICE_TOKEN,
  }),
);

// 1. CREATE THE APPLICATION
const app = express();
app.use(requestLogging);

let verifyCredentials: Awaited<ReturnType<typeof createCredentialVerifier>>;

const secureCookies = process.env.NODE_ENV === "production";

const allowedAuthOrigin = process.env.AUTH_ALLOWED_ORIGIN;

if (!allowedAuthOrigin) {
  throw new Error("AUTH_ALLOWED_ORIGIN must be configured");
}

const assertAuthRequest = createAuthRequestGuard(allowedAuthOrigin);
const loginRateLimiter = createLoginRateLimiter();

// 2. REGISTER THE HEALTH ROUTE
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "graphql-engineering-lab",
  });
});

// READ THE STORED LEARNING CHECK FROM MONGODB
app.get("/learning-check", async (_req, res) => {
  try {
    // 1. FIND THE DOCUMENT
    const collection = database.collection<LearningCheck>("learning_checks");

    const document = await collection.findOne({
      _id: "persistence-check",
    });

    // 2. HANDLE A MISSING DOCUMENT
    if (!document) {
      res.status(404).json({
        error: "Learning check not found",
      });
      return;
    }

    // 3. RETURN THE DOCUMENT
    res.json(document);
  } catch (error: unknown) {
    // 4. LOG THE FAILURE AND RETURN A GENERIC RESPONSE
    console.error("Failed to read learning check:", error);

    res.status(503).json({
      error: "Database temporarily unavailable",
    });
  }
});

// HANDLE GRAPHQL HTTP REQUESTS
app.all("/graphql", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const requestId = res.locals.requestId as string;
  const traceId = res.locals.traceId as string | undefined;

  const sessionToken = readSessionCookie(req.get("Cookie"));
  const getActor = createRequestActor(() =>
    resolveSession(database, sessionToken),
  );

  const beginLogin = createLoginAttemptGuard({
    assertAuthRequest: () => {
      assertAuthRequest({
        method: req.method,
        origin: req.get("Origin"),
        authHeader: req.get("X-GraphQL-Auth"),
      });
    },
    rateLimiter: loginRateLimiter,
    clientIp: req.ip,
  });

  const handler = createHandler({
    schema,
    rootValue,
    execute: executeWithQueryBudget,
    context: () => {
      let databaseCalls = 0;

      const logDatabaseCall = (operation: string): void => {
        databaseCalls += 1;

        console.log(
          JSON.stringify({
            event: "database_call",
            requestId,
            traceId,
            callNumber: databaseCalls,
            operation,
          }),
        );
      };

      return {
        requestId,
        database,
        logDatabaseCall,
        userLoader: createProfileLoader(userServiceClient, requestId),
        verifyCredentials,
        rateLimiter: loginRateLimiter,
        beginLogin,
        getActor,
        setSessionCookie: (session: CreatedSession): void => {
          setSessionCookie(res, session, secureCookies);
        },
        assertAuthRequest: (): void => {
          assertAuthRequest({
            method: req.method,
            origin: req.get("Origin"),
            authHeader: req.get("X-GraphQL-Auth"),
          });
        },
        sessionToken,
        clearSessionCookie: (): void => {
          clearSessionCookie(res, secureCookies);
        },
      };
    },
  });

  return handler(req, res, next);
});

// SERVE THE GRAPHQL QUERY EDITOR AND ITS LOCAL ASSETS
const playgroundConfig = {
  endpoint: "/graphql",
  staticPath: "/playground-assets/",
};

app.get("/playground", (_req, res) => {
  res.type("html").send(ruruHTML(playgroundConfig));
});

app.use(serveStatic(playgroundConfig.staticPath));

// 3. CONNECT TO MONGODB BEFORE ACCEPTING HTTP REQUESTS
const port = 4000;

async function start(): Promise<void> {
  await connectDatabase();

  // PRECOMPUTE THE DUMMY HASH ONCE BEFORE ACCEPTING REQUESTS
  verifyCredentials = await createCredentialVerifier(database);

  app.listen(port, "0.0.0.0", () => {
    console.log(`Express server listening on port ${port}`);
  });
}

start().catch((error: unknown) => {
  console.error("Application startup failed:", error);
  process.exitCode = 1;
});

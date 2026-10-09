import express from "express";
import { connectDatabase, database } from "./database.js";
import { createHandler } from "graphql-http/lib/use/express";
import { createUserLoader } from "./loaders.js";
import { schema } from "./graphql.js";
import { rootValue } from "./resolvers/index.js";
import { ruruHTML } from "ruru/server";
import { serveStatic } from "ruru/static";
import { requestLogging } from "./request-logging.js";

interface LearningCheck {
  _id: string;
  message: string;
}

// 1. CREATE THE APPLICATION
const app = express();
app.use(requestLogging);

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
  const requestId = res.locals.requestId as string;
  const traceId = res.locals.traceId as string | undefined;

  const handler = createHandler({
    schema,
    rootValue,
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
        userLoader: createUserLoader(database, logDatabaseCall, requestId),
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

  app.listen(port, "0.0.0.0", () => {
    console.log(`Express server listening on port ${port}`);
  });
}

start().catch((error: unknown) => {
  console.error("Application startup failed:", error);
  process.exitCode = 1;
});

import { MongoClient } from "mongodb";
import { createApp } from "./app.js";
import { readConfig, readDatabaseConfig } from "./config.js";
import { findPublicProfiles } from "./profiles.js";
import { shutdownTelemetry } from "./instrumentation.js";

const config = readConfig();
const databaseConfig = readDatabaseConfig();

const client = new MongoClient(databaseConfig.mongoUrl, {
  serverSelectionTimeoutMS: 3000,
});

const database = client.db(databaseConfig.databaseName);

try {
  await client.connect();
  await database.command({ ping: 1 });
} catch {
  await client.close();
  throw new Error("Unable to connect user service to MongoDB");
}

const app = createApp({
  serviceToken: config.serviceToken,
  lookupProfiles: (input) => findPublicProfiles(database, input),
});

const port = 4001;

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`User service listening on port ${port}`);
});

let stopping = false;

async function shutdown(): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  } finally {
    try {
      await client.close();
    } finally {
      await shutdownTelemetry();
    }
  }
}

function handleShutdown(): void {
  void shutdown().catch(() => {
    console.error("User service shutdown failed");
    process.exitCode = 1;
  });
}

process.once("SIGTERM", handleShutdown);
process.once("SIGINT", handleShutdown);

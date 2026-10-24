import assert from "node:assert/strict";
import { test } from "node:test";
import { readDatabaseConfig } from "./config.js";

// Validate startup configuration without reading the real environment
// or opening a database connection.
test("accepts MongoDB configuration", () => {
  assert.deepEqual(
    readDatabaseConfig({
      MONGO_URL: "mongodb://mongo:27017",
      MONGO_DB: "graphql_engineering_lab",
    }),
    {
      mongoUrl: "mongodb://mongo:27017",
      databaseName: "graphql_engineering_lab",
    },
  );
});

test("accepts the MongoDB SRV connection scheme", () => {
  assert.deepEqual(
    readDatabaseConfig({
      MONGO_URL: "mongodb+srv://cluster.example.com",
      MONGO_DB: "profiles",
    }),
    {
      mongoUrl: "mongodb+srv://cluster.example.com",
      databaseName: "profiles",
    },
  );
});

test("accepts a database name of exactly 63 UTF-8 bytes", () => {
  const databaseName = "a".repeat(63);

  assert.equal(
    readDatabaseConfig({
      MONGO_URL: "mongodb://mongo:27017",
      MONGO_DB: databaseName,
    }).databaseName,
    databaseName,
  );
});

test("rejects invalid database configuration", async (t) => {
  const validEnvironment = {
    MONGO_URL: "mongodb://mongo:27017",
    MONGO_DB: "profiles",
  };

  const cases: {
    name: string;
    overrides: NodeJS.ProcessEnv;
  }[] = [
    {
      name: "missing URL",
      overrides: { MONGO_URL: undefined },
    },
    {
      name: "unsupported URL scheme",
      overrides: { MONGO_URL: "https://mongo:27017" },
    },
    {
      name: "missing database name",
      overrides: { MONGO_DB: undefined },
    },
    {
      name: "empty database name",
      overrides: { MONGO_DB: "" },
    },
    {
      name: "database name containing a space",
      overrides: { MONGO_DB: "my profiles" },
    },
    {
      name: "database name containing a slash",
      overrides: { MONGO_DB: "my/profiles" },
    },
    {
      name: "database name exceeding 63 ASCII bytes",
      overrides: { MONGO_DB: "a".repeat(64) },
    },
    {
      name: "database name exceeding 63 UTF-8 bytes",
      overrides: { MONGO_DB: "é".repeat(32) },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () =>
          readDatabaseConfig({
            ...validEnvironment,
            ...scenario.overrides,
          }),
        {
          name: "Error",
          message: "Valid MONGO_URL and MONGO_DB must be configured",
        },
      );
    });
  }
});

test("does not expose supplied configuration in errors", () => {
  assert.throws(
    () =>
      readDatabaseConfig({
        MONGO_URL: "https://private-user:private-password@example.com",
        MONGO_DB: "profiles",
      }),
    {
      name: "Error",
      message: "Valid MONGO_URL and MONGO_DB must be configured",
    },
  );
});

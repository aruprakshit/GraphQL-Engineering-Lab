import assert from "node:assert/strict";
import { connectDatabase, database, mongoClient } from "./database.js";
import { createUserLoader } from "./loaders.js";

async function checkLoader(): Promise<void> {
  try {
    await connectDatabase();

    // 1. ARRANGE: CREATE A LOADER AND CAPTURE DATABASE CALLS
    const calls: string[] = [];

    const loader = createUserLoader(
      database,
      (operation) => {
        calls.push(operation);
        console.log(operation);
      },
      "loader-check",
    );

    // 2. ACT: REQUEST REORDERED, MISSING, AND REPEATED IDS
    const results = await loader.loadMany([
      "user-3",
      "missing-user",
      "user-1",
      "user-3",
    ]);

    // 3. ASSERT: RESULTS FOLLOW INPUT ORDER
    assert.deepEqual(
      results.map((user) => {
        if (user instanceof Error) {
          throw user;
        }

        return user?.name ?? null;
      }),
      ["Linus", null, "Ada", "Linus"],
    );

    assert.equal(calls.length, 1);

    // 4. ASSERT: A SUBSEQUENT LOAD USES THIS LOADER'S CACHE
    await loader.load("user-3");

    assert.equal(calls.length, 1);

    console.log("Loader ordering, missing-user, and cache checks passed");
  } finally {
    await mongoClient.close();
  }
}

checkLoader().catch((error: unknown) => {
  console.error("Loader checks failed:", error);
  process.exitCode = 1;
});

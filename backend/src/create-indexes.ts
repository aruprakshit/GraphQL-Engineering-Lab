import { connectDatabase, database, mongoClient } from "./database.js";
import type { PostDocument } from "./models.js";
import type { AccountDocument } from "./auth/models.js";

async function createIndexes(): Promise<void> {
  try {
    await connectDatabase();

    const indexName = await database
      .collection<PostDocument>("posts")
      .createIndex({ authorId: 1, _id: 1 }, { name: "posts_author_id" });

    console.log(`Index ensured: ${indexName}`);

    // PREVENT DUPLICATE NORMALIZED LOGIN NAMES
    const accountIndexName = await database
      .collection<AccountDocument>("accounts")
      .createIndex(
        { username: 1 },
        {
          name: "accounts_username_unique",
          unique: true,
        },
      );

    console.log(`Index ensured: ${accountIndexName}`);
  } finally {
    await mongoClient.close();
  }
}

createIndexes().catch((error: unknown) => {
  console.error("Index creation failed:", error);
  process.exitCode = 1;
});

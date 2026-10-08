import { connectDatabase, database, mongoClient } from "./database.js";
import type { PostDocument } from "./models.js";

async function createIndexes(): Promise<void> {
  try {
    await connectDatabase();

    const indexName = await database
      .collection<PostDocument>("posts")
      .createIndex({ authorId: 1, _id: 1 }, { name: "posts_author_id" });

    console.log(`Index ensured: ${indexName}`);
  } finally {
    await mongoClient.close();
  }
}

createIndexes().catch((error: unknown) => {
  console.error("Index creation failed:", error);
  process.exitCode = 1;
});

import { connectDatabase, database, mongoClient } from "./database.js";
import type { PostDocument, UserDocument } from "./models.js";

// 1. DEFINE THE EXAMPLE DATA
const users: UserDocument[] = [
  { _id: "user-1", name: "Ada" },
  { _id: "user-2", name: "Grace" },
  { _id: "user-3", name: "Linus" },
];

const posts: PostDocument[] = [
  {
    _id: "post-1",
    title: "Learning GraphQL",
    authorId: "user-2",
  },
  {
    _id: "post-2",
    title: "Resolver basics",
    authorId: "user-1",
  },
  {
    _id: "post-3",
    title: "The N+1 problem",
    authorId: "user-2",
  },
  {
    _id: "post-4",
    title: "Batching requests",
    authorId: "user-3",
  },
  {
    _id: "post-5",
    title: "Request caching",
    authorId: "user-1",
  },
];

async function seed(): Promise<void> {
  try {
    await connectDatabase();

    // 2. INSERT USERS THAT DO NOT ALREADY EXIST
    const userResult = await database
      .collection<UserDocument>("users")
      .bulkWrite(
        users.map((user) => ({
          updateOne: {
            filter: { _id: user._id },
            update: { $setOnInsert: user },
            upsert: true,
          },
        })),
      );

    // 3. INSERT POSTS AFTER THEIR AUTHORS EXIST
    const postResult = await database
      .collection<PostDocument>("posts")
      .bulkWrite(
        posts.map((post) => ({
          updateOne: {
            filter: { _id: post._id },
            update: { $setOnInsert: post },
            upsert: true,
          },
        })),
      );

    console.log({
      usersInserted: userResult.upsertedCount,
      postsInserted: postResult.upsertedCount,
    });
  } finally {
    // 4. CLOSE CONNECTIONS SO THE ONE-OFF COMMAND CAN EXIT
    await mongoClient.close();
  }
}

seed().catch((error: unknown) => {
  console.error("Seeding failed:", error);
  process.exitCode = 1;
});

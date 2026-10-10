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
    status: "published",
  },
  {
    _id: "post-2",
    title: "Resolver basics",
    authorId: "user-1",
    status: "published",
  },
  {
    _id: "post-3",
    title: "The N+1 problem",
    authorId: "user-2",
    status: "published",
  },
  {
    _id: "post-4",
    title: "Batching requests",
    authorId: "user-3",
    status: "published",
  },
  {
    _id: "post-5",
    title: "Request caching",
    authorId: "user-1",
    status: "published",
  },
];

// ADD FIXED-WIDTH IDS FOR THE PAGINATION EXPERIMENT
const paginationPosts: PostDocument[] = Array.from(
  { length: 25 },
  (_, index) => {
    const number = index + 1;

    return {
      _id: `page-post-${String(number).padStart(3, "0")}`,
      title: `Pagination example ${number}`,
      authorId: `user-${(index % 3) + 1}`,
      status: "published",
    };
  },
);

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
        [...posts, ...paginationPosts].map((post) => ({
          updateOne: {
            filter: { _id: post._id },
            update: { $setOnInsert: post },
            upsert: true,
          },
        })),
      );

    // BACKFILL STATUS ONLY FOR OUR KNOWN SEED POSTS
    const seedPostIds = [...posts, ...paginationPosts].map((post) => post._id);

    const statusResult = await database
      .collection<PostDocument>("posts")
      .updateMany(
        {
          _id: { $in: seedPostIds },
          status: { $exists: false },
        },
        {
          $set: { status: "published" },
        },
      );

    console.log({
      usersInserted: userResult.upsertedCount,
      postsInserted: postResult.upsertedCount,
      postStatusesBackfilled: statusResult.modifiedCount,
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

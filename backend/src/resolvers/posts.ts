import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import type { PostDocument } from "../models.js";

// FETCH AN AUTHOR USING THE REQUEST'S LOADER
async function resolvePostAuthor(authorId: string, context: GraphQLContext) {
  try {
    // 1. LOAD THROUGH THE REQUEST'S BATCH QUEUE AND CACHE
    const user = await context.userLoader.load(authorId);

    // 2. HANDLE A MISSING AUTHOR
    if (!user) {
      return null;
    }

    // 3. MAP THE DOCUMENT TO THE GRAPHQL RESPONSE
    return {
      id: user._id,
      name: user.name,
    };
  } catch (error: unknown) {
    // 4. LOG INTERNAL DETAILS AND RETURN A GENERIC ERROR
    console.error("Failed to resolve post author:", error);

    throw new GraphQLError("Database temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

// MAP A STORED DOCUMENT TO THE GRAPHQL OBJECT
function toGraphQLPost(post: PostDocument, context: GraphQLContext) {
  return {
    id: post._id,
    title: post.title,
    author: () => resolvePostAuthor(post.authorId, context),
  };
}

// FETCH THE BOUNDED LIST OF POSTS
export async function resolvePosts(_args: unknown, context: GraphQLContext) {
  try {
    context.logDatabaseCall("posts.find");

    const posts = await context.database
      .collection<PostDocument>("posts")
      .find({})
      .sort({ _id: 1 })
      .limit(5)
      .toArray();

    return posts.map((post) => toGraphQLPost(post, context));
  } catch (error: unknown) {
    console.error("Failed to resolve posts:", error);

    throw new GraphQLError("Database temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

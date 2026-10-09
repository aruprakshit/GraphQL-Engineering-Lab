import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import type { PostDocument } from "../models.js";
import {
  encodePostCursor,
  parsePostsArguments,
  type PostsArguments,
} from "../pagination.js";
import { withSpan } from "../tracing.js";

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
async function resolvePostsConnection(
  args: PostsArguments,
  context: GraphQLContext,
) {
  // 1. VALIDATE BEFORE PERFORMING DATABASE WORK
  const { pageSize, afterId } = parsePostsArguments(args);

  try {
    // 2. FETCH ONE EXTRA DOCUMENT TO DETECT ANOTHER PAGE
    const filter = afterId === null ? {} : { _id: { $gt: afterId } };

    context.logDatabaseCall(
      `posts.find after=${JSON.stringify(afterId)} limit=${pageSize + 1}`,
    );

    const documents = await context.database
      .collection<PostDocument>("posts")
      .find(filter)
      .sort({ _id: 1 })
      .limit(pageSize + 1)
      .toArray();

    // 3. KEEP ONLY THE REQUESTED PAGE
    const hasNextPage = documents.length > pageSize;
    const page = documents.slice(0, pageSize);

    // 4. BUILD EDGES FOR THE RETURNED POSTS
    const edges = page.map((post) => ({
      cursor: encodePostCursor(post._id),
      node: toGraphQLPost(post, context),
    }));

    console.log(
      JSON.stringify({
        event: "posts_page",
        requestId: context.requestId,
        fetchedCount: documents.length,
        returnedCount: edges.length,
        hasNextPage,
      }),
    );

    // 5. RETURN THE CONNECTION AND PAGINATION METADATA
    return {
      edges,
      pageInfo: {
        hasNextPage,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
    };
  } catch (error: unknown) {
    console.error("Failed to resolve posts:", error);

    throw new GraphQLError("Database temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

// TRACE POSTS RESOLUTION WITHOUT MIXING TRACING INTO ITS IMPLEMENTATION
export async function resolvePosts(
  args: PostsArguments,
  context: GraphQLContext,
) {
  return withSpan(
    "graphql.posts",
    { "app.request_id": context.requestId },
    async (span) => {
      const connection = await resolvePostsConnection(args, context);

      span.setAttributes({
        "posts.returned_count": connection.edges.length,
        "posts.has_next_page": connection.pageInfo.hasNextPage,
      });

      return connection;
    },
  );
}

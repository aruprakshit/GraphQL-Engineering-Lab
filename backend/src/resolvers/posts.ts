import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import type { PostDocument } from "../models.js";
import {
  encodePostCursor,
  parsePostsArguments,
  type PostsArguments,
} from "../pagination.js";
import { withSpan } from "../tracing.js";
import { listVisiblePosts } from "../posts/service.js";

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
  // VALIDATE BEFORE AUTHENTICATION OR POST DATABASE WORK.
  const { pageSize, afterId } = parsePostsArguments(args);

  // AUTHENTICATION FAILURE MUST NOT BECOME ANONYMOUS ACCESS.
  const actor = await context.getActor();

  try {
    const { posts, hasNextPage } = await listVisiblePosts(
      context.database,
      actor,
      { pageSize, afterId },
      context.logDatabaseCall,
    );

    const edges = posts.map((post) => ({
      cursor: encodePostCursor(post._id),
      node: toGraphQLPost(post, context),
    }));

    console.log(
      JSON.stringify({
        event: "posts_page",
        requestId: context.requestId,
        returnedCount: edges.length,
        hasNextPage,
      }),
    );

    return {
      edges,
      pageInfo: {
        hasNextPage,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
    };
  } catch {
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

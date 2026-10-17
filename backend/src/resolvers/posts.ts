import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import {
  encodePostCursor,
  parsePostsArguments,
  type PostsArguments,
} from "../pagination.js";
import { withSpan } from "../tracing.js";
import { listVisiblePosts } from "../posts/service.js";
import { toGraphQLPost } from "./post.js";

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

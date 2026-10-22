import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import type { PostDocument } from "../models.js";
import { toGraphQLPostStatus } from "../post-status.js";

async function resolvePostAuthor(authorId: string, context: GraphQLContext) {
  try {
    const user = await context.userLoader.load(authorId);

    if (!user) {
      return null;
    }

    return {
      id: user._id,
      name: user.name,
      displayName: user.name,
    };
  } catch {
    throw new GraphQLError("Database temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

export function toGraphQLPost(post: PostDocument, context: GraphQLContext) {
  return {
    id: post._id,
    title: post.title,
    status: toGraphQLPostStatus(post.status),
    author: () => resolvePostAuthor(post.authorId, context),
  };
}

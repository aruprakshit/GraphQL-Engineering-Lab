import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import type { PostDocument } from "../models.js";
import { toGraphQLPostStatus } from "../post-status.js";

export function toGraphQLPost(post: PostDocument, context: GraphQLContext) {
  return {
    id: post._id,
    title: post.title,
    status: toGraphQLPostStatus(post.status),
    author: () => resolvePostAuthor(post.authorId, context),
  };
}

async function resolvePostAuthor(authorId: string, context: GraphQLContext) {
  try {
    const profile = await context.userLoader.load(authorId);

    if (!profile) {
      return null;
    }

    return {
      id: profile.id,
      name: profile.displayName,
      displayName: profile.displayName,
    };
  } catch {
    throw new GraphQLError("Author information temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

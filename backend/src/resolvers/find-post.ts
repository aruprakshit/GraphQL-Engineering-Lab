import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import { findVisiblePost } from "../posts/service.js";
import { InvalidPostIdError } from "../posts/errors.js";
import { toGraphQLPost } from "./post.js";

interface FindPostArguments {
  id: string;
}

export async function resolveFindPost(
  { id }: FindPostArguments,
  context: GraphQLContext,
) {
  // PRESERVE AUTHENTICATION-STORAGE ERRORS.
  const actor = await context.getActor();

  try {
    const post = await findVisiblePost(context.database, actor, id);

    return post ? toGraphQLPost(post, context) : null;
  } catch (error: unknown) {
    if (error instanceof InvalidPostIdError) {
      throw new GraphQLError(error.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }

    throw new GraphQLError("Post temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

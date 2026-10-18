import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import { publishPost } from "../posts/service.js";
import {
  InvalidPostIdError,
  PostAuthenticationRequiredError,
  PostNotFoundError,
  PostPublicationConflictError,
} from "../posts/errors.js";
import { toGraphQLPost } from "./post.js";

interface PublishPostArguments {
  id: string;
}

export async function resolvePublishPost(
  { id }: PublishPostArguments,
  context: GraphQLContext,
) {
  try {
    context.assertAuthRequest();
  } catch {
    throw new GraphQLError("Authentication request rejected", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  // PRESERVE AUTHENTICATION-STORAGE ERRORS.
  const actor = await context.getActor();

  try {
    const post = await publishPost(context.database, actor, id);

    return toGraphQLPost(post, context);
  } catch (error: unknown) {
    if (error instanceof PostAuthenticationRequiredError) {
      throw new GraphQLError("Authentication required", {
        extensions: { code: "UNAUTHENTICATED" },
      });
    }

    if (error instanceof InvalidPostIdError) {
      throw new GraphQLError(error.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }

    if (error instanceof PostNotFoundError) {
      throw new GraphQLError("Post not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }

    if (error instanceof PostPublicationConflictError) {
      throw new GraphQLError("Post is no longer a draft", {
        extensions: { code: "CONFLICT" },
      });
    }

    throw new GraphQLError("Post publication temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

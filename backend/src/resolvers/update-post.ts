import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import {
  updatePostTitle,
  type UpdatePostTitleInput,
} from "../posts/service.js";
import {
  InvalidPostIdError,
  InvalidPostTitleError,
  PostAuthenticationRequiredError,
  PostNotFoundError,
} from "../posts/errors.js";
import { toGraphQLPost } from "./post.js";

interface UpdatePostArguments {
  id: string;
  input: UpdatePostTitleInput;
}

export async function resolveUpdatePost(
  { id, input }: UpdatePostArguments,
  context: GraphQLContext,
) {
  try {
    context.assertAuthRequest(); // Is the request permitted?
  } catch {
    throw new GraphQLError("Authentication request rejected", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  // PRESERVE AUTHENTICATION-STORAGE ERRORS.
  const actor = await context.getActor(); // Who is the caller?

  try {
    const post = await updatePostTitle(
      //  May that caller edit this post?
      context.database,
      actor,
      id,
      input,
    );

    return toGraphQLPost(post, context);
  } catch (error: unknown) {
    if (error instanceof PostAuthenticationRequiredError) {
      throw new GraphQLError("Authentication required", {
        extensions: { code: "UNAUTHENTICATED" },
      });
    }

    if (
      error instanceof InvalidPostIdError ||
      error instanceof InvalidPostTitleError
    ) {
      throw new GraphQLError(error.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }

    if (error instanceof PostNotFoundError) {
      throw new GraphQLError("Post not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }

    throw new GraphQLError("Post update temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

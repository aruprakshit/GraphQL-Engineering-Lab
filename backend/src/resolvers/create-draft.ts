import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import { createDraft, type CreateDraftInput } from "../posts/service.js";
import {
  InvalidPostTitleError,
  PostAuthenticationRequiredError,
} from "../posts/errors.js";
import { AuthRequestRejectedError } from "../auth/request-guard.js";
import { toGraphQLPost } from "./post.js";

interface CreateDraftArguments {
  input: CreateDraftInput;
}

export async function resolveCreateDraft(
  { input }: CreateDraftArguments,
  context: GraphQLContext,
) {
  // CHECK THE REQUEST BEFORE SESSION LOOKUP OR DATABASE WRITES.
  try {
    context.assertAuthRequest();
  } catch {
    throw new GraphQLError("Authentication request rejected", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  // PRESERVE THE EXISTING AUTHENTICATION FAILURE CONTRACT.
  const actor = await context.getActor();

  try {
    const post = await createDraft(context.database, actor, input);

    return toGraphQLPost(post, context);
  } catch (error: unknown) {
    if (error instanceof PostAuthenticationRequiredError) {
      throw new GraphQLError("Authentication required", {
        extensions: { code: "UNAUTHENTICATED" },
      });
    }

    if (error instanceof InvalidPostTitleError) {
      throw new GraphQLError(error.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }

    throw new GraphQLError("Draft creation temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

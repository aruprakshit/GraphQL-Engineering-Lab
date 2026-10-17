import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import type { LoginCredentials } from "../auth/models.js";
import { InvalidLoginInputError } from "../auth/credentials.js";
import { CapacityExceededError } from "../auth/concurrency.js";
import { AuthRequestRejectedError } from "../auth/request-guard.js";
import { LoginAlreadyAttemptedError } from "../auth/login-attempt.js";
import { LoginRateLimitError } from "../auth/login-rate-limit.js";
import { createSession } from "../auth/sessions.js";

interface LoginArguments {
  input: LoginCredentials;
}

interface LoginPayload {
  user: {
    id: string;
    name: string;
    role: "USER" | "ADMIN";
  };
}

export async function resolveLogin(
  { input }: LoginArguments,
  context: GraphQLContext,
): Promise<LoginPayload> {
  try {
    // CHECK REQUEST PROTECTIONS BEFORE LOOKUP OR HASHING
    context.beginLogin();

    const identity = await context.verifyCredentials(input);

    if (!identity) {
      throw new GraphQLError("Invalid username or password", {
        extensions: { code: "UNAUTHENTICATED" },
      });
    }

    // STORE THE SESSION BEFORE SENDING ITS COOKIE
    const session = await createSession(context.database, identity.userId);

    context.setSessionCookie(session);

    return {
      user: {
        id: identity.userId,
        name: identity.name,
        role: identity.role === "admin" ? "ADMIN" : "USER",
      },
    };
  } catch (error: unknown) {
    if (error instanceof AuthRequestRejectedError) {
      throw new GraphQLError("Authentication request rejected", {
        extensions: { code: "FORBIDDEN" },
      });
    }

    if (error instanceof InvalidLoginInputError) {
      throw new GraphQLError("Invalid login input", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }

    if (error instanceof LoginAlreadyAttemptedError) {
      throw new GraphQLError("Only one login attempt is allowed per request", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }

    if (error instanceof LoginRateLimitError) {
      throw new GraphQLError("Too many login attempts", {
        extensions: {
          code: "TOO_MANY_REQUESTS",
          retryAfterSeconds: error.retryAfterSeconds,
        },
      });
    }

    if (error instanceof CapacityExceededError) {
      throw new GraphQLError("Login temporarily unavailable", {
        extensions: {
          code: "SERVICE_UNAVAILABLE",
          retryAfterSeconds: 1,
        },
      });
    }

    if (error instanceof GraphQLError) {
      throw error;
    }

    // KEEP INTERNAL ERRORS AND CREDENTIALS OUT OF THE RESPONSE
    throw new GraphQLError("Login temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

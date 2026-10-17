import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import { AuthRequestRejectedError } from "../auth/request-guard.js";
import { revokeSession } from "../auth/sessions.js";

export async function resolveLogout(
  _args: unknown,
  context: GraphQLContext,
): Promise<boolean> {
  try {
    context.assertAuthRequest();

    await revokeSession(context.database, context.sessionToken);

    context.clearSessionCookie();

    return true;
  } catch (error: unknown) {
    if (error instanceof AuthRequestRejectedError) {
      throw new GraphQLError("Authentication request rejected", {
        extensions: { code: "FORBIDDEN" },
      });
    }

    throw new GraphQLError("Logout temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

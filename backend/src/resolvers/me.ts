import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";
import type { UserDocument } from "../models.js";

interface MeResult {
  id: string;
  name: string;
  role: "USER" | "ADMIN";
}

export async function resolveMe(
  _args: unknown,
  context: GraphQLContext,
): Promise<MeResult | null> {
  const actor = await context.getActor();

  if (!actor) {
    return null;
  }

  try {
    const user = await context.database
      .collection<UserDocument>("users")
      .findOne({ _id: actor.userId }, { projection: { _id: 1, name: 1 } });

    if (!user) {
      return null;
    }

    return {
      id: user._id,
      name: user.name,
      role: actor.role === "admin" ? "ADMIN" : "USER",
    };
  } catch {
    throw new GraphQLError("User temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

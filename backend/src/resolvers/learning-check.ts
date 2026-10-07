import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../graphql-context.js";

interface LearningCheckDocument {
  _id: string;
  message: string;
}

export async function resolveLearningCheck(
  { id }: { id: string },
  context: GraphQLContext,
) {
  try {
    const document = await context.database
      .collection<LearningCheckDocument>("learning_checks")
      .findOne({ _id: id });

    if (!document) {
      return null;
    }

    return {
      id: document._id,
      message: document.message,
    };
  } catch (error: unknown) {
    console.error("Failed to resolve learningCheck:", error);

    throw new GraphQLError("Database temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }
}

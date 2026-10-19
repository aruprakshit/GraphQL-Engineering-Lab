import { GraphQLError } from "graphql";
import type { PostDocument } from "./models.js";

export type GraphQLPostStatus = "DRAFT" | "PUBLISHED";

export function fromGraphQLPostStatus(
  value: unknown,
): PostDocument["status"] | null {
  switch (value) {
    case undefined:
    case null:
      return null;
    case "DRAFT":
      return "draft";
    case "PUBLISHED":
      return "published";
    default:
      throw new GraphQLError("Invalid post status filter", {
        extensions: { code: "BAD_USER_INPUT" },
      });
  }
}

export function toGraphQLPostStatus(
  value: PostDocument["status"],
): GraphQLPostStatus {
  switch (value) {
    case "draft":
      return "DRAFT";
    case "published":
      return "PUBLISHED";
    default:
      throw new GraphQLError("Post status temporarily unavailable", {
        extensions: { code: "SERVICE_UNAVAILABLE" },
      });
  }
}

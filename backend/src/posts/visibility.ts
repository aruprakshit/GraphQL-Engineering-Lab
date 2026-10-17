import type { Filter } from "mongodb";
import type { Actor } from "../auth/models.js";
import type { PostDocument } from "../models.js";

export function buildPostVisibilityFilter(
  actor: Actor | null,
): Filter<PostDocument> {
  if (actor?.role === "admin") {
    return {};
  }

  if (actor?.role === "user") {
    return {
      $or: [
        { status: "published" },
        {
          status: "draft",
          authorId: actor.userId,
        },
      ],
    };
  }

  return { status: "published" };
}

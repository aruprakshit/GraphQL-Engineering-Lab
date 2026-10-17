import type { Db, Filter } from "mongodb";
import type { Actor } from "../auth/models.js";
import type { PostDocument } from "../models.js";
import { buildPostVisibilityFilter } from "./visibility.js";

export interface ListPostsOptions {
  pageSize: number;
  afterId: string | null;
}

export interface VisiblePostsPage {
  posts: PostDocument[];
  hasNextPage: boolean;
}

export async function listVisiblePosts(
  database: Db,
  actor: Actor | null,
  { pageSize, afterId }: ListPostsOptions,
  logDatabaseCall: (operation: string) => void = () => {},
): Promise<VisiblePostsPage> {
  // VALIDATE AT THE SERVICE BOUNDARY FOR ALL CALLERS.
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) {
    throw new Error("pageSize must be an integer between 1 and 20");
  }

  if (
    afterId !== null &&
    (typeof afterId !== "string" ||
      afterId.length === 0 ||
      afterId.length > 256)
  ) {
    throw new Error("Invalid post cursor boundary");
  }

  const visibility = buildPostVisibilityFilter(actor);

  const filter: Filter<PostDocument> =
    afterId === null
      ? visibility
      : {
          $and: [visibility, { _id: { $gt: afterId } }],
        };

  logDatabaseCall(
    `posts.find after=${JSON.stringify(afterId)} limit=${pageSize + 1}`,
  );

  const documents = await database
    .collection<PostDocument>("posts")
    .find(filter)
    .sort({ _id: 1 })
    .limit(pageSize + 1)
    .toArray();

  return {
    posts: documents.slice(0, pageSize),
    hasNextPage: documents.length > pageSize,
  };
}

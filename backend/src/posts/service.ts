import type { Db, Filter } from "mongodb";
import { randomUUID } from "node:crypto";
import { normalizePostTitle } from "./titles.js";
import type { Actor } from "../auth/models.js";
import type { PostDocument } from "../models.js";
import { buildPostVisibilityFilter } from "./visibility.js";
import {
  InvalidPostIdError,
  PostAuthenticationRequiredError,
  PostNotFoundError,
  PostPublicationConflictError,
} from "./errors.js";

export interface ListPostsOptions {
  pageSize: number;
  afterId: string | null;
}

export interface VisiblePostsPage {
  posts: PostDocument[];
  hasNextPage: boolean;
}

export interface CreateDraftInput {
  title: string;
}

export interface UpdatePostTitleInput {
  title: string;
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

export async function createDraft(
  database: Db,
  actor: Actor | null,
  input: CreateDraftInput,
): Promise<PostDocument> {
  // REQUIRE TRUSTED IDENTITY BEFORE PROCESSING THE CONTENT.
  if (!actor) {
    throw new PostAuthenticationRequiredError();
  }

  const title = normalizePostTitle(input.title);

  // CONSTRUCT THE DOCUMENT EXPLICITLY FROM TRUSTED VALUES.
  const post: PostDocument = {
    _id: randomUUID(),
    title,
    authorId: actor.userId,
    status: "draft",
  };

  await database.collection<PostDocument>("posts").insertOne(post);

  return post;
}

export async function updatePostTitle(
  database: Db,
  actor: Actor | null,
  id: string,
  input: UpdatePostTitleInput,
): Promise<PostDocument> {
  if (!actor) {
    throw new PostAuthenticationRequiredError();
  }

  if (typeof id !== "string" || id.length === 0 || id.length > 256) {
    throw new InvalidPostIdError();
  }

  const title = normalizePostTitle(input.title);

  const filter: Filter<PostDocument> =
    actor.role === "admin"
      ? { _id: id }
      : {
          _id: id,
          authorId: actor.userId,
        };

  const updated = await database
    .collection<PostDocument>("posts")
    .findOneAndUpdate(
      filter,
      { $set: { title } },
      {
        returnDocument: "after",
        includeResultMetadata: false,
      },
    );

  if (!updated) {
    throw new PostNotFoundError();
  }

  return updated;
}

export async function publishPost(
  database: Db,
  actor: Actor | null,
  id: string,
): Promise<PostDocument> {
  if (!actor) {
    throw new PostAuthenticationRequiredError();
  }

  if (typeof id !== "string" || id.length === 0 || id.length > 256) {
    throw new InvalidPostIdError();
  }

  const authorizationFilter: Filter<PostDocument> =
    actor.role === "admin"
      ? { _id: id }
      : {
          _id: id,
          authorId: actor.userId,
        };

  const posts = database.collection<PostDocument>("posts");

  // REQUIRE AUTHORIZATION AND DRAFT STATUS IN THE SAME WRITE.
  const published = await posts.findOneAndUpdate(
    {
      $and: [authorizationFilter, { status: "draft" }],
    },
    { $set: { status: "published" } },
    {
      returnDocument: "after",
      includeResultMetadata: false,
    },
  );

  if (published) {
    return published;
  }

  // DISTINGUISH MISSING/INACCESSIBLE FROM A STATE CONFLICT.
  const accessiblePost = await posts.findOne(authorizationFilter, {
    projection: { _id: 1 },
  });

  if (!accessiblePost) {
    throw new PostNotFoundError();
  }

  throw new PostPublicationConflictError();
}

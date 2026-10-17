import { InvalidPostTitleError } from "./errors.js";

export function normalizePostTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidPostTitleError();
  }

  const title = value.trim();
  const length = Array.from(title).length;

  if (length < 1 || length > 200) {
    throw new InvalidPostTitleError();
  }

  return title;
}

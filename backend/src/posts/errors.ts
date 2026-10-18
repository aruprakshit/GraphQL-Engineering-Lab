export class PostAuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "PostAuthenticationRequiredError";
  }
}

export class InvalidPostTitleError extends Error {
  constructor() {
    super("Title must contain between 1 and 200 Unicode code points");
    this.name = "InvalidPostTitleError";
  }
}

export class InvalidPostIdError extends Error {
  constructor() {
    super("Post ID must contain between 1 and 256 characters");
    this.name = "InvalidPostIdError";
  }
}

export class PostNotFoundError extends Error {
  constructor() {
    super("Post not found");
    this.name = "PostNotFoundError";
  }
}

export class PostPublicationConflictError extends Error {
  constructor() {
    super("Post is no longer a draft");
    this.name = "PostPublicationConflictError";
  }
}

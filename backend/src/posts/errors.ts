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

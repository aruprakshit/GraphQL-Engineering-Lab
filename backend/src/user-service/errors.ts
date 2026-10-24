export type UserServiceFailureReason =
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "RESPONSE_TOO_LARGE";

export class UserServiceUnavailableError extends Error {
  constructor(public readonly reason: UserServiceFailureReason) {
    super("User service temporarily unavailable");
    this.name = "UserServiceUnavailableError";
  }
}

export class InvalidUserServiceInputError extends Error {
  constructor() {
    super("Invalid user-service lookup IDs");
    this.name = "InvalidUserServiceInputError";
  }
}

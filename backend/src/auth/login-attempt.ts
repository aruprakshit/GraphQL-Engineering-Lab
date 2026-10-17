import type { createLoginRateLimiter } from "./login-rate-limit.js";

interface LoginAttemptOptions {
  assertAuthRequest: () => void;
  rateLimiter: ReturnType<typeof createLoginRateLimiter>;
  clientIp: string | undefined;
}

export class LoginAlreadyAttemptedError extends Error {
  constructor() {
    super("Only one login attempt is allowed per request");
    this.name = "LoginAlreadyAttemptedError";
  }
}

export class LoginClientUnavailableError extends Error {
  constructor() {
    super("Login client address unavailable");
    this.name = "LoginClientUnavailableError";
  }
}

export function createLoginAttemptGuard({
  assertAuthRequest,
  rateLimiter,
  clientIp,
}: LoginAttemptOptions): () => void {
  let attempted = false;

  return function beginLogin(): void {
    assertAuthRequest();

    if (!clientIp) {
      throw new LoginClientUnavailableError();
    }

    rateLimiter.consume(clientIp);

    if (attempted) {
      throw new LoginAlreadyAttemptedError();
    }

    attempted = true;
  };
}

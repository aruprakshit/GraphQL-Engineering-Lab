export interface AuthRequestMetadata {
  method: string;
  origin?: string;
  authHeader?: string;
}

export class AuthRequestRejectedError extends Error {
  constructor() {
    super("Authentication request rejected");
    this.name = "AuthRequestRejectedError";
  }
}

export function createAuthRequestGuard(allowedOrigin: string) {
  // 1. REQUIRE AN EXPLICIT ORIGIN WITHOUT A PATH OR CREDENTIALS
  const configured = new URL(allowedOrigin);

  if (
    !["http:", "https:"].includes(configured.protocol) ||
    configured.origin !== allowedOrigin
  ) {
    throw new Error("AUTH_ALLOWED_ORIGIN must be an HTTP(S) origin");
  }

  return function assertAuthRequest(request: AuthRequestMetadata): void {
    // 2. REQUIRE POST AND THE CUSTOM HEADER
    if (request.method !== "POST" || request.authHeader !== "1") {
      throw new AuthRequestRejectedError();
    }

    // 3. REJECT UNTRUSTED ORIGINS WHEN SUPPLIED
    if (request.origin !== undefined && request.origin !== allowedOrigin) {
      throw new AuthRequestRejectedError();
    }
  };
}

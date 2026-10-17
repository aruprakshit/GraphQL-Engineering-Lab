interface AttemptWindow {
  count: number;
  resetAt: number;
}

export class LoginRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many login attempts");
    this.name = "LoginRateLimitError";
  }
}

export class LoginRateLimitCapacityError extends Error {
  constructor() {
    super("Login rate-limit storage capacity exhausted");
    this.name = "LoginRateLimitCapacityError";
  }
}

interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
}

export function createLoginRateLimiter({
  limit = 10,
  windowMs = 15 * 60 * 1000,
  maxKeys = 10_000,
  now = Date.now,
}: RateLimitOptions = {}) {
  for (const value of [limit, windowMs, maxKeys]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("Rate-limit settings must be positive integers");
    }
  }

  const windows = new Map<string, AttemptWindow>();

  return {
    consume(key: string): void {
      const currentTime = now();
      const existing = windows.get(key);

      // 1. COUNT ATTEMPTS IN AN ACTIVE WINDOW
      if (existing && existing.resetAt > currentTime) {
        if (existing.count >= limit) {
          throw new LoginRateLimitError(
            Math.ceil((existing.resetAt - currentTime) / 1000),
          );
        }

        existing.count += 1;
        return;
      }

      // 2. RECLAIM EXPIRED ENTRIES WHEN STORAGE IS FULL
      if (!existing && windows.size >= maxKeys) {
        for (const [storedKey, window] of windows) {
          if (window.resetAt <= currentTime) {
            windows.delete(storedKey);
          }
        }

        if (windows.size >= maxKeys) {
          throw new LoginRateLimitCapacityError();
        }
      }

      // 3. START A NEW WINDOW WITH THIS ATTEMPT INCLUDED
      windows.set(key, {
        count: 1,
        resetAt: currentTime + windowMs,
      });
    },
  };
}

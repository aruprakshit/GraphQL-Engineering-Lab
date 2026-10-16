import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLoginRateLimiter,
  LoginRateLimitCapacityError,
  LoginRateLimitError,
} from "./login-rate-limit.js";

test("limits each key independently and resets at expiry", () => {
  // ARRANGE
  let time = 0;

  const limiter = createLoginRateLimiter({
    limit: 2,
    windowMs: 1000,
    now: () => time,
  });

  // ACT
  limiter.consume("client-a");
  limiter.consume("client-a");

  // ASSERT
  assert.throws(() => limiter.consume("client-a"), LoginRateLimitError);

  assert.doesNotThrow(() => limiter.consume("client-b"));

  time = 999;

  assert.throws(
    () => limiter.consume("client-a"),
    (error: unknown) =>
      error instanceof LoginRateLimitError && error.retryAfterSeconds === 1,
  );

  time = 1000;

  assert.doesNotThrow(() => limiter.consume("client-a"));
});

test("bounds storage and reclaims expired windows", () => {
  let time = 0;

  const limiter = createLoginRateLimiter({
    maxKeys: 1,
    windowMs: 1000,
    now: () => time,
  });

  limiter.consume("client-a");

  assert.throws(() => limiter.consume("client-b"), LoginRateLimitCapacityError);

  time = 1000;

  assert.doesNotThrow(() => limiter.consume("client-b"));
});

test("rejects invalid settings", () => {
  assert.throws(() => createLoginRateLimiter({ limit: 0 }));
  assert.throws(() => createLoginRateLimiter({ windowMs: -1 }));
  assert.throws(() => createLoginRateLimiter({ maxKeys: 1.5 }));
});

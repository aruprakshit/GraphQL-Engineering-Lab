/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Second attempt in one request | LoginAlreadyAttemptedError |
 * | Extra alias and later request share allowance | Alias counts; later request is rate limited |
 * | Request guard rejects | Error propagates without consuming allowance |
 * | Missing client IP | LoginClientUnavailableError |
 *
 * Reading guide:
 * - Each guard represents one request; a shared limiter represents clients across requests.
 * - Extra login aliases consume allowance even though the request guard rejects them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLoginAttemptGuard,
  LoginAlreadyAttemptedError,
  LoginClientUnavailableError,
} from "./login-attempt.js";
import {
  createLoginRateLimiter,
  LoginRateLimitError,
} from "./login-rate-limit.js";

// Purpose: The per-request flag must block a second call even while IP allowance remains.
test("allows one login attempt per request", () => {
  const beginLogin = createLoginAttemptGuard({
    assertAuthRequest: () => {},
    rateLimiter: createLoginRateLimiter(),
    clientIp: "client-a",
  });

  beginLogin();

  assert.throws(beginLogin, LoginAlreadyAttemptedError);
});

// Purpose: New request flags must not reset the shared client allowance.
test("shares the IP allowance across requests and counts extra aliases", () => {
  const rateLimiter = createLoginRateLimiter({ limit: 2 });

  const createRequest = () =>
    createLoginAttemptGuard({
      assertAuthRequest: () => {},
      rateLimiter,
      clientIp: "client-a",
    });

  const firstRequest = createRequest();

  firstRequest();
  assert.throws(firstRequest, LoginAlreadyAttemptedError);

  // A new request gets a new attempt flag but retains the shared IP allowance.
  const secondRequest = createRequest();

  assert.throws(secondRequest, LoginRateLimitError);
});

// Purpose: Bad request metadata must fail before it consumes a legitimate client attempt.
test("rejects an untrusted request before consuming its allowance", () => {
  const rateLimiter = createLoginRateLimiter({ limit: 1 });
  const rejection = new Error("Request rejected");

  const rejectedRequest = createLoginAttemptGuard({
    assertAuthRequest: () => {
      throw rejection;
    },
    rateLimiter,
    clientIp: "client-a",
  });

  assert.throws(rejectedRequest, (error) => error === rejection);

  const acceptedRequest = createLoginAttemptGuard({
    assertAuthRequest: () => {},
    rateLimiter,
    clientIp: "client-a",
  });

  assert.doesNotThrow(acceptedRequest);
});

// Purpose: Missing client identity must fail closed instead of sharing an invented IP.
test("rejects login when the client address is unavailable", () => {
  const beginLogin = createLoginAttemptGuard({
    assertAuthRequest: () => {},
    rateLimiter: createLoginRateLimiter(),
    clientIp: undefined,
  });

  assert.throws(beginLogin, LoginClientUnavailableError);
});

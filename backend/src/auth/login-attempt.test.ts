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

test("allows one login attempt per request", () => {
  const beginLogin = createLoginAttemptGuard({
    assertAuthRequest: () => {},
    rateLimiter: createLoginRateLimiter(),
    clientIp: "client-a",
  });

  beginLogin();

  assert.throws(beginLogin, LoginAlreadyAttemptedError);
});

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

  const secondRequest = createRequest();

  assert.throws(secondRequest, LoginRateLimitError);
});

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

test("rejects login when the client address is unavailable", () => {
  const beginLogin = createLoginAttemptGuard({
    assertAuthRequest: () => {},
    rateLimiter: createLoginRateLimiter(),
    clientIp: undefined,
  });

  assert.throws(beginLogin, LoginClientUnavailableError);
});

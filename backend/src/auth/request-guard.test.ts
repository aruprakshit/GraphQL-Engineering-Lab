import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthRequestRejectedError,
  createAuthRequestGuard,
} from "./request-guard.js";

const allowedOrigin = "http://localhost:4000";

test("accepts the configured browser origin", () => {
  const guard = createAuthRequestGuard(allowedOrigin);

  assert.doesNotThrow(() =>
    guard({
      method: "POST",
      origin: allowedOrigin,
      authHeader: "1",
    }),
  );
});

test("accepts CLI requests with the required header", () => {
  const guard = createAuthRequestGuard(allowedOrigin);

  assert.doesNotThrow(() => guard({ method: "POST", authHeader: "1" }));
});

test("rejects disallowed authentication requests", () => {
  const guard = createAuthRequestGuard(allowedOrigin);

  const requests = [
    { method: "GET", origin: allowedOrigin, authHeader: "1" },
    { method: "POST", origin: allowedOrigin },
    { method: "POST", authHeader: "wrong" },
    {
      method: "POST",
      origin: "http://localhost:4000.attacker.example",
      authHeader: "1",
    },
    {
      method: "POST",
      origin: "http://localhost:4001",
      authHeader: "1",
    },
    { method: "POST", origin: "null", authHeader: "1" },
  ];

  for (const request of requests) {
    assert.throws(() => guard(request), AuthRequestRejectedError);
  }
});

test("rejects invalid origin configuration", () => {
  for (const origin of [
    "",
    "*",
    "null",
    "ftp://localhost",
    "http://localhost:4000/path",
    "http://localhost:4000/",
  ]) {
    assert.throws(() => createAuthRequestGuard(origin));
  }
});

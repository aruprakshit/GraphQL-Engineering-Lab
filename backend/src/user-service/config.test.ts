import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InvalidUserServiceConfigError,
  parseUserServiceOptions,
} from "./config.js";

const serviceToken = "ab".repeat(32);

test("accepts and normalizes service origins", async (t) => {
  // Why: callers may supply an optional trailing slash, but the client
  // should receive a consistent origin for constructing its endpoint.
  // Arrange
  const cases = [
    {
      input: "http://user-service:4001",
      expected: "http://user-service:4001",
    },
    {
      input: "http://user-service:4001/",
      expected: "http://user-service:4001",
    },
    {
      input: "https://users.example.com",
      expected: "https://users.example.com",
    },
  ];

  // Act and Assert: run each scenario as an independently named subtest.
  for (const scenario of cases) {
    await t.test(scenario.input, () => {
      // Why: each supported input must normalize without altering the token.
      // Arrange
      const input = { baseUrl: scenario.input, serviceToken };

      // Act
      const result = parseUserServiceOptions(input);

      // Assert
      assert.deepEqual(result, {
        baseUrl: scenario.expected,
        serviceToken,
      });
    });
  }
});

test("rejects unsupported service URLs", async (t) => {
  // Why: the client owns the endpoint path. Configuration supplies only
  // an HTTP(S) origin, without credentials, query parameters, or fragments.
  // Arrange
  const cases = [
    { name: "missing URL", value: undefined },
    { name: "empty URL", value: "" },
    { name: "invalid URL", value: "not-a-url" },
    { name: "unsupported scheme", value: "ftp://users.example.com" },
    {
      name: "embedded credentials",
      value: "http://user:password@users.example.com",
    },
    {
      name: "endpoint path",
      value: "http://user-service:4001/internal/users/batch",
    },
    {
      name: "query parameters",
      value: "http://user-service:4001?debug=true",
    },
    {
      name: "fragment",
      value: "http://user-service:4001#section",
    },
    {
      name: "surrounding whitespace",
      value: " http://user-service:4001 ",
    },
  ];

  // Act and Assert: verify every rejected URL independently.
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      // Why: this invalid URL must fail even when its token is valid.
      // Arrange
      const input = { baseUrl: scenario.value, serviceToken };

      // Act: defer the call so assert.throws can observe its exception.
      const action = () => parseUserServiceOptions(input);

      // Assert
      assert.throws(action, InvalidUserServiceConfigError);
    });
  }
});

test("rejects missing or malformed service tokens", async (t) => {
  // Why: reject credentials outside the agreed format before any request;
  // do not silently trim, normalize, or accept an absent token.
  // Arrange
  const cases = [
    { name: "missing", value: undefined },
    { name: "empty", value: "" },
    { name: "too short", value: "ab".repeat(31) },
    { name: "too long", value: "ab".repeat(33) },
    { name: "uppercase", value: "AB".repeat(32) },
    { name: "non-hexadecimal", value: "zz".repeat(32) },
    { name: "surrounding whitespace", value: ` ${serviceToken} ` },
  ];

  // Act and Assert: verify every invalid credential independently.
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      // Why: this invalid token must fail even when the URL is valid.
      // Arrange
      const input = {
        baseUrl: "http://user-service:4001",
        serviceToken: scenario.value,
      };

      // Act: defer execution until the exception assertion runs.
      const action = () => parseUserServiceOptions(input);

      // Assert
      assert.throws(action, InvalidUserServiceConfigError);
    });
  }
});

test("rejects unexpected configuration fields", () => {
  // Why: browser credentials are not client configuration. Reject extra
  // fields rather than quietly accepting a broader configuration contract.
  // Arrange
  const input = {
    baseUrl: "http://user-service:4001",
    serviceToken,
    browserCookie: "must-not-be-forwarded",
  };

  // Act: defer execution until the exception assertion runs.
  const action = () => parseUserServiceOptions(input);

  // Assert
  assert.throws(action, InvalidUserServiceConfigError);
});

test("does not expose supplied credentials in configuration errors", () => {
  // Why: validation errors can reach logs. The public error must not
  // echo tokens, embedded URL credentials, or detailed Zod diagnostics.
  // Arrange
  const input = {
    baseUrl: "http://private-user:private-password@users.example.com",
    serviceToken: "private-invalid-token",
  };

  // Act: defer execution until the exception assertion runs.
  const action = () => parseUserServiceOptions(input);

  // Assert
  assert.throws(action, {
    name: "InvalidUserServiceConfigError",
    message: "Valid user-service URL and service token must be configured",
  });
});

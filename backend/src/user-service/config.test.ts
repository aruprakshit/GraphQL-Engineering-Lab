import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InvalidUserServiceConfigError,
  parseUserServiceOptions,
} from "./config.js";

const serviceToken = "ab".repeat(32);

// Accept supported origins and normalize the optional trailing slash.
test("accepts and normalizes service origins", async (t) => {
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

  for (const scenario of cases) {
    await t.test(scenario.input, () => {
      assert.deepEqual(
        parseUserServiceOptions({
          baseUrl: scenario.input,
          serviceToken,
        }),
        {
          baseUrl: scenario.expected,
          serviceToken,
        },
      );
    });
  }
});

// The client owns the endpoint path.
// Configuration must supply only an HTTP(S) origin without credentials.
test("rejects unsupported service URLs", async (t) => {
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

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () =>
          parseUserServiceOptions({
            baseUrl: scenario.value,
            serviceToken,
          }),
        InvalidUserServiceConfigError,
      );
    });
  }
});

test("rejects missing or malformed service tokens", async (t) => {
  const cases = [
    { name: "missing", value: undefined },
    { name: "empty", value: "" },
    { name: "too short", value: "ab".repeat(31) },
    { name: "too long", value: "ab".repeat(33) },
    { name: "uppercase", value: "AB".repeat(32) },
    { name: "non-hexadecimal", value: "zz".repeat(32) },
    { name: "surrounding whitespace", value: ` ${serviceToken} ` },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () =>
          parseUserServiceOptions({
            baseUrl: "http://user-service:4001",
            serviceToken: scenario.value,
          }),
        InvalidUserServiceConfigError,
      );
    });
  }
});

test("rejects unexpected configuration fields", () => {
  assert.throws(
    () =>
      parseUserServiceOptions({
        baseUrl: "http://user-service:4001",
        serviceToken,
        browserCookie: "must-not-be-forwarded",
      }),
    InvalidUserServiceConfigError,
  );
});

// Assert the exact public error instead of exposing Zod's details.
test("does not expose supplied credentials in configuration errors", () => {
  assert.throws(
    () =>
      parseUserServiceOptions({
        baseUrl: "http://private-user:private-password@users.example.com",
        serviceToken: "private-invalid-token",
      }),
    {
      name: "InvalidUserServiceConfigError",
      message: "Valid user-service URL and service token must be configured",
    },
  );
});

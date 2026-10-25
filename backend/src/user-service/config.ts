import * as z from "zod";
import type { UserServiceClientOptions } from "./types.js";

function isServiceOrigin(value: string): boolean {
  if (value !== value.trim()) {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

const clientOptionsSchema = z.strictObject({
  baseUrl: z
    .string()
    .refine(isServiceOrigin, {
      message: "Expected an HTTP or HTTPS service origin",
    })
    .transform((value) => new URL(value).origin),

  serviceToken: z.string().regex(/^[a-f0-9]{64}$/),
});

export class InvalidUserServiceConfigError extends Error {
  constructor() {
    super("Valid user-service URL and service token must be configured");
    this.name = "InvalidUserServiceConfigError";
  }
}

export function parseUserServiceOptions(
  input: unknown,
): UserServiceClientOptions {
  const result = clientOptionsSchema.safeParse(input);

  if (!result.success) {
    throw new InvalidUserServiceConfigError();
  }

  return result.data;
}

import { createHash, randomBytes } from "node:crypto";

// 32 RANDOM BYTES ENCODED AS 64 LOWERCASE HEX CHARACTERS
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

// CREATE AN UNPREDICTABLE TOKEN FOR THE CLIENT
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

// VALIDATE BEFORE HASHING OR QUERYING THE DATABASE
export function isSessionToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

// DERIVE THE VALUE STORED AS sessions._id
export function hashSessionToken(token: string): string {
  if (!isSessionToken(token)) {
    throw new Error("Invalid session token format");
  }

  return createHash("sha256").update(token, "utf8").digest("hex");
}

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { PasswordRecord } from "./models.js";

const PARAMETERS = {
  N: 131072,
  r: 8,
  p: 1,
  keyLength: 64,
};

// ALLOW HEADROOM ABOVE SCRYPT'S APPROXIMATE MEMORY REQUIREMENT
const MAX_MEMORY = 256 * 1024 * 1024;

// 1. DEFINE THE INPUT POLICY WITHOUT ALTERING THE PASSWORD
export function validatePassword(password: string): void {
  if (Buffer.byteLength(password, "utf8") > 1024) {
    throw new Error("Password exceeds the byte limit");
  }

  const characterCount = Array.from(password).length;

  if (characterCount < 15 || characterCount > 128) {
    throw new Error("Password must contain between 15 and 128 characters");
  }
}

// 2. WRAP NODE'S ASYNCHRONOUS SCRYPT API
function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      PARAMETERS.keyLength,
      {
        N: PARAMETERS.N,
        r: PARAMETERS.r,
        p: PARAMETERS.p,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

// 3. GENERATE A FRESH SALT AND BUILD THE STORED RECORD
export async function hashPassword(password: string): Promise<PasswordRecord> {
  validatePassword(password);

  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt);

  return {
    algorithm: "scrypt",
    version: 1,
    salt: salt.toString("hex"),
    hash: hash.toString("hex"),
    parameters: { ...PARAMETERS },
  };
}

// 4. VALIDATE STORED DATA BEFORE USING IT
function isPasswordRecord(value: unknown): value is PasswordRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (
    record.algorithm !== "scrypt" ||
    record.version !== 1 ||
    typeof record.salt !== "string" ||
    !/^[0-9a-f]{32}$/.test(record.salt) ||
    typeof record.hash !== "string" ||
    !/^[0-9a-f]{128}$/.test(record.hash)
  ) {
    return false;
  }

  if (typeof record.parameters !== "object" || record.parameters === null) {
    return false;
  }

  const parameters = record.parameters as Record<string, unknown>;

  // Only our supported parameter set is accepted in version 1.
  return (
    parameters.N === PARAMETERS.N &&
    parameters.r === PARAMETERS.r &&
    parameters.p === PARAMETERS.p &&
    parameters.keyLength === PARAMETERS.keyLength
  );
}

// 5. DERIVE THE CANDIDATE HASH AND COMPARE IT
export async function verifyPassword(
  password: string,
  stored: unknown,
): Promise<boolean> {
  if (!isPasswordRecord(stored)) {
    return false;
  }

  try {
    validatePassword(password);
  } catch {
    return false;
  }

  const salt = Buffer.from(stored.salt, "hex");
  const expectedHash = Buffer.from(stored.hash, "hex");

  const candidateHash = await derivePassword(password, salt);

  return timingSafeEqual(candidateHash, expectedHash);
}

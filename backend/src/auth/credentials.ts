import { randomBytes } from "node:crypto";
import type { Db } from "mongodb";
import type { UserDocument } from "../models.js";
import type {
  AccountDocument,
  AuthenticatedIdentity,
  LoginCredentials,
} from "./models.js";
import { createConcurrencyLimiter } from "./concurrency.js";
import { hashPassword, validatePassword, verifyPassword } from "./passwords.js";
import { normalizeUsername } from "./usernames.js";

// SHARED BY ALL LOGIN REQUESTS IN THIS PROCESS
const passwordLimiter = createConcurrencyLimiter(2);

export class InvalidLoginInputError extends Error {
  constructor() {
    super("Invalid login input");
    this.name = "InvalidLoginInputError";
  }
}

// INITIALIZE ONCE DURING APPLICATION STARTUP
export async function createCredentialVerifier(database: Db) {
  // 1. PRECOMPUTE A DUMMY RECORD; DO NOT LOG IT
  const dummyRecord = await hashPassword(randomBytes(32).toString("hex"));

  return async function verifyCredentials(
    input: LoginCredentials,
  ): Promise<AuthenticatedIdentity | null> {
    // 2. VALIDATE INPUT INDEPENDENTLY OF ACCOUNT EXISTENCE
    let username: string;

    try {
      if (
        typeof input.username !== "string" ||
        typeof input.password !== "string"
      ) {
        throw new Error("Expected string credentials");
      }

      username = normalizeUsername(input.username);
      validatePassword(input.password);
    } catch {
      throw new InvalidLoginInputError();
    }

    // 3. RESERVE CAPACITY BEFORE LOOKUP AND PASSWORD VERIFICATION
    return passwordLimiter.run(async () => {
      const account = await database
        .collection<AccountDocument>("accounts")
        .findOne({ username });

      // ALWAYS VERIFY A HASH, INCLUDING FOR UNKNOWN USERNAMES
      const matches = await verifyPassword(
        input.password,
        account?.password ?? dummyRecord,
      );

      if (!account || !matches) {
        return null;
      }

      // 4. REQUIRE A SUPPORTED ROLE AND EXISTING PUBLIC USER
      if (account.role !== "user" && account.role !== "admin") {
        return null;
      }

      const user = await database
        .collection<UserDocument>("users")
        .findOne({ _id: account._id }, { projection: { _id: 1, name: 1 } });

      if (!user) {
        return null;
      }

      // 5. RETURN IDENTITY WITHOUT CREDENTIALS
      return {
        userId: user._id,
        name: user.name,
        role: account.role,
      };
    });
  };
}

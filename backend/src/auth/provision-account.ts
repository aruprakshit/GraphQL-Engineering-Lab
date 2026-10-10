import { MongoServerError, type Db } from "mongodb";
import type { UserDocument } from "../models.js";
import type { AccountDocument } from "./models.js";
import { hashPassword } from "./passwords.js";
import { normalizeUsername } from "./usernames.js";

interface ProvisionAccountInput {
  userId: string;
  username: string;
  password: string;
  role?: "user" | "admin";
}

export async function provisionAccount(
  database: Db,
  input: ProvisionAccountInput,
) {
  // 1. VALIDATE ACCOUNT IDENTITY AND ROLE
  const username = normalizeUsername(input.username);
  const role = input.role ?? "user";

  if (role !== "user" && role !== "admin") {
    throw new Error("Unsupported account role");
  }

  if (
    typeof input.userId !== "string" ||
    input.userId.length === 0 ||
    input.userId.length > 256
  ) {
    throw new Error("A valid user ID is required");
  }

  // 2. REQUIRE AN EXISTING PUBLIC USER
  const user = await database
    .collection<UserDocument>("users")
    .findOne({ _id: input.userId }, { projection: { _id: 1, name: 1 } });

  if (!user) {
    throw new Error("Public user not found; provision the user first");
  }

  const accounts = database.collection<AccountDocument>("accounts");

  // 3. REJECT EXISTING ACCOUNTS BEFORE EXPENSIVE HASHING
  const existingAccount = await accounts.findOne(
    {
      $or: [{ _id: input.userId }, { username }],
    },
    { projection: { _id: 1 } },
  );

  if (existingAccount) {
    throw new Error("An account already exists for this user or username");
  }

  // 4. HASH AND INSERT; NEVER UPDATE EXISTING CREDENTIALS
  const password = await hashPassword(input.password);

  try {
    await accounts.insertOne({
      _id: input.userId,
      username,
      role,
      password,
    });
  } catch (error: unknown) {
    // Indexes also protect against concurrent provisioning attempts.
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new Error("An account already exists for this user or username");
    }

    throw error;
  }

  // 5. RETURN ONLY A SAFE PROVISIONING SUMMARY
  return {
    userId: input.userId,
    username,
    role,
  };
}

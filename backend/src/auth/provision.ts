import { password as promptPassword } from "@inquirer/prompts";
import { parseArgs } from "node:util";
import { connectDatabase, database, mongoClient } from "../database.js";
import { validatePassword } from "./passwords.js";
import { normalizeUsername } from "./usernames.js";
import { provisionAccount } from "./provision-account.js";

async function provision(): Promise<void> {
  try {
    // 1. ACCEPT NONSECRET COMMAND OPTIONS
    const { values } = parseArgs({
      options: {
        "user-id": { type: "string" },
        username: { type: "string" },
        admin: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });

    const userId = values["user-id"];

    if (!userId || !values.username) {
      throw new Error("Both --user-id and --username are required");
    }

    const username = normalizeUsername(values.username);

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("Provisioning requires an interactive terminal");
    }

    // 2. COLLECT THE PASSWORD WITHOUT ECHOING IT
    const password = await promptPassword({
      message: "Password:",
      validate: (value) => {
        try {
          validatePassword(value);
          return true;
        } catch {
          return "Use a password containing 15–128 characters";
        }
      },
    });

    const confirmation = await promptPassword({
      message: "Confirm password:",
    });

    if (password !== confirmation) {
      throw new Error("Passwords do not match");
    }

    // 3. PROVISION THROUGH THE ACCOUNT SERVICE
    await connectDatabase();

    const account = await provisionAccount(database, {
      userId,
      username,
      password,
      role: values.admin ? "admin" : "user",
    });

    // 4. PRINT ONLY THE PUBLIC SUMMARY
    console.log("Account provisioned:", account);
  } finally {
    await mongoClient.close();
  }
}

provision().catch(() => {
  // Avoid dumping database errors that might contain credential data.
  console.error(
    "Provisioning failed. Check the input, account uniqueness, and database availability.",
  );
  process.exitCode = 1;
});

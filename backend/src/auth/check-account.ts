import assert from "node:assert/strict";
import { password as promptPassword } from "@inquirer/prompts";
import { connectDatabase, database, mongoClient } from "../database.js";
import type { AccountDocument } from "./models.js";
import { verifyPassword } from "./passwords.js";

async function checkAccount(): Promise<void> {
  try {
    const password = await promptPassword({
      message: "Enter Ada's original password:",
    });

    await connectDatabase();

    const account = await database
      .collection<AccountDocument>("accounts")
      .findOne({ _id: "user-1" });

    assert.ok(account, "Ada's account must exist");
    assert.equal(account.username, "ada");
    assert.equal(account.role, "user");
    assert.equal(
      await verifyPassword(password, account.password),
      true,
      "The original password must still work",
    );

    console.log("Existing account and original password preserved");
  } finally {
    await mongoClient.close();
  }
}

checkAccount().catch(() => {
  console.error("Account verification failed");
  process.exitCode = 1;
});

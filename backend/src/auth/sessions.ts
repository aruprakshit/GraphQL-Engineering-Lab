import type { Db } from "mongodb";
import type { UserDocument } from "../models.js";
import type {
  AccountDocument,
  Actor,
  SessionDocument,
  CreatedSession,
} from "./models.js";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
} from "./session-tokens.js";

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

// LOAD CURRENT IDENTITY WITHOUT FETCHING PASSWORD CREDENTIALS
async function resolveAccountActor(
  database: Db,
  accountId: string,
): Promise<Actor | null> {
  const account = await database
    .collection<AccountDocument>("accounts")
    .findOne({ _id: accountId }, { projection: { _id: 1, role: 1 } });

  if (!account || (account.role !== "user" && account.role !== "admin")) {
    return null;
  }

  const user = await database
    .collection<UserDocument>("users")
    .findOne({ _id: account._id }, { projection: { _id: 1 } });

  if (!user) {
    return null;
  }

  return {
    userId: user._id,
    role: account.role,
  };
}

// CREATE A SESSION AFTER THE CALLER HAS VERIFIED CREDENTIALS
export async function createSession(
  database: Db,
  accountId: string,
  now: Date = new Date(),
): Promise<CreatedSession> {
  const actor = await resolveAccountActor(database, accountId);

  if (!actor) {
    throw new Error("Cannot create a session for an unavailable account");
  }

  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);

  await database.collection<SessionDocument>("sessions").insertOne({
    _id: hashSessionToken(token),
    accountId,
    createdAt: new Date(now.getTime()),
    expiresAt,
  });

  return { token, expiresAt };
}

// RESOLVE ONLY AN UNEXPIRED SESSION TO A CURRENT ACTOR
export async function resolveSession(
  database: Db,
  token: unknown,
  now: Date = new Date(),
): Promise<Actor | null> {
  if (!isSessionToken(token)) {
    return null;
  }

  const session = await database
    .collection<SessionDocument>("sessions")
    .findOne({
      _id: hashSessionToken(token),
      expiresAt: { $gt: now },
    });

  if (!session) {
    return null;
  }

  return resolveAccountActor(database, session.accountId);
}

// REVOKE ONLY THE SUPPLIED SESSION
export async function revokeSession(
  database: Db,
  token: unknown,
): Promise<void> {
  if (!isSessionToken(token)) {
    return;
  }

  await database.collection<SessionDocument>("sessions").deleteOne({
    _id: hashSessionToken(token),
  });
}

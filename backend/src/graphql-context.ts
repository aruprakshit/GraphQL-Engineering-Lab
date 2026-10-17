import type { Db } from "mongodb";
import type { createUserLoader } from "./loaders.js";
import type { createCredentialVerifier } from "./auth/credentials.js";
import type { Actor, CreatedSession } from "./auth/models.js";

export interface GraphQLContext {
  requestId: string;
  database: Db;
  logDatabaseCall: (operation: string) => void;
  userLoader: ReturnType<typeof createUserLoader>;
  verifyCredentials: Awaited<ReturnType<typeof createCredentialVerifier>>;
  assertAuthRequest: () => void;
  setSessionCookie: (session: CreatedSession) => void;
  beginLogin: () => void;
  getActor: () => Promise<Actor | null>;
}

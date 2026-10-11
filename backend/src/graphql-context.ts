import type { Db } from "mongodb";
import type { createUserLoader } from "./loaders.js";
import type { createCredentialVerifier } from "./auth/credentials.js";
import type { CreatedSession } from "./auth/models.js";

export interface GraphQLContext {
  requestId: string;
  database: Db;
  logDatabaseCall: (operation: string) => void;
  userLoader: ReturnType<typeof createUserLoader>;
  verifyCredentials: Awaited<ReturnType<typeof createCredentialVerifier>>;

  setSessionCookie: (session: CreatedSession) => void;
}

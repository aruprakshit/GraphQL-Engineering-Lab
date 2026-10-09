import type { Db } from "mongodb";
import type { createUserLoader } from "./loaders.js";

export interface GraphQLContext {
  requestId: string;
  database: Db;
  logDatabaseCall: (operation: string) => void;
  userLoader: ReturnType<typeof createUserLoader>;
}

import type { Db } from "mongodb";
import type { UserDocument } from "../../src/models.js";
import { createProfileLoader } from "../../src/user-service/loader.js";
import type { UserServiceClient } from "../../src/user-service/types.js";

// Test-only adapter for existing MongoDB authorization fixtures.
// Uses the production DataLoader, but replaces its HTTP dependency.
// Transport behavior is tested separately by the HTTP-client tests.
export function createTestProfileLoader(database: Db, requestId: string) {
  const client: UserServiceClient = {
    async findProfiles(ids) {
      const users = await database
        .collection<UserDocument>("users")
        .find({ _id: { $in: [...ids] } }, { projection: { _id: 1, name: 1 } })
        .toArray();

      return users.map((user) => ({
        id: user._id,
        displayName: user.name,
      }));
    },
  };

  return createProfileLoader(client, requestId);
}

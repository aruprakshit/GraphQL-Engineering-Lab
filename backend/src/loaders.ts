import DataLoader from "dataloader";
import type { Db } from "mongodb";
import type { UserDocument } from "./models.js";
import { measureOperation } from "./timing.js";

// CREATE A LOADER WITH ITS OWN BATCH QUEUE AND CACHE
export function createUserLoader(
  database: Db,
  logDatabaseCall: (operation: string) => void,
  requestId: string,
): DataLoader<string, UserDocument | null> {
  return new DataLoader<string, UserDocument | null>(async (ids) => {
    // 1. FETCH ALL REQUESTED USERS IN ONE DATABASE QUERY
    logDatabaseCall(`users.find $in=${JSON.stringify(ids)}`);

    const users = await measureOperation(requestId, "users.find", () =>
      database
        .collection<UserDocument>("users")
        .find({
          _id: { $in: [...ids] },
        })
        .toArray(),
    );

    console.log(
      JSON.stringify({
        event: "users_batch",
        requestId,
        uniqueIdCount: ids.length,
        returnedUserCount: users.length,
      }),
    );

    // 2. INDEX THE RESULTS BY ID
    const usersById = new Map(users.map((user) => [user._id, user]));

    // 3. RETURN ONE RESULT PER INPUT ID, IN INPUT ORDER
    return ids.map((id) => usersById.get(id) ?? null);
  });
}

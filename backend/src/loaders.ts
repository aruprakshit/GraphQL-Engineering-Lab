import DataLoader from "dataloader";
import type { Db } from "mongodb";
import type { UserDocument } from "./models.js";
import { measureOperation } from "./timing.js";
import { withSpan } from "./tracing.js";

export function createUserLoader(
  database: Db,
  logDatabaseCall: (operation: string) => void,
  requestId: string,
): DataLoader<string, UserDocument | null> {
  return new DataLoader<string, UserDocument | null>((ids) =>
    withSpan(
      "dataloader.users.batch",
      {
        "app.request_id": requestId,
        "dataloader.unique_id_count": ids.length,
      },
      async (span) => {
        // 1. FETCH ALL REQUESTED USERS IN ONE QUERY
        logDatabaseCall(`users.find $in=${JSON.stringify(ids)}`);

        const users = await measureOperation(requestId, "users.find", () =>
          database
            .collection<UserDocument>("users")
            .find({ _id: { $in: [...ids] } })
            .toArray(),
        );

        // 2. RECORD THE BATCH RESULT SIZE
        span.setAttribute("dataloader.returned_user_count", users.length);

        // 3. PRESERVE THE LOADER'S ORDERING CONTRACT
        const usersById = new Map(users.map((user) => [user._id, user]));

        return ids.map((id) => usersById.get(id) ?? null);
      },
    ),
  );
}

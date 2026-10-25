import DataLoader from "dataloader";
import { withSpan } from "../tracing.js";
import type { PublicProfile, UserServiceClient } from "./types.js";

/**
 * GraphQL author IDs
 *       ↓
 * Request-scoped DataLoader collects and deduplicates keys
 *       ↓
 * HTTP client returns existing profiles in unspecified order
 *       ↓
 * Index profiles by ID
 *       ↓
 * Return one profile or null for each key in the original order
 *
 * Example:
 * Keys:     [user-3, missing-user, user-1]
 * Profiles: [Ada/user-1, Linus/user-3]
 * Results:  [Linus/user-3, null, Ada/user-1]
 */
export function createProfileLoader(
  client: UserServiceClient,
  requestId: string,
): DataLoader<string, PublicProfile | null> {
  return new DataLoader<string, PublicProfile | null>((ids) =>
    withSpan(
      "dataloader.users.batch",
      {
        "app.request_id": requestId,
        "dataloader.unique_id_count": ids.length,
      },
      async (span) => {
        const profiles = await client.findProfiles(ids);

        span.setAttribute("dataloader.returned_user_count", profiles.length);

        const profilesById = new Map(
          profiles.map((profile) => [profile.id, profile]),
        );

        return ids.map((id) => profilesById.get(id) ?? null);
      },
    ),
  );
}

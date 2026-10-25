import { UserServiceUnavailableError } from "./errors.js";
import { batchResponseSchema } from "./schemas.js";
import type { PublicProfile } from "./types.js";

/**
 * Parsed JSON
 *     ↓
 * Validate envelope and profile fields with Zod
 *     ↓
 * Check every returned ID against this request
 *     ├── Unrequested ID → reject
 *     ├── Duplicate ID   → reject
 *     ↓
 * Return validated profiles
 *
 * Missing requested IDs are allowed: they represent missing profiles.
 * Response order is unspecified and does not need to match request order.
 */
export function validateProfileResponse(
  input: unknown,
  requestedIds: readonly string[],
): PublicProfile[] {
  const result = batchResponseSchema.safeParse(input);

  if (!result.success) {
    throw new UserServiceUnavailableError("INVALID_RESPONSE");
  }

  const requested = new Set(requestedIds);
  const returned = new Set<string>();

  for (const profile of result.data.users) {
    if (!requested.has(profile.id) || returned.has(profile.id)) {
      throw new UserServiceUnavailableError("INVALID_RESPONSE");
    }

    returned.add(profile.id);
  }

  return result.data.users;
}

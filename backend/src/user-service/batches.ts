import { InvalidUserServiceInputError } from "./errors.js";
import { profileIdsSchema } from "./schemas.js";

export const MAX_BATCH_IDS = 100;
export const MAX_REQUEST_BYTES = 32 * 1024;

// One future HTTP request: its IDs and the exact JSON text to send.
// This file prepares requests; it does not send them over the network.
export interface ProfileRequestBatch {
  ids: string[];
  body: string;
}

// Example: ["user-1"] becomes:
// { ids: ["user-1"], body: '{"ids":["user-1"]}' }
// Keeping the JSON text means the HTTP client sends what we measured.
function createBatch(ids: string[]): ProfileRequestBatch {
  return {
    ids,
    body: JSON.stringify({ ids }),
  };
}

// A request must fit BOTH limits: number of IDs and JSON body bytes.
// String length alone is not a byte count. JSON also adds property
// names, quotes, commas, and escaping, so measure the serialized body.
function fitsBatch(batch: ProfileRequestBatch): boolean {
  return (
    batch.ids.length <= MAX_BATCH_IDS &&
    Buffer.byteLength(batch.body, "utf8") <= MAX_REQUEST_BYTES
  );
}

/**
 * Split lookup IDs into groups that the user service can accept.
 *
 * Think of filling boxes: try adding the next ID to the current box.
 * If it no longer fits, save the current box and start another one.
 *
 * Example with an IMAGINARY limit of 2 IDs per request:
 *
 * Input:          ["user-3", "user-1", "user-3", "user-2"]
 * After deduping: ["user-3", "user-1", "user-2"]
 * First batch:    ["user-3", "user-1"]
 * Second batch:   ["user-2"]
 *
 * Our real limits are 100 IDs AND 32 KiB per request. Large IDs or
 * JSON escaping can fill the byte budget before reaching 100 IDs.
 *
 * Empty input returns []; no empty HTTP request is needed.
 */
export function buildProfileBatches(
  ids: readonly string[],
): ProfileRequestBatch[] {
  // 1. Validate the entire input before preparing any batches.
  const result = profileIdsSchema.safeParse(ids);

  if (!result.success) {
    throw new InvalidUserServiceInputError();
  }

  // 2. Remove duplicates, preserving the order first encountered.
  const uniqueIds = [...new Set(result.data)];
  // batches holds finished groups; current is the group being filled.
  const batches: ProfileRequestBatch[] = [];
  let current = createBatch([]);

  for (const id of uniqueIds) {
    // 3. Try adding this ID without changing current yet.
    const candidate = createBatch([...current.ids, id]);

    // It fits: keep the larger group and move to the next ID.
    if (fitsBatch(candidate)) {
      current = candidate;
      continue;
    }

    // 4. It does not fit: save the group WITHOUT the new ID.
    if (current.ids.length > 0) {
      batches.push(current);
    }

    // Put the ID that did not fit into a fresh group. It is not lost.
    current = createBatch([id]);

    // A single valid ID fits under today's limits. Keep this guard
    // in case a future policy change makes even one ID too large.
    if (!fitsBatch(current)) {
      throw new InvalidUserServiceInputError();
    }
  }

  // 5. Save the last group: no later ID will trigger saving it.
  if (current.ids.length > 0) {
    batches.push(current);
  }

  return batches;
}

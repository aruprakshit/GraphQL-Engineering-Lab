import type { Db } from "mongodb";
import * as z from "zod";
import type { BatchInput } from "./batch-input.js";

const storedProfileSchema = z.object({
  _id: z.string().refine((value) => value.length >= 1 && value.length <= 256, {
    message: "ID must contain 1 to 256 UTF-16 code units",
  }),
  name: z
    .string()
    .refine(
      (value) => value.length > 0 && Buffer.byteLength(value, "utf8") <= 128,
      { message: "Name must be nonempty and at most 128 UTF-8 bytes" },
    ),
});

type StoredProfile = z.infer<typeof storedProfileSchema>;

export interface PublicProfile {
  id: string;
  displayName: string;
}

export class InvalidStoredProfileError extends Error {
  constructor() {
    super("Stored profile does not satisfy the public profile contract");
    this.name = "InvalidStoredProfileError";
  }
}

function toPublicProfile(profile: unknown): PublicProfile {
  const result = storedProfileSchema.safeParse(profile);

  if (!result.success) {
    throw new InvalidStoredProfileError();
  }

  return {
    id: result.data._id,
    displayName: result.data.name,
  };
}

// Called with input that has already passed parseBatchInput.
//
// Validated IDs
//     ↓
// Deduplicate
//     ↓
// One MongoDB query, projecting only _id and name
//     ↓
// Validate stored profiles with Zod and map public fields
export async function findPublicProfiles(
  database: Db,
  input: BatchInput,
): Promise<PublicProfile[]> {
  const uniqueIds = [...new Set(input.ids)];

  const profiles = await database
    .collection<StoredProfile>("users")
    .find({ _id: { $in: uniqueIds } }, { projection: { _id: 1, name: 1 } })
    .toArray();

  return profiles.map(toPublicProfile);
}

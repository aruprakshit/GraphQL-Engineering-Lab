export interface BatchInput {
  ids: string[];
}

export class InvalidBatchInputError extends Error {
  constructor() {
    super(
      "Expected only ids: an array of 1 to 100 nonempty strings, each at most 256 characters",
    );
    this.name = "InvalidBatchInputError";
  }
}

export function parseBatchInput(input: unknown): BatchInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new InvalidBatchInputError();
  }

  const fields = Object.keys(input);

  if (fields.length !== 1 || fields[0] !== "ids") {
    throw new InvalidBatchInputError();
  }

  const ids = (input as Record<string, unknown>).ids;

  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) {
    throw new InvalidBatchInputError();
  }

  const validatedIds: string[] = [];

  for (const id of ids) {
    if (typeof id !== "string" || id.length < 1 || id.length > 256) {
      throw new InvalidBatchInputError();
    }

    validatedIds.push(id);
  }

  return { ids: validatedIds };
}

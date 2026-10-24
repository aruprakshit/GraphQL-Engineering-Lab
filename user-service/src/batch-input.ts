import * as z from "zod";

const batchInputSchema = z.strictObject({
  ids: z
    .array(
      z
        .string()
        .refine((value) => value.length >= 1 && value.length <= 256, {
          message: "ID must contain 1 to 256 UTF-16 code units",
        }),
    )
    .min(1)
    .max(100),
});

export type BatchInput = z.infer<typeof batchInputSchema>;

export class InvalidBatchInputError extends Error {
  constructor() {
    super(
      "Expected only ids: an array of 1 to 100 nonempty strings, each at most 256 characters",
    );
    this.name = "InvalidBatchInputError";
  }
}

export function parseBatchInput(input: unknown): BatchInput {
  const result = batchInputSchema.safeParse(input);

  if (!result.success) {
    throw new InvalidBatchInputError();
  }

  return result.data;
}

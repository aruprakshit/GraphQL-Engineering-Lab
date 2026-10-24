import * as z from "zod";

const serviceConfigSchema = z.object({
  serviceToken: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

export function readConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  const result = serviceConfigSchema.safeParse({
    serviceToken: environment.USER_SERVICE_TOKEN,
  });

  if (!result.success) {
    throw new Error(
      "USER_SERVICE_TOKEN must contain exactly 64 lowercase hexadecimal characters",
    );
  }

  return result.data;
}

const databaseConfigSchema = z.object({
  mongoUrl: z
    .string()
    .refine(
      (value) =>
        value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"),
      { message: "A MongoDB connection URL is required" },
    ),
  databaseName: z
    .string()
    .refine(
      (value) =>
        value.length > 0 &&
        Buffer.byteLength(value, "utf8") <= 63 &&
        !/[\/\\."$\s\0]/.test(value),
      { message: "A valid MongoDB database name is required" },
    ),
});

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

export function readDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const result = databaseConfigSchema.safeParse({
    mongoUrl: environment.MONGO_URL,
    databaseName: environment.MONGO_DB,
  });

  if (!result.success) {
    throw new Error("Valid MONGO_URL and MONGO_DB must be configured");
  }

  return result.data;
}

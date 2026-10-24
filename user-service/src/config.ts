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

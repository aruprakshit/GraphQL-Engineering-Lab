export interface ServiceConfig {
  serviceToken: string;
}

export function readConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  const serviceToken = environment.USER_SERVICE_TOKEN;

  if (!serviceToken || !/^[a-f0-9]{64}$/.test(serviceToken)) {
    throw new Error(
      "USER_SERVICE_TOKEN must contain exactly 64 lowercase hexadecimal characters",
    );
  }

  return { serviceToken };
}

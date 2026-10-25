import { SpanStatusCode, trace } from "@opentelemetry/api";
import { shutdownTelemetry } from "./instrumentation.js";
import { createUserServiceClient } from "./user-service/client.js";
import { parseUserServiceOptions } from "./user-service/config.js";
import { UserServiceUnavailableError } from "./user-service/errors.js";

const tracer = trace.getTracer("graphql-engineering-lab.user-service-check");

try {
  const options = parseUserServiceOptions({
    baseUrl: process.env.USER_SERVICE_URL,
    serviceToken: process.env.USER_SERVICE_TOKEN,
  });

  const client = createUserServiceClient(options);

  await tracer.startActiveSpan("user-service.client.check", async (span) => {
    try {
      const profiles = await client.findProfiles([
        "user-3",
        "missing-user",
        "user-1",
        "user-3",
      ]);

      console.log({
        event: "user_service_check",
        traceId: span.spanContext().traceId,
        returnedProfileCount: profiles.length,
      });

      console.log(profiles);
    } catch (error: unknown) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "User service check failed",
      });

      throw error;
    } finally {
      span.end();
    }
  });
} catch (error: unknown) {
  console.error({
    event: "user_service_check_failed",
    reason:
      error instanceof UserServiceUnavailableError
        ? error.reason
        : "CONFIGURATION_OR_UNEXPECTED_ERROR",
  });

  process.exitCode = 1;
} finally {
  // Export finished spans before this short-lived process exits.
  await shutdownTelemetry();
}

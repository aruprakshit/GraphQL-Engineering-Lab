import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { Span } from "@opentelemetry/api";
import { UserServiceUnavailableError } from "./errors.js";
import type { PublicProfile } from "./types.js";

const tracer = trace.getTracer("graphql-engineering-lab.user-service");

export function createServiceRequestHeaders(
  serviceToken: string,
): Record<string, string> {
  const carrier: Record<string, string> = {};

  propagation.inject(context.active(), carrier);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceToken}`,
  };

  // Forward trace context only, not baggage or browser credentials.
  for (const name of ["traceparent", "tracestate"]) {
    const value = carrier[name];

    if (value !== undefined) {
      headers[name] = value;
    }
  }

  return headers;
}

/**
 * Active caller span
 *       ↓
 * user-service.batch client span
 *       ↓
 * Inject this span's context into the outgoing request
 *       ↓
 * User-service HTTP span becomes its remote child
 *
 * Record counts and outcomes, never tokens, ID lists, or full bodies.
 */
export function withUserServiceBatchSpan(
  idCount: number,
  timeoutMs: number,
  work: (span: Span) => Promise<PublicProfile[]>,
): Promise<PublicProfile[]> {
  return tracer.startActiveSpan(
    "user-service.batch",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.request.method": "POST",
        "user_service.batch.id_count": idCount,
        "user_service.timeout_ms": timeoutMs,
      },
    },
    async (span) => {
      try {
        const profiles = await work(span);

        span.setAttribute("user_service.batch.returned_count", profiles.length);
        span.setAttribute("user_service.outcome", "success");

        return profiles;
      } catch (error: unknown) {
        span.setAttribute("user_service.outcome", "failure");
        span.setAttribute(
          "user_service.failure_reason",
          error instanceof UserServiceUnavailableError
            ? error.reason
            : "UNEXPECTED_ERROR",
        );

        // Do not record arbitrary exception messages or objects:
        // they could contain credentials or response details.
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "User service lookup failed",
        });

        throw error;
      } finally {
        span.end();
      }
    },
  );
}

import {
  trace,
  SpanStatusCode,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

const tracer = trace.getTracer("graphql-engineering-lab");

// RUN WORK INSIDE AN ACTIVE SPAN AND ALWAYS END IT
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await work(span);
    } catch (error: unknown) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

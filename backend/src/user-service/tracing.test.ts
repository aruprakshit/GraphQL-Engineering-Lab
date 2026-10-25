import assert from "node:assert/strict";
import { test } from "node:test";
import {
  context,
  createTraceState,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { UserServiceUnavailableError } from "./errors.js";
import {
  createServiceRequestHeaders,
  withUserServiceBatchSpan,
} from "./tracing.js";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { createUserServiceClient } from "./client.js";

test("user service tracing", async (t) => {
  // Why: collect real spans locally and exercise asynchronous context
  // propagation without exporting telemetry to an external service.

  // Arrange
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager().enable();

  t.after(async () => {
    try {
      await provider.shutdown();
    } finally {
      context.disable();
      propagation.disable();
      trace.disable();
      contextManager.disable();
    }
  });

  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  );

  // Act and Assert: exercise each tracing outcome independently.
  await t.test("propagates the active batch span without baggage", async () => {
    // Why: the receiving service must join the same trace beneath the
    // outgoing batch span, while unrelated baggage stays private.

    // Arrange
    exporter.reset();

    const serviceToken = "ab".repeat(32);
    const parentTraceId = "1".repeat(32);
    const parentSpanId = "2".repeat(16);

    const parentContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: parentTraceId,
      spanId: parentSpanId,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
      traceState: createTraceState("vendor=value"),
    });

    const callerContext = propagation.setBaggage(
      parentContext,
      propagation.createBaggage({
        private: { value: "must-not-be-forwarded" },
      }),
    );

    let headers: Record<string, string> = {};
    let batchSpanId = "";

    // Act
    const profiles = await context.with(callerContext, () =>
      withUserServiceBatchSpan(2, 500, async (span) => {
        await Promise.resolve();

        batchSpanId = span.spanContext().spanId;
        headers = createServiceRequestHeaders(serviceToken);
        span.setAttribute("http.response.status_code", 200);

        return [{ id: "user-1", displayName: "Ada" }];
      }),
    );

    await provider.forceFlush();

    // Assert
    assert.deepEqual(profiles, [{ id: "user-1", displayName: "Ada" }]);
    assert.equal(headers.traceparent, `00-${parentTraceId}-${batchSpanId}-01`);
    assert.notEqual(batchSpanId, parentSpanId);
    assert.equal(headers.tracestate, "vendor=value");
    assert.equal(headers.baggage, undefined);
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.Authorization, `Bearer ${serviceToken}`);
    assert.deepEqual(Object.keys(headers).sort(), [
      "Accept",
      "Authorization",
      "Content-Type",
      "traceparent",
      "tracestate",
    ]);

    const spans = exporter.getFinishedSpans();

    assert.equal(spans.length, 1);

    const span = spans[0]!;

    assert.equal(span.name, "user-service.batch");
    assert.equal(span.kind, SpanKind.CLIENT);
    assert.equal(span.spanContext().traceId, parentTraceId);
    assert.equal(span.parentSpanContext?.spanId, parentSpanId);
    assert.equal(span.attributes["user_service.batch.id_count"], 2);
    assert.equal(span.attributes["user_service.timeout_ms"], 500);
    assert.equal(span.attributes["http.response.status_code"], 200);
    assert.equal(span.attributes["user_service.batch.returned_count"], 1);
    assert.equal(span.attributes["user_service.outcome"], "success");
    assert.notEqual(span.status.code, SpanStatusCode.ERROR);
    assert.equal(span.events.length, 0);

    const recordedData = JSON.stringify({
      attributes: span.attributes,
      events: span.events,
      status: span.status,
    });

    assert.equal(recordedData.includes(serviceToken), false);
    assert.equal(recordedData.includes("user-1"), false);
    assert.equal(recordedData.includes("must-not-be-forwarded"), false);
  });

  await t.test("ends the span and records a classified failure", async () => {
    // Why: a failed lookup must finish its span, retain its failure
    // classification, and preserve the error returned to the caller.

    // Arrange
    exporter.reset();
    const failure = new UserServiceUnavailableError("TIMEOUT");

    // Act
    const operation = withUserServiceBatchSpan(1, 500, async () => {
      throw failure;
    });

    // Assert
    await assert.rejects(operation, (error: unknown) => error === failure);
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();

    assert.equal(spans.length, 1);

    const span = spans[0]!;

    assert.equal(span.status.code, SpanStatusCode.ERROR);
    assert.equal(span.attributes["user_service.outcome"], "failure");
    assert.equal(span.attributes["user_service.failure_reason"], "TIMEOUT");
    assert.equal(span.events.length, 0);
  });

  await t.test("does not record unexpected exception details", async () => {
    // Why: arbitrary exceptions may contain secrets. Record a generic
    // span status without copying their message into trace events.

    // Arrange
    exporter.reset();
    const privateDetails = "private-token-and-response-details";
    const failure = new Error(privateDetails);

    // Act
    const operation = withUserServiceBatchSpan(1, 500, async () => {
      throw failure;
    });

    // Assert
    await assert.rejects(operation, (error: unknown) => error === failure);
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();

    assert.equal(spans.length, 1);

    const span = spans[0]!;

    assert.equal(span.status.code, SpanStatusCode.ERROR);
    assert.equal(
      span.attributes["user_service.failure_reason"],
      "UNEXPECTED_ERROR",
    );
    assert.equal(span.status.message, "User service lookup failed");
    assert.equal(span.events.length, 0);

    const recordedData = JSON.stringify({
      attributes: span.attributes,
      events: span.events,
      status: span.status,
    });

    assert.equal(recordedData.includes(privateDetails), false);
  });

  await t.test("sends the batch span context over HTTP", async (t) => {
    // Why: helper tests alone cannot prove the HTTP client creates an
    // active span before constructing and sending its request headers.

    // Arrange
    exporter.reset();

    const serviceToken = "ab".repeat(32);
    const parentTraceId = "3".repeat(32);
    const parentSpanId = "4".repeat(16);

    let receivedHeaders: IncomingHttpHeaders = {};
    let receivedPath: string | undefined;
    let requestCount = 0;

    const server = createServer((request, response) => {
      requestCount += 1;
      receivedHeaders = request.headers;
      receivedPath = request.url;
      request.resume();

      response.writeHead(200, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({
          users: [{ id: "user-1", displayName: "Ada" }],
        }),
      );
    });

    t.after(async () => {
      server.closeAllConnections();

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    assert.ok(address && typeof address === "object");

    const client = createUserServiceClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      serviceToken,
    });

    const parentContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: parentTraceId,
      spanId: parentSpanId,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
      traceState: createTraceState("vendor=value"),
    });

    const callerContext = propagation.setBaggage(
      parentContext,
      propagation.createBaggage({
        private: { value: "must-not-cross-http" },
      }),
    );

    // Act
    const profiles = await context.with(callerContext, () =>
      client.findProfiles(["user-1"]),
    );

    await provider.forceFlush();

    // Assert
    assert.deepEqual(profiles, [{ id: "user-1", displayName: "Ada" }]);
    assert.equal(requestCount, 1);
    assert.equal(receivedPath, "/internal/users/batch");

    const spans = exporter.getFinishedSpans();

    assert.equal(spans.length, 1);

    const span = spans[0]!;

    assert.equal(span.kind, SpanKind.CLIENT);
    assert.equal(span.spanContext().traceId, parentTraceId);
    assert.equal(span.parentSpanContext?.spanId, parentSpanId);

    assert.equal(
      receivedHeaders.traceparent,
      `00-${parentTraceId}-${span.spanContext().spanId}-01`,
    );
    assert.equal(receivedHeaders.tracestate, "vendor=value");
    assert.equal(receivedHeaders.baggage, undefined);
    assert.equal(receivedHeaders.cookie, undefined);
    assert.equal(receivedHeaders.authorization, `Bearer ${serviceToken}`);

    assert.equal(span.attributes["http.response.status_code"], 200);
    assert.equal(span.attributes["user_service.batch.returned_count"], 1);
    assert.equal(span.attributes["user_service.outcome"], "success");
  });
});

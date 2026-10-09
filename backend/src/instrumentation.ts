import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { MongoDBInstrumentation } from "@opentelemetry/instrumentation-mongodb";

// 1. REPORT TELEMETRY WARNINGS AND EXPORT FAILURES
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

// 2. CONFIGURE TRACE EXPORT AND AUTOMATIC INSTRUMENTATION
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new MongoDBInstrumentation(),
  ],
});

// 3. START BEFORE EXPRESS AND MONGODB ARE IMPORTED
sdk.start();

console.log("OpenTelemetry initialized");

// 4. FLUSH TELEMETRY WHEN THIS PROCESS IS STOPPED
async function shutdownTelemetry(): Promise<void> {
  try {
    await sdk.shutdown();
  } catch (error: unknown) {
    console.error("Telemetry shutdown failed:", error);
  }
}

process.once("SIGTERM", () => {
  void shutdownTelemetry();
});

process.once("SIGINT", () => {
  void shutdownTelemetry();
});

import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { MongoDBInstrumentation } from "@opentelemetry/instrumentation-mongodb";

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

// Preloaded before Express and MongoDB so instrumentation can
// observe their operations.
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new MongoDBInstrumentation(),
  ],
});

sdk.start();

console.log("User service OpenTelemetry initialized");

// main.ts calls this after HTTP requests and database cleanup finish.
export async function shutdownTelemetry(): Promise<void> {
  await sdk.shutdown();
}

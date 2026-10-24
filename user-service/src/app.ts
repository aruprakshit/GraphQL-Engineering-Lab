import express from "express";
import { createBatchRouter } from "./batch-route.js";
import type { BatchRouterOptions } from "./batch-route.js";

export function createApp(options: BatchRouterOptions) {
  const app = express();

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "graphql-user-service",
    });
  });

  app.use(createBatchRouter(options));

  return app;
}

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";

export const requestLogging: RequestHandler = (req, res, next) => {
  // 1. IDENTIFY THE REQUEST AND START THE TIMER
  const requestId = randomUUID();
  const startedAt = performance.now();

  res.locals.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  // 2. LOG WHEN THE RESPONSE HAS BEEN SENT
  res.once("finish", () => {
    const durationMs = performance.now() - startedAt;

    console.log(
      JSON.stringify({
        event: "http_request_finished",
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      }),
    );
  });

  // 3. CONTINUE TO THE NEXT MIDDLEWARE OR ROUTE
  next();
};

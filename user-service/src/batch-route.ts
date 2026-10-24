import express from "express";
import type { ErrorRequestHandler } from "express";
import { MongoError } from "mongodb";
import * as z from "zod";
import { InvalidBatchInputError, parseBatchInput } from "./batch-input.js";
import type { BatchInput } from "./batch-input.js";
import type { PublicProfile } from "./profiles.js";
import { createServiceAuth } from "./service-auth.js";
import { parseBoundedJson } from "./json-body.js";

export type ProfileLookup = (input: BatchInput) => Promise<PublicProfile[]>;

export interface BatchRouterOptions {
  serviceToken: string;
  lookupProfiles: ProfileLookup;
}

const parserErrorSchema = z.object({
  type: z.string(),
});

export function createBatchRouter(options: BatchRouterOptions) {
  const router = express.Router();

  // Authentication must run before body parsing or profile lookup.
  router.post(
    "/internal/users/batch",
    createServiceAuth(options.serviceToken),
    ...parseBoundedJson,
    async (request, response) => {
      const input = parseBatchInput(request.body);
      const users = await options.lookupProfiles(input);

      const body = JSON.stringify({ users });

      if (Buffer.byteLength(body, "utf8") > 256 * 1024) {
        throw new Error("Profile response exceeds the configured byte limit");
      }

      response.type("application/json").send(body);
    },
  );

  const handleError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof InvalidBatchInputError) {
      response.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: error.message,
        },
      });
      return;
    }

    const parserError = parserErrorSchema.safeParse(error);
    const parserErrorType = parserError.success
      ? parserError.data.type
      : undefined;

    if (parserErrorType === "entity.too.large") {
      response.status(413).json({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "Request body exceeds the allowed size",
        },
      });
      return;
    }

    if (
      parserErrorType === "encoding.unsupported" ||
      parserErrorType === "charset.unsupported"
    ) {
      response.status(415).json({
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Unsupported request encoding",
        },
      });
      return;
    }

    if (
      parserErrorType === "entity.parse.failed" ||
      parserErrorType === "request.size.invalid" ||
      parserErrorType === "request.aborted"
    ) {
      response.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "Invalid JSON request body",
        },
      });
      return;
    }

    if (error instanceof MongoError) {
      response.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "User service temporarily unavailable",
        },
      });
      return;
    }

    response.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to complete profile lookup",
      },
    });
  };

  router.use(handleError);

  return router;
}

import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/**
 * Authorization header
 *         ↓
 * Exactly one header with a valid Bearer format?
 *         ├── No → 401
 *         ↓ Yes
 * Token matches configured service token?
 *         ├── No → 401
 *         ↓ Yes
 * next() → body validation → profile lookup
 *
 * Body validation and profile lookup are subsequent route steps;
 * this middleware only authenticates the calling service.
 */
export function createServiceAuth(serviceToken: string): RequestHandler {
  const expectedToken = Buffer.from(serviceToken, "utf8");

  return (request, response, next) => {
    const authorizationHeaders = request.headersDistinct.authorization;

    // Require exactly one Authorization header.
    const authorization =
      authorizationHeaders?.length === 1 ? authorizationHeaders[0] : undefined;

    // The scheme is case-insensitive; the token itself remains case-sensitive.
    const match = authorization?.match(/^Bearer ([a-f0-9]{64})$/i);
    const suppliedToken = match?.[1];

    if (!suppliedToken) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Service authentication required",
        },
      });
      return;
    }

    const suppliedBytes = Buffer.from(suppliedToken, "utf8");

    // timingSafeEqual requires buffers of equal length.
    const authenticated =
      suppliedBytes.length === expectedToken.length &&
      timingSafeEqual(suppliedBytes, expectedToken);

    if (!authenticated) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Service authentication required",
        },
      });
      return;
    }

    next();
  };
}

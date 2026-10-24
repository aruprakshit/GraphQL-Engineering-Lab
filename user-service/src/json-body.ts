import express from "express";
import type { RequestHandler } from "express";

const requireJsonContentType: RequestHandler = (request, response, next) => {
  if (!request.is("application/json")) {
    response.status(415).json({
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Content-Type must be application/json",
      },
    });
    return;
  }

  next();
};

export const parseBoundedJson: RequestHandler[] = [
  requireJsonContentType,
  express.json({
    limit: "32kb",
    strict: true,
    inflate: false,
  }),
];

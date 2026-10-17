import type { Response } from "express";
import type { CreatedSession } from "./models.js";

// KEEP EXPRESS COOKIE HANDLING OUTSIDE AUTHENTICATION SERVICES
export function setSessionCookie(
  response: Response,
  session: CreatedSession,
  secure: boolean,
): void {
  response.cookie("session", session.token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });

  response.setHeader("Cache-Control", "no-store");
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  response.clearCookie("session", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });

  response.setHeader("Cache-Control", "no-store");
}

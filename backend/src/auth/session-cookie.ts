import { isSessionToken } from "./session-tokens.js";

export function readSessionCookie(
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  let sessionValue: string | undefined;

  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");

    const name = (separator === -1 ? entry : entry.slice(0, separator)).trim();

    if (name !== "session") {
      continue;
    }

    // REJECT A MALFORMED SESSION COOKIE OR DUPLICATE NAME.
    if (separator === -1 || sessionValue !== undefined) {
      return null;
    }

    sessionValue = entry.slice(separator + 1).trim();
  }

  return isSessionToken(sessionValue) ? sessionValue : null;
}

/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Development response | HttpOnly, SameSite=Lax, Path=/ cookie without Secure |
 * | Production response | Same attributes plus Secure |
 * | Cookie lifetime and scope | Matches session expiry; no Domain attribute |
 * | Response caching and body | no-store; JSON contains only ok: true |
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import { setSessionCookie } from "./cookies.js";

test("session cookie settings", async (t) => {
  // 1. ARRANGE: USE A SYNTHETIC SESSION AND TEMPORARY SERVER
  const session = {
    token: "a".repeat(64),
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
  };

  const app = express();

  app.get("/development", (_req, res) => {
    setSessionCookie(res, session, false);
    res.json({ ok: true });
  });

  app.get("/production", (_req, res) => {
    setSessionCookie(res, session, true);
    res.json({ ok: true });
  });

  const server = app.listen(0, "127.0.0.1");

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

  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const baseUrl = `http://127.0.0.1:${address.port}`;

  for (const environment of ["development", "production"]) {
    await t.test(`${environment} cookie attributes`, async () => {
      // 2. ACT
      const response = await fetch(`${baseUrl}/${environment}`);
      const cookie = response.headers.get("set-cookie");

      // 3. ASSERT
      assert.equal(response.status, 200);
      assert.ok(cookie);

      assert.ok(cookie.startsWith(`session=${session.token};`));
      assert.match(cookie, /;\s*HttpOnly(?:;|$)/i);
      assert.match(cookie, /;\s*SameSite=Lax(?:;|$)/i);
      assert.match(cookie, /;\s*Path=\/(?:;|$)/i);
      assert.ok(cookie.includes(`Expires=${session.expiresAt.toUTCString()}`));
      assert.doesNotMatch(cookie, /;\s*Domain=/i);

      const hasSecure = /;\s*Secure(?:;|$)/i.test(cookie);

      assert.equal(hasSecure, environment === "production");
      assert.equal(response.headers.get("cache-control"), "no-store");

      // THE TOKEN BELONGS IN THE COOKIE, NOT THE JSON BODY
      assert.deepEqual(await response.json(), { ok: true });
    });
  }
});

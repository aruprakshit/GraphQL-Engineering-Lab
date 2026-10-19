/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Actor requested concurrently or repeatedly within one request | Resolves lazily once and reuses the same promise and actor |
 * | Anonymous result requested repeatedly | Reuses null without another lookup |
 * | Separate requests resolve identity | Each request performs its own lookup |
 * | Authentication storage fails | Returns generic SERVICE_UNAVAILABLE and reuses the rejection |
 * | Resolver throws synchronously | Converts failure into a sanitized rejected promise |
 *
 * Reading guide:
 * - The injected resolver lets call counts prove lazy lookup and per-request caching.
 * - Both successful results and failures must be shared within one request.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { GraphQLError } from "graphql";
import type { Actor } from "./models.js";
import { createRequestActor } from "./request-actor.js";

// Purpose: Compare Promise references and call counts to prove one lazy, shared lookup.
test("resolves lazily and shares one lookup within a request", async () => {
  let calls = 0;

  const actor: Actor = {
    userId: "user-1",
    role: "user",
  };

  const getActor = createRequestActor(async () => {
    calls += 1;
    return actor;
  });

  assert.equal(calls, 0);

  const first = getActor();
  const second = getActor();

  // Promise identity proves concurrent callers share the same in-flight lookup.
  assert.equal(first, second);

  const results = await Promise.all([first, second]);

  assert.deepEqual(results, [actor, actor]);
  assert.equal(calls, 1);

  assert.equal(await getActor(), actor);
  assert.equal(calls, 1);
});

// Purpose: Cache null as a completed result rather than repeatedly checking anonymous requests.
test("also reuses an anonymous result", async () => {
  let calls = 0;

  const getActor = createRequestActor(async () => {
    calls += 1;
    return null;
  });

  assert.equal(await getActor(), null);
  assert.equal(await getActor(), null);
  assert.equal(calls, 1);
});

// Purpose: Each request needs its own cache so identities cannot leak between requests.
test("keeps different requests independent", async () => {
  let calls = 0;

  const resolveActor = async (): Promise<Actor | null> => {
    calls += 1;
    return null;
  };

  const firstRequest = createRequestActor(resolveActor);
  const secondRequest = createRequestActor(resolveActor);

  await firstRequest();
  await secondRequest();

  assert.equal(calls, 2);
});

// Purpose: A failed lookup remains a failure for all callers; it must never become anonymous.
test("sanitizes storage failures and reuses the rejection", async () => {
  let calls = 0;

  const getActor = createRequestActor(async () => {
    calls += 1;
    throw new Error("Private database connection details");
  });

  const assertUnavailable = (error: unknown): boolean => {
    assert.ok(error instanceof GraphQLError);
    assert.equal(error.message, "Authentication temporarily unavailable");
    assert.equal(error.extensions.code, "SERVICE_UNAVAILABLE");
    return true;
  };

  // The Promise must reject; returning null would incorrectly claim anonymous access.
  await assert.rejects(getActor(), assertUnavailable);
  await assert.rejects(getActor(), assertUnavailable);

  assert.equal(calls, 1);
});

// Purpose: Even a synchronous throw must produce the same sanitized asynchronous failure.
test("converts synchronous failures into a rejected promise", async () => {
  const getActor = createRequestActor(() => {
    throw new Error("Private internal details");
  });

  await assert.rejects(getActor(), (error: unknown) => {
    assert.ok(error instanceof GraphQLError);
    assert.equal(error.extensions.code, "SERVICE_UNAVAILABLE");
    assert.equal(error.message, "Authentication temporarily unavailable");
    return true;
  });
});

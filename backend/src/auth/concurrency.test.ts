/**
 * Test scenarios
 *
 * | Scenario | Expected |
 * | --- | --- |
 * | Capacity exceeded | Rejects without starting excess work |
 * | Work completes | Slot becomes available |
 * | Asynchronous or synchronous failure | Error propagates; slot released |
 * | Invalid limit | Creation throws |
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CapacityExceededError,
  createConcurrencyLimiter,
} from "./concurrency.js";

test("rejects excess work and releases completed slots", async () => {
  // ARRANGE: KEEP TWO OPERATIONS PENDING
  const limiter = createConcurrencyLimiter(2);

  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = limiter.run(() => pending);
  const second = limiter.run(() => pending);

  let excessWorkStarted = false;

  try {
    // ACT AND ASSERT
    await assert.rejects(
      limiter.run(async () => {
        excessWorkStarted = true;
      }),
      CapacityExceededError,
    );

    assert.equal(excessWorkStarted, false);
  } finally {
    release();
    await Promise.all([first, second]);
  }

  // ASSERT: COMPLETED WORK FREED THE SLOTS
  assert.equal(await limiter.run(async () => "available"), "available");
});

test("releases a slot after asynchronous failure", async () => {
  // ARRANGE
  const limiter = createConcurrencyLimiter(1);

  // ACT AND ASSERT
  await assert.rejects(
    limiter.run(async () => {
      throw new Error("Verification failed");
    }),
    /Verification failed/,
  );

  assert.equal(await limiter.run(async () => "available"), "available");
});

test("releases a slot when work throws synchronously", async () => {
  const limiter = createConcurrencyLimiter(1);

  await assert.rejects(
    limiter.run(() => {
      throw new Error("Immediate failure");
    }),
    /Immediate failure/,
  );

  assert.equal(await limiter.run(async () => "available"), "available");
});

test("rejects invalid concurrency limits", () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => createConcurrencyLimiter(limit));
  }
});

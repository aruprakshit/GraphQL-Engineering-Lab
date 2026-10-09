import { performance } from "node:perf_hooks";

// MEASURE AN ASYNCHRONOUS OPERATION, INCLUDING FAILED OPERATIONS
export async function measureOperation<T>(
  requestId: string,
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  let succeeded = false;

  try {
    const result = await work();
    succeeded = true;
    return result;
  } finally {
    console.log(
      JSON.stringify({
        event: "operation_finished",
        requestId,
        operation,
        succeeded,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
      }),
    );
  }
}

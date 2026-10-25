import assert from "node:assert/strict";
import { test } from "node:test";
import { UserServiceUnavailableError } from "./errors.js";
import { MAX_RESPONSE_BYTES, readBoundedJson } from "./read-response.js";

function responseFromChunks(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }

      controller.close();
    },
  });

  return new Response(stream);
}

function hasFailureReason(
  reason: UserServiceUnavailableError["reason"],
): (error: unknown) => boolean {
  return (error) =>
    error instanceof UserServiceUnavailableError && error.reason === reason;
}

test("reads JSON delivered across multiple chunks", async () => {
  // Why: network chunks can split JSON anywhere, so parsing must use
  // the complete reassembled body rather than each chunk separately.
  // Arrange
  const encoder = new TextEncoder();
  const response = responseFromChunks([
    encoder.encode('{"users":'),
    encoder.encode('[{"id":"user-1",'),
    encoder.encode('"displayName":"Ada"}]}'),
  ]);

  // Act
  const result = await readBoundedJson(response);

  // Assert
  assert.deepEqual(result, {
    users: [{ id: "user-1", displayName: "Ada" }],
  });
  assert.equal(response.body?.locked, false);
});

test("handles a UTF-8 character split across chunks", async () => {
  // Why: the two bytes of é can arrive in different chunks. Valid text
  // must survive that split without errors or replacement characters.
  // Arrange
  const bytes = new TextEncoder().encode('"é"');
  const response = responseFromChunks([bytes.slice(0, 2), bytes.slice(2)]);

  // Act
  const result = await readBoundedJson(response);

  // Assert
  assert.equal(result, "é");
});

test("accepts a body exactly at the byte limit", async () => {
  // Why: the limit is inclusive. Subtract two bytes for JSON's opening
  // and closing quotes so the whole body is exactly 256 KiB.
  // Arrange
  const value = "a".repeat(MAX_RESPONSE_BYTES - 2);
  const body = JSON.stringify(value);
  const response = new Response(body);

  // Act
  const result = await readBoundedJson(response);

  // Assert
  assert.equal(Buffer.byteLength(body, "utf8"), MAX_RESPONSE_BYTES);
  assert.equal(result, value);
});

test("stops and cancels when received bytes exceed the limit", async () => {
  // Why: a server can lie about Content-Length. Count actual bytes and
  // stop consuming the stream as soon as the response is oversized.
  // Arrange
  const chunks = [
    new Uint8Array(100 * 1024),
    new Uint8Array(100 * 1024),
    new Uint8Array(80 * 1024),
    new Uint8Array(10),
  ];

  let chunksRead = 0;
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[chunksRead];

        if (chunk === undefined) {
          controller.close();
          return;
        }

        chunksRead += 1;
        controller.enqueue(chunk);
      },

      cancel() {
        cancelled = true;
      },
    },
    // Why: disable prefetching so chunksRead measures reader demand,
    // making the assertion that chunk 4 was not requested deterministic.
    { highWaterMark: 0 },
  );

  const response = new Response(stream, {
    headers: { "Content-Length": "1" },
  });

  // Act
  const operation = readBoundedJson(response);

  // Assert
  await assert.rejects(operation, hasFailureReason("RESPONSE_TOO_LARGE"));
  // Why: 100 + 100 + 80 = 280 KiB. Reject on chunk 3, before reading
  // chunk 4 or parsing these deliberately non-JSON, zero-filled bytes.
  assert.equal(chunksRead, 3);
  assert.equal(cancelled, true);
  assert.equal(response.body?.locked, false);
});

test("rejects a missing body", async () => {
  // Why: an absent body cannot contain a JSON document. Treat it as
  // an invalid response rather than silently returning missing data.
  // Arrange
  const response = new Response(null);

  // Act
  const operation = readBoundedJson(response);

  // Assert
  await assert.rejects(operation, hasFailureReason("INVALID_RESPONSE"));
});

test("rejects malformed JSON", async () => {
  // Why: a small body with valid UTF-8 can still contain broken JSON.
  // Do not return incomplete or partially parsed data.
  // Arrange
  const response = new Response('{"users":');

  // Act
  const operation = readBoundedJson(response);

  // Assert
  await assert.rejects(operation, hasFailureReason("INVALID_RESPONSE"));
});

test("rejects invalid UTF-8", async () => {
  // Why: silently replacing invalid bytes would change the service's
  // data. Reject corrupt encoding before attempting JSON validation.
  // Arrange
  const response = responseFromChunks([
    new Uint8Array([0x22, 0xc3, 0x28, 0x22]),
  ]);

  // Act
  const operation = readBoundedJson(response);

  // Assert
  await assert.rejects(operation, hasFailureReason("INVALID_RESPONSE"));
});

test("preserves stream failures and releases the reader", async () => {
  // Why: the HTTP client needs the original stream error to distinguish
  // transport failures from bad JSON. Cleanup must not replace it.
  // Arrange
  const failure = new Error("Simulated stream failure");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(failure);
    },
  });
  const response = new Response(stream);

  // Act
  const operation = readBoundedJson(response);

  // Assert
  await assert.rejects(operation, (error: unknown) => error === failure);
  assert.equal(response.body?.locked, false);
});

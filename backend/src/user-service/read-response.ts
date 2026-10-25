import { UserServiceUnavailableError } from "./errors.js";

export const MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Response body
 *      ↓
 * Read one chunk at a time and count bytes
 *      ├── Over 256 KiB → stop reading and reject
 *      ↓
 * Decode complete body as UTF-8
 *      ├── Invalid encoding → reject
 *      ↓
 * Parse JSON
 *      ├── Invalid JSON → reject
 *      ↓
 * Return unknown data for separate Zod validation
 *
 *
 * Example of counting chunks:
 * Chunk 1: 100 KiB → keep; total 100 KiB
 * Chunk 2: 100 KiB → keep; total 200 KiB
 * Chunk 3:  80 KiB → reject; total exceeds 256 KiB
 * The third chunk has arrived, but is not retained. Cancel the rest.
 *
 * Separate responsibilities:
 * readBoundedJson() → Is the body bounded, valid UTF-8, and valid JSON?
 * Zod validation   → Does that JSON match our profile response contract?
 *
 * Valid JSON alone does not establish that the response contains users.
 *
 * Content-Length is not trusted: the actual received bytes determine
 * whether the response fits.
 */
export async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) {
    throw new UserServiceUnavailableError("INVALID_RESPONSE");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  let finished = false;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        finished = true;
        break;
      }

      receivedBytes += value.byteLength;

      if (receivedBytes > MAX_RESPONSE_BYTES) {
        throw new UserServiceUnavailableError("RESPONSE_TOO_LARGE");
      }

      if (value.byteLength > 0) {
        chunks.push(value);
      }
    }

    const bytes = Buffer.concat(chunks, receivedBytes);

    try {
      // Reject invalid UTF-8 rather than silently replacing bytes.
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const text = decoder.decode(bytes);

      return JSON.parse(text);
    } catch {
      throw new UserServiceUnavailableError("INVALID_RESPONSE");
    }
  } finally {
    if (!finished) {
      try {
        await reader.cancel();
      } catch {
        // Cleanup failure must not replace the original lookup failure.
      }
    }

    reader.releaseLock();
  }
}

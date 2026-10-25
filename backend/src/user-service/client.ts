import { performance } from "node:perf_hooks";
import { buildProfileBatches } from "./batches.js";
import type { ProfileRequestBatch } from "./batches.js";
import { parseUserServiceOptions } from "./config.js";
import { UserServiceUnavailableError } from "./errors.js";
import { readBoundedJson } from "./read-response.js";
import type {
  PublicProfile,
  UserServiceClient,
  UserServiceClientOptions,
} from "./types.js";
import { validateProfileResponse } from "./validate-response.js";
import type { Span } from "@opentelemetry/api";
import {
  createServiceRequestHeaders,
  withUserServiceBatchSpan,
} from "./tracing.js";

export const USER_SERVICE_TIMEOUT_MS = 500;

export function createUserServiceClient(
  options: UserServiceClientOptions,
): UserServiceClient {
  const config = parseUserServiceOptions(options);
  const endpoint = new URL("/internal/users/batch", config.baseUrl);

  async function requestBatch(
    batch: ProfileRequestBatch,
    span: Span,
  ): Promise<PublicProfile[]> {
    const controller = new AbortController();
    const deadline = performance.now() + USER_SERVICE_TIMEOUT_MS;

    // Keep this timer active through response-body reading.
    // Receiving headers alone does not complete the lookup.
    const timer = setTimeout(() => {
      controller.abort();
    }, USER_SERVICE_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: createServiceRequestHeaders(config.serviceToken),
        body: batch.body,
        signal: controller.signal,

        // Do not follow redirects to another endpoint.
        redirect: "manual",
      });
      span.setAttribute("http.response.status_code", response.status);

      if (response.status !== 200) {
        throw new UserServiceUnavailableError("HTTP_ERROR");
      }

      const mediaType = response.headers
        .get("Content-Type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();

      if (mediaType !== "application/json") {
        throw new UserServiceUnavailableError("INVALID_RESPONSE");
      }

      const input = await readBoundedJson(response);
      const profiles = validateProfileResponse(input, batch.ids);

      // Timers cannot interrupt synchronous JSON parsing or validation.
      // Check elapsed time before accepting their result.
      if (performance.now() >= deadline) {
        throw new UserServiceUnavailableError("TIMEOUT");
      }

      return profiles;
    } catch (error: unknown) {
      if (controller.signal.aborted || performance.now() >= deadline) {
        throw new UserServiceUnavailableError("TIMEOUT");
      }

      if (error instanceof UserServiceUnavailableError) {
        throw error;
      }

      throw new UserServiceUnavailableError("NETWORK_ERROR");
    } finally {
      clearTimeout(timer);

      // Also terminate unfinished response consumption when rejecting
      // early because of status, content type, or another failure.
      controller.abort();
    }
  }

  return {
    async findProfiles(ids) {
      const batches = buildProfileBatches(ids);
      const profiles: PublicProfile[] = [];

      // Process batches sequentially rather than starting an unbounded
      // number of concurrent requests. Each batch gets its own deadline.
      for (const batch of batches) {
        const batchProfiles = await withUserServiceBatchSpan(
          batch.ids.length,
          USER_SERVICE_TIMEOUT_MS,
          (span) => requestBatch(batch, span),
        );

        profiles.push(...batchProfiles);
      }

      return profiles;
    },
  };
}

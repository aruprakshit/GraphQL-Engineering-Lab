# ADR 0002: Combine cursor pagination and request-scoped DataLoader

Status: Accepted - implemented. Recorded retrospectively: 17 October 2026.

## Context

Resolving an author separately for every post produced the demonstrated N+1 pattern. Batching alone would still allow large lists and expensive queries.

## Alternatives

- Find one author per post: simple resolver code, but repeated database calls.
- Join authors in a MongoDB aggregation: viable for an endpoint-specific read model, but couples the initial fetch to nested selections and does not teach request-level loading across resolvers.
- Share one loader across requests: potentially higher cache reuse, but adds freshness, invalidation and future authorization-scope problems.
- Offset pagination: simpler numeric pages, but deep offsets require skipping records and provide different behavior under data changes.

## Decision

Create a fresh user loader in each request context. Batch queued unique IDs with a MongoDB $in query; return one result per key in key order, using null for missing users. Use a versioned cursor based on string _id order. Default to five posts, allow one through twenty, and fetch one extra record for hasNextPage.

## Consequences

The observed five-post request used two database calls instead of six. Cache scope is the request; this is not a shared cache. Batching does not fix missing indexes, excessive serialization or all sequential dependencies. Cursor order is not chronological order. Base64 encoding does not make a cursor secret. Page size limits apply per field invocation, not to total operation cost. Visibility filtering is still pending.

## Evidence and revisit triggers

See [loader](../../../backend/src/loaders.ts), [pagination](../../../backend/src/pagination.ts), [posts resolver](../../../backend/src/resolvers/posts.ts) and [load-test findings](../../load-testing.md). Revisit cursor shape when introducing chronological or compound sorting. Revisit loader keys and access policy when authorization is integrated. Add whole-operation cost protection separately.

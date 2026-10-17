# ADR 0005: Correlated observability and evidence with explicit limits

Status: Accepted - implemented. Recorded retrospectively: 17 October 2026.

## Context

A smaller database-call count did not answer where request time was spent. The project needed inspectable timings without a paid APM subscription, and repeatable verification beyond manual curl checks.

## Alternatives

- Keep manual stopwatch logs alone: useful for teaching, but harder to inspect nested operations and correlate work.
- Use a hosted APM product: possible, but does not match the self-hosted learning goal.
- Treat short local benchmarks as capacity proof: quick to present, but unsupported by the environment and workload.

## Decision

Use OpenTelemetry with HTTP, Express and MongoDB instrumentation, custom posts/batch spans, and a local Jaeger trace UI. Keep structured stdout logs correlated by requestId and traceId. Use k6 for a named posts workload and response checks. Keep unit tests separate from integration tests backed by a dedicated MongoDB service and database. Run format/type checks, unit tests and integration tests in CI.

## Consequences

Nested traces help locate application-observed work, but parent and child durations cannot be added as independent time. Database spans do not isolate MongoDB server execution. Instrumentation has overhead. Jaeger uses transient development storage. Logs and metrics are not exported to it in the current configuration. Password/token exclusion remains a sensitive-data requirement.

The recorded k6 workload is closed-loop: each virtual user waits for its response before sending the next request. Short runs on shared hardware do not establish production capacity. A previously observed trace-timestamp discrepancy remains unresolved.

## Evidence and revisit triggers

See [instrumentation](../../../backend/src/instrumentation.ts), [load-test evidence](../../load-testing.md), [tracing notes](../../tracing.md) and [CI](../../../.github/workflows/ci.yaml). Revisit persistence, sampling and metrics for operational needs. Add HTTP/browser integration tests as incoming session authentication is wired. Reassess bottleneck hypotheses through targeted experiments rather than selecting the largest trace extent alone.

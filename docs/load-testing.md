# GraphQL load-testing baseline

## Purpose

Measure throughput, latency, and response correctness as concurrent
clients increase. Use traces to inspect where request time is spent.

## Workload

Each request executes the named LoadTestPosts operation, requesting
20 posts with titles and author IDs and names.

Each virtual user repeatedly sends one request, waits for its response,
checks the result, and immediately starts another request.

Runs use 1, 5, and 10 concurrent virtual users for 30 seconds each.
Application logging and OpenTelemetry tracing remain enabled.

## Run

Start the application, database, and tracing backend:

    docker compose up -d backend mongo jaeger

Run each experiment separately:

    docker compose --profile loadtest run --rm -e VUS=1 k6
    docker compose --profile loadtest run --rm -e VUS=5 k6
    docker compose --profile loadtest run --rm -e VUS=10 k6

## Response checks

Every request checks that:

- HTTP status is 200.
- The response contains JSON.
- No GraphQL errors are present.
- Exactly 20 posts are returned with author IDs and names.

Thresholds require all checks to pass and no HTTP failures.
HTTP 200 alone does not establish GraphQL success.

## Results

| Concurrent users | Requests | Requests/sec | Median latency | p95 latency |
|---|---:|---:|---:|---:|
| 1 | 3936 | 127.18 | 6.51 ms | 10.95 ms |
| 5 | 5280 | 170.63 | 26.55 ms | 41.91 ms |
| 10 | 5965 | 192.67 | 47.70 ms | 72.61 ms |

All response checks passed. No HTTP failures or interrupted
iterations were reported.

Median is the 50th percentile. The p95 value means 95% of measured
HTTP request durations were at or below that duration.

Reported throughput uses k6's elapsed measurement window, which
includes completion around the scheduled 30-second run.

## Findings

Increasing concurrency produced diminishing throughput gains
and higher request latency.

From 5 to 10 users:

- Throughput increased by approximately 13%.
- p95 latency increased by approximately 73%.

These observations suggest contention or queueing somewhere in
the local setup, but the bottleneck was not established.

DataLoader continued to batch author lookups. Reduced database-call
count does not guarantee low latency under concurrent load.

## Trace inspection

A coherent 48.1 ms request trace showed:

| Span | Duration |
|---|---:|
| graphql.posts | 25.6 ms |
| MongoDB posts query | 24.8 ms |
| dataloader.users.batch | 19.9 ms |
| MongoDB users query | 19.2 ms |

The posts and users database operations ran sequentially and occupied
roughly 44 ms of the request.

Parent spans include their children. Their durations must not be
added together as independent work.

Database spans represent application-observed operations; they do
not isolate MongoDB server execution from driver, network, and
scheduling effects.

### Timing inconsistency

Another trace displayed a 536 ms overall timeline, while its HTTP
span reported 37.1 ms and the correlated application log reported
36.79 ms.

Its author-batch span appeared after the HTTP parent had ended.
The cause remains unresolved. This trace was not treated as evidence
of a 500 ms database wait.

## Limitations

- These are short, single runs against a small local dataset.
- k6, Express, MongoDB, and Jaeger share the same host resources.
- The backend runs in development mode.
- Logging and tracing overhead are included.
- Virtual users wait for responses before issuing another request;
  this does not represent a fixed incoming request rate.
- No production capacity or latency guarantee is established.
- No specific bottleneck or root cause was proven.
- Jaeger uses in-memory storage, so traces disappear on restart.

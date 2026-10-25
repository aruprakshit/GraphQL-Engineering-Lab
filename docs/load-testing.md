# GraphQL load-testing measurements

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

    docker compose up -d backend user-service mongo jaeger

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

## Historical monolith results

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

## Distributed author lookup results: issue #69

The developer reran the unchanged `load-tests/posts.js` workload after GraphQL author delegation was implemented. It still selects 20 posts with author IDs and the supported deprecated name field. Requests are anonymous, so only visible published posts contribute to the result. Each virtual user waits for its response and checks it before issuing another request, without an intentional pause.

Each scenario was configured for 30 seconds. Logging and tracing remained enabled. The existing four checks verify HTTP 200, JSON, no GraphQL errors, and exactly 20 posts with resolved authors. All checks passed in every reported run, including the anomalous first five-user run. No HTTP failures or interrupted iterations were reported.

### Reported results

| Users | Run | Requests | Requests/sec | Average | Median | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Initial | 2478 | 85.72 | 11.54 ms | 10.70 ms | 17.07 ms | 66.54 ms |
| 5 | Initial, timing anomaly | 3717 | 128.67 | 39.52 ms | 37.79 ms | 56.76 ms | 174.94 ms |
| 5 | Rerun | 3039 | 105.17 | 48.48 ms | 44.54 ms | 83.36 ms | 159.91 ms |
| 10 | Initial | 3777 | 130.64 | 78.26 ms | 75.17 ms | 106.58 ms | 248.21 ms |

These values are transcribed from k6 output. They are provisional performance observations because of the timing inconsistencies below, not validated capacity measurements. Do not combine the two five-user runs into a single unqualified result.

Using the five-user rerun as a descriptive reference, increasing concurrency from 5 to 10 produced about 24% more reported throughput, 61% higher average latency, and 28% higher p95. This pattern is consistent with contention or queueing somewhere in the setup, but does not establish where it occurs.

### Timing anomalies retained with the results

The initial five-user run reported `min=-445081100ns`, approximately negative 445 ms. A negative request duration is invalid, so its latency statistics are not treated as trustworthy measurements. Correctness checks still passed; a repeat was requested rather than silently dropping the run.

The rerun's HTTP minimum was 166.7 microseconds while its minimum iteration duration was 23.23 ms. The ten-user HTTP minimum was 160.33 microseconds while its minimum iteration duration was 40.72 ms. These minima need not come from the same iteration, but the unusually short HTTP observations warrant caution.

Every supplied run displayed about 28.9 seconds elapsed while reporting a configured 30-second scenario. The cause of these observations is unresolved. No claim is made that the application, network, WSL clock, or k6 version caused them. Both duration and reported requests/sec depend on the tool's measurements, so throughput also retains this caveat.

### Example distributed trace

The developer inspected a trace with displayed ID prefix `879e226`, containing two services and 11 spans. It is an individual example, not an aggregate breakdown of the run or proof that it was the slowest request.

| Span | Observed duration |
| --- | ---: |
| POST /graphql | 58.5 ms |
| graphql.posts | 5.5 ms |
| Backend MongoDB posts lookup | 4.1 ms |
| dataloader.users.batch | 48.1 ms |
| user-service.batch CLIENT span | 48.0 ms |
| User-service incoming HTTP handling | 3.1 ms |
| User-service MongoDB profiles lookup | 1.5 ms |

The client span reported these tags:

| Attribute | Observed value |
| --- | --- |
| span.kind | client |
| HTTP status | 200 |
| user_service.batch.id_count | 3 |
| user_service.batch.returned_count | 3 |
| user_service.outcome | success |
| user_service.timeout_ms | 500 |

The HTTP status is listed without assuming a particular displayed attribute spelling: the screenshot and code may expose HTTP status under different instrumentation attribute names.

For this sampled 20-post workload, the trace shows one profile batch requesting three unique author IDs and receiving three profiles, with one remote MongoDB lookup. This confirms batching survives the network boundary for the sample; it does not prove every request in the run had exactly one batch.

The outgoing profile call occupied about 82% of the 58.5 ms GraphQL request. Its duration exceeded the remote server span by roughly 44.9 ms (48.0 - 3.1). This difference is not a measurement of pure network latency: connection acquisition, transfer, scheduling, response reading and validation, and instrumentation boundaries may contribute. Client and server timestamps also come from different processes.

Parent durations include child work. Do not sum the DataLoader, client HTTP, remote HTTP, and MongoDB spans as independent costs. The example does not identify a database bottleneck: the remote database span accounts for only 1.5 ms of the client's 48.0 ms duration.

This sampled dependency call completed well below its 500 ms deadline. No GraphQL dependency errors surfaced in the reported load-test results. That does not establish the exact maximum dependency-span duration across all requests.

### Comparison with the historical monolith

| Users | Historical requests/sec | Distributed requests/sec | Historical p95 | Distributed p95 |
| --- | ---: | ---: | ---: | ---: |
| 1 | 127.18 | 85.72 | 10.95 ms | 17.07 ms |
| 5 | 170.63 | 105.17, rerun | 41.91 ms | 83.36 ms, rerun |
| 10 | 192.67 | 130.64 | 72.61 ms | 106.58 ms |

The distributed runs report lower throughput and higher p95 than the earlier monolith. This is historical context, not a controlled architecture experiment. Authentication, authorization, query protections, dependencies, runtime versions, and application code evolved between measurements. The additional service and its telemetry also share host resources. The current timing anomalies further weaken absolute comparisons.

Do not attribute the whole difference to network latency or claim that removing HTTP delegation would restore the historical numbers. A controlled comparison would need equivalent code behavior, fixtures, resource allocation, warm-up policy, telemetry, and reliable timing.

### Environment record and reproducibility

Configured image references at this checkpoint:

| Component | Compose image reference |
| --- | --- |
| Backend and user service | node:26-alpine |
| MongoDB | mongo:9.0 |
| Jaeger | cr.jaegertracing.io/jaegertracing/jaeger:2.22.0 |
| Load generator | grafana/k6:1.0.0 |

Both applications run development commands, and both export tracing to the local Jaeger container. k6, both applications, MongoDB, and Jaeger share the local host. The sample returned 20 posts and resolved three unique authors.

The developer captured the following details after the load-test runs, on the issue #69 branch:

| Detail | Reported value |
| --- | --- |
| Source HEAD when captured | 931c6b1 |
| Backend Node.js | v26.10.0 |
| User-service Node.js | v26.10.0 |
| MongoDB server | v9.0.2 |
| MongoDB build target | ubuntu2404, x86_64 |
| Total stored posts | 34 |
| Published posts | 31 |
| Draft posts | 3 |
| Stored users | 3 |
| Actual k6 binary version | v1.0.0; commit/41b4984b75-dirty; go1.24.2; linux/amd64 |

The anonymous workload reads 20 posts from the 31 published posts; the three drafts are excluded by visibility rules. The inspected trace fetched three unique author profiles. Fixture counts are a snapshot, not a complete export of document contents or a guarantee that earlier historical runs used identical data.

These versions and counts were reported after measurement, rather than captured automatically at each run's start. Image references remain different from immutable image digests. Docker CPU/memory allocation and concurrent host activity were not recorded. The initial Playground request verified response shape; no separate timed warm-up phase was recorded.

Capture the following without printing resolved Compose environment values or service credentials:

```sh
git rev-parse --short HEAD
docker compose exec backend node --version
docker compose exec user-service node --version
docker compose exec mongo mongod --version
docker compose --profile loadtest run --rm --no-deps k6 version

docker compose exec mongo mongosh graphql_engineering_lab --quiet --eval '
  printjson({
    posts: db.posts.countDocuments({}),
    publishedPosts: db.posts.countDocuments({ status: "published" }),
    draftPosts: db.posts.countDocuments({ status: "draft" }),
    users: db.users.countDocuments({})
  })
'
```

Record later-captured details as such if they were not observed during the runs. Keep fixture contents and telemetry unchanged while reproducing the scenarios. Jaeger retains traces in memory, so save relevant observations before restarting it.

### Findings and limits

Correctness and the sampled batching behavior held across the distributed boundary. Increased concurrency brought diminishing throughput gains and higher reported latency. A sampled client span dominated its request while the remote handler was short, directing further investigation toward the broader dependency-call path rather than proving a slow MongoDB query or a specific network fault.

No optimization, bottleneck fix, production capacity claim, or latency guarantee is established by this ticket. The unresolved timing anomalies and single-run sampling remain part of the findings.



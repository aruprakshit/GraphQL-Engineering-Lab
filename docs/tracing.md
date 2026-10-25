# Local tracing

## Start and inspect

Run docker compose up -d.

- GraphQL playground: http://localhost:4000/playground
- Jaeger UI: http://localhost:16686
- Backend service: graphql-engineering-lab
- Profile service: graphql-user-service

Execute a query, wait a few seconds for batched export, then search
for its trace. A traceId from application logs can be pasted into
Jaeger's trace lookup.

## Instrumentation

OpenTelemetry initializes before the application loads.

Automatic instrumentation records HTTP, Express, and MongoDB operations.
Custom spans describe application work:

- graphql.posts: posts resolution, returned count, and next-page status.
- dataloader.users.batch: unique author-key count and returned-profile count.
- user-service.batch: outgoing CLIENT span, batch counts, deadline, HTTP status, and outcome.

The posts span ends before nested author resolution.
Logs retain request IDs, trace IDs, database-call counts, and HTTP durations.
Redundant manual database-operation timers have been removed.

## Verified failures

- MongoDB outage produces a GraphQL error and an error span.
- MongoDB recovery restores successful queries.
- Jaeger outage does not prevent successful API responses.
- After Jaeger recovery, fresh traces appear.

A GraphQL error may accompany HTTP 200.
The general tracing helper records thrown errors independently of HTTP status. The user-service client span records a generic error status and classified failure reason without copying arbitrary exception details.

## Local limitations

Jaeger uses in-memory storage; restarting it clears stored traces.
Trace delivery during an outage is not guaranteed.
Metrics and log exporters are disabled for this tracing-only setup.

## Distributed author lookups

GraphQL post authors now resolve through the request-scoped profile loader and bounded HTTP client. Trace context crosses to the user service using traceparent and tracestate; baggage and browser credentials are not forwarded.

```text
POST /graphql                         graphql-engineering-lab
  graphql.posts
    MongoDB posts lookup
  dataloader.users.batch
    user-service.batch
      incoming batch request          graphql-user-service
        MongoDB profiles lookup
```

This hierarchy is approximate; automatic instrumentation may add middleware spans. A query selecting no author field produces no profile-service call. Backend database-call counters no longer count remote author storage reads: those MongoDB spans belong to the user service.

During issue #67, the developer verified that the GraphQL trace contains both service names. Stopping the user service preserves selected post IDs and titles while producing null authors and SERVICE_UNAVAILABLE errors. Queries without author selections still succeed, and author queries recover after the service restarts.

For batching, error semantics, verification scripts, and test boundaries, see [distributed GraphQL](distributed-graphql.md).

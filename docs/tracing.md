# Local tracing

## Start and inspect

Run docker compose up -d.

- GraphQL playground: http://localhost:4000/playground
- Jaeger UI: http://localhost:16686
- Service: graphql-engineering-lab

Execute a query, wait a few seconds for batched export, then search
for its trace. A traceId from application logs can be pasted into
Jaeger's trace lookup.

## Instrumentation

OpenTelemetry initializes before the application loads.

Automatic instrumentation records HTTP, Express, and MongoDB operations.
Custom spans describe application work:

- graphql.posts: posts resolution, returned count, and next-page status.
- dataloader.users.batch: unique author IDs and returned-user count.

The posts span ends before nested author resolution.
Logs retain request IDs, trace IDs, database-call counts, and HTTP durations.
Redundant manual database-operation timers have been removed.

## Verified failures

- MongoDB outage produces a GraphQL error and an error span.
- MongoDB recovery restores successful queries.
- Jaeger outage does not prevent successful API responses.
- After Jaeger recovery, fresh traces appear.

A GraphQL error may accompany HTTP 200.
The tracing helper records thrown errors independently of HTTP status.

## Local limitations

Jaeger uses in-memory storage; restarting it clears stored traces.
Trace delivery during an outage is not guaranteed.
Metrics and log exporters are disabled for this tracing-only setup.

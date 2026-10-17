# Project design and rationale

Status: living design document, reconstructed from the implementation and project discussions. Last reviewed: 17 October 2026.

Start here to understand the project after a break. This document explains goals, decisions and limits; linked feature documents contain detailed contracts. It records current choices rather than pretending that an RFC was approved before those choices were implemented.

## Reading path

| Time available | Read |
|---|---|
| Five minutes | Goals, current scope and the C4 container view below |
| Fifteen minutes | Request flows, decisions and failure behavior |
| Deeper study | Decision records, source links and feature documents |
| Before an interview | Evidence, limitations and the interview walkthrough |

1. Read this document for the overall reasoning.
2. Open the [C4 views](../c4-architecture.md) for context, containers and backend components.
3. Follow the [query and login sequences](../architecture.md) for execution order.
4. Read the [decision records](decisions/README.md) to understand alternatives and consequences.
5. Follow the implementation links when you need exact behavior.

## Problem and learning goals

Build a small Express application with TypeScript, GraphQL and MongoDB, using Docker for development and verification. The first learning question was why GraphQL creates N+1 database access and what DataLoader actually fixes.

The broader goal is to explain senior-level engineering decisions through working examples: query cost, performance investigation beyond N+1, authorization boundaries, schema compatibility and eventually distributed GraphQL. Authentication provides the identity foundation for the planned authorization exercises.

Success means being able to explain a request from transport to database, show evidence for a performance claim, identify failure behavior, and acknowledge unfinished protections.

## Constraints and non-goals

- Runtime, dependency installation and test commands use Docker. No host Node.js or MongoDB installation is required.
- Work proceeds through small, reviewable checkpoints with tests appropriate to each change.
- Express remains the HTTP application. GraphQL is the learning API; health and an earlier database teaching route remain HTTP endpoints.
- The current application is one modular backend, not a microservices deployment.
- This is a local learning environment. Production availability, capacity guarantees, cloud hosting, password recovery and public account registration are not established by this design.
- JWT comparison is outside this project scope for now. Federation and schema evolution remain later exercises.

## Current scope

| Capability | State at this snapshot | Implementation / design |
|---|---|---|
| Express, TypeScript, Compose and MongoDB | Implemented | [main.ts](../../backend/src/main.ts), [compose.yaml](../../compose.yaml) |
| GraphQL schema and local playground | Implemented | [graphql.ts](../../backend/src/graphql.ts) |
| Paginated posts and request-scoped author batching | Implemented | [posts.ts](../../backend/src/resolvers/posts.ts), [loaders.ts](../../backend/src/loaders.ts) |
| Account provisioning and password verification | Implemented | [provision-account.ts](../../backend/src/auth/provision-account.ts), [credentials.ts](../../backend/src/auth/credentials.ts) |
| Session creation, lookup and revocation helpers | Implemented | [sessions.ts](../../backend/src/auth/sessions.ts) |
| Guarded GraphQL login and session-cookie issuance | Implemented; integration test cases exist | [login.ts](../../backend/src/resolvers/login.ts), [login tests](../../backend/tests/integration/login.test.ts) |
| Session cookie parsing helper | Exists; not integrated into request context | [session-cookie.ts](../../backend/src/auth/session-cookie.ts) |
| Incoming session-to-actor integration, me and logout | Not wired | [Authentication design](../authentication/login.md) |
| Draft visibility and authorization enforcement | Policy and status data exist; enforcement pending | [Authorization policy](../authorization.md) |
| Tracing, structured logs, k6 and CI | Implemented | [Tracing](../tracing.md), [load testing](../load-testing.md), [CI](../../.github/workflows/ci.yaml) |
| Whole-operation depth and complexity protection | Deferred / pending | Future RFC |
| Schema evolution and distributed GraphQL | Pending learning exercises | Future RFCs |

These states describe implementation, not a fresh verification run. Earlier passing results do not prove that every current working-tree edit passes.

### Local implementation note

During this documentation review, main.ts contained `rateLimiter: options.rateLimiter ?? createLoginRateLimiter()` in its context object, but no `options` variable is defined in that module. This appears to be a test-helper customization copied into application wiring. Correct that working-tree issue and rerun typecheck before treating the current checkpoint as verified. It is not part of the intended architecture.

## Architecture and ownership

![C4 containers](../diagrams/c4-containers.png)

The product boundary contains one backend application and one application database. Jaeger is a supporting tracing system. The C4 container boundary is logical; the Compose network and named volumes describe deployment details separately.

| Boundary | Owns |
|---|---|
| HTTP transport | Routing, request metadata, request-scoped setup and cookie response handling |
| GraphQL layer | Schema, root resolver registration, response mapping and public error codes |
| Query implementation | Pagination validation, post retrieval and author loading |
| Authentication helpers | Credential checks, verification capacity, sessions and request-attempt policy |
| MongoDB | Persistent documents and indexes |
| Telemetry | Trace export, custom spans and log correlation |

There is no repository abstraction wrapping every MongoDB call. Resolvers currently perform query access directly; authentication logic is separated into services and helpers. Future business authorization should live with reusable application services, not only in GraphQL entry points.

## Key request flows

### Read posts with authors

1. Express receives the request and captures request/trace identifiers.
2. GraphQL validates against the schema and dispatches the registered posts resolver.
3. The resolver validates page size and decodes the cursor before database work.
4. MongoDB returns a bounded page sorted by string _id, fetching one extra document to determine hasNextPage.
5. Selected author fields call the request's user loader. Queued unique IDs are fetched together, then mapped back to the original key order.
6. GraphQL returns the connection and any field errors. Loader state ends with the request.

[Sequence diagram](../architecture.md#follow-a-posts-query). [Decision: pagination and batching](decisions/0002-pagination-and-dataloader.md).

### Sign in

1. The login resolver invokes the request guard: POST, custom header and exact supplied Origin.
2. An allowed attempt consumes the IP allowance; a request can attempt login only once.
3. Credential input is validated. A process-wide limiter admits at most two active verification operations.
4. The verifier looks up the normalized username and runs asynchronous scrypt against the stored record or a startup-generated dummy record for an unknown account.
5. Successful verification returns public identity. The session service rechecks account/user existence and inserts a fresh token hash with expiry.
6. The HTTP callback sets the raw token as an HttpOnly cookie; GraphQL returns public identity, not the token.

[Sequence diagram](../architecture.md#follow-a-login-mutation). [Decision: sessions](decisions/0003-opaque-sessions-and-identity.md). [Decision: login boundaries](decisions/0004-graphql-login-and-resource-limits.md).

Cookie issuance does not yet authenticate later application operations. The parser and session-lookup helpers exist, but main.ts does not populate an actor from incoming cookies.

## Decisions and alternatives

| Decision | Why it fits this project | Cost / consequence |
|---|---|---|
| [Docker, Express and MongoDB](decisions/0001-development-stack-and-boundaries.md) | Matches the agreed learning environment while keeping transport explicit | Shared local resources and development mode limit production conclusions |
| [Cursor pagination and request-scoped DataLoader](decisions/0002-pagination-and-dataloader.md) | Bounds each list and removes the demonstrated author N+1 pattern | Does not bound whole-operation cost or fix inefficient database work |
| [Opaque server-side sessions and shared account/user ID](decisions/0003-opaque-sessions-and-identity.md) | Makes expiry/revocation explicit and models one account per public user | Adds storage dependence and constrains independent account lifecycles |
| [GraphQL login with layered protections](decisions/0004-graphql-login-and-resource-limits.md) | Keeps authentication inside the API being learned | Requires deliberate HTTP-cookie integration and process-local resource policy |
| [Traces, logs and isolated verification](decisions/0005-observability-and-evidence.md) | Makes performance claims and failure paths inspectable | Instrumentation overhead and test boundaries must be acknowledged |

## Data and lifecycle

Public users and private accounts are separate collections with a shared ID. Posts refer to their author by ID. Sessions refer to an account and use the token hash as their document ID. MongoDB does not enforce these references as foreign keys; application services check the relationships they depend on.

Session expiry is checked during lookup. The TTL index only cleans up expired documents asynchronously. The application uses one MongoClient per process. The database volume stores persistent data; the dependency volume stores node_modules; neither is a backup strategy.

The posts-author compound index supports the author-filtered query studied with explain. The current public posts query filters by cursor, not author or visibility. Index existence must not be confused with use by every query.

[Data model and index details](../architecture.md#data-model-and-persistence). [Query-plan evidence](../query-plans.md).

## Failure behavior and security boundaries

| Situation | Current behavior / boundary |
|---|---|
| Invalid cursor or page size | BAD_USER_INPUT before post database work |
| Missing learning check | Nullable field returns null |
| Missing author | Nullable author returns null |
| Database failure in a nullable field | Sanitized field error permits unaffected sibling fields to return data |
| Unknown username or wrong password | Same generic UNAUTHENTICATED login error |
| Invalid login input | BAD_USER_INPUT; admitted request still consumed an attempt |
| Rejected login method/header/Origin | FORBIDDEN before credential verification |
| Exhausted IP attempt allowance | TOO_MANY_REQUESTS with retryAfterSeconds |
| Exhausted verification capacity | SERVICE_UNAVAILABLE; no application queue |
| Failed session storage | Generic SERVICE_UNAVAILABLE; cookie callback is not reached |
| Second login alias | Rejected; an earlier successful alias is not rolled back |

GraphQL HTTP 200 does not imply operation success. Clients and tests inspect the errors field as well as status.

Credential inputs cannot assign roles or choose the authenticated actor. Raw passwords and session tokens should not enter logs or traces. This is a design requirement, not a claim that a complete telemetry security audit has been performed.

The custom header is not a secret. The current login guard allows an absent Origin for non-browser clients but requires an exact match when Origin is supplied. Request protections depend on the intended browser/CORS behavior and must be reassessed if cross-origin access is added.

## Performance evidence and its limits

The original five-post exercise moved from six database calls to two for the demonstrated posts-with-authors operation. This shows reduced round trips, not a guaranteed latency improvement for arbitrary queries. Additional dependency levels can produce additional DataLoader batches.

The documented 30-second k6 runs requested 20 posts with authors using 1, 5 and 10 concurrent virtual users. Recorded p95 HTTP durations were 10.95 ms, 41.91 ms and 72.61 ms respectively; all response checks passed in those runs. Throughput increased with diminishing gains. A bottleneck was not proven.

[Recorded results and trace analysis](../load-testing.md) remain the evidence source. The workload is closed-loop, local, short, and includes development mode, tracing and logging overhead. These numbers are not a production SLO or capacity forecast. A trace timeline inconsistency remains unresolved; do not describe it as a proven database stall.

## Verification strategy

| Layer | What it establishes | What it does not establish |
|---|---|---|
| Format and type checks | Consistent formatting and compile-time checks | Runtime correctness |
| Unit tests | Helper policies, token/password handling, limits and cookie attributes | Entire deployed login flow |
| MongoDB integration tests | Credential/session behavior and GraphQL resolver effects against real test storage | Full browser behavior |
| Login schema execution tests | Resolver registration, public errors, session persistence and cookie-callback invocation | HTTP header transport and browser cookie acceptance end to end |
| Manual playground checks | Behavior observed through the local API | Exhaustive regressions |
| k6 checks and traces | Response correctness and timing for the selected workload | Production capacity or causal proof of a bottleneck |

The local integration profile uses dedicated test-mongo storage and the guarded test database name. CI runs checks, unit tests and MongoDB integration tests in separate jobs. The documentation work itself does not establish a new passing test run.

## Gaps and next steps

1. Correct the local main.ts wiring issue and recheck the current checkpoint.
2. Connect incoming cookies to session lookup and actor context, with explicit storage-failure behavior.
3. Add me and logout with HTTP-level verification of cookie handling.
4. Enforce the documented authorization policy in reusable services, including visibility before pagination.
5. Revisit depth and whole-operation cost protection, aliases, field cost and resource bounds.
6. Exercise compatible schema evolution, then distributed GraphQL ownership and failures.

Before production use, separate work would be required for deployment, TLS, secrets, backups, distributed limits, operational health, schema governance and realistic capacity measurement. These are boundaries of this learning snapshot, not an approved production checklist.

## Change process

Use a [feature RFC](rfcs/0000-template.md) when upcoming work needs a design decision. Keep it Proposed until a human decision is recorded. Implementation and validation are separate statuses. Once a meaningful choice is adopted, add or supersede a decision record and update the architecture's feature state in the same PR.

Do not duplicate API contracts across documents: this guide owns goals, rationale and scope; feature documents own their contracts; C4 views own structure; sequence diagrams own execution flows; test code and recorded experiment documents own evidence.

## Interview walkthrough

Start with: "I built a small Docker-based Express and GraphQL application to study N+1 behavior, performance and API boundaries."

Then select one problem and explain problem, alternatives, decision, tradeoff and evidence. For DataLoader, demonstrate the database-call reduction and explain request scope. For login, follow guards, bounded verification, session storage and cookie delivery. Finish by stating what is not implemented yet, particularly actor integration, authorization enforcement and whole-operation abuse protection.

The goal is a defensible explanation of the current system, not a claim that every future feature already exists.

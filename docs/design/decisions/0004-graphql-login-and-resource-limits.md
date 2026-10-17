# ADR 0004: GraphQL login with separate request and resource protections

Status: Accepted - implemented for login. Recorded retrospectively: 17 October 2026.

## Context

The user already has REST experience and wants authentication to exercise GraphQL. Password verification consumes significant CPU and memory even when asynchronous. A mutation can contain multiple login aliases.

## Alternatives

- REST login: valid and straightforward, but does not meet the chosen learning direction.
- Check credentials directly in one large route callback: fewer files, but mixes request handling, expensive verification and session persistence.
- Rely only on an IP rate limit: bounds attempts over time but not simultaneous expensive checks from many clients.
- Queue unlimited verification tasks: defers rejection while allowing queued work and latency to grow.

## Decision

Expose login as a nullable GraphQL mutation and coordinate reusable helpers from its resolver. Require POST and X-GraphQL-Auth: 1; require a supplied Origin to match the configured application origin. Allow clients without Origin if the other checks pass.

Use a process-wide in-memory IP limiter with ten attempts per fifteen-minute window and a 10,000-key ceiling. Count admitted attempts before checking whether the same request already attempted login. Allow one attempted login per request. Validate credentials, then admit at most two simultaneous verification operations without an application queue. Use asynchronous scrypt and a startup-generated dummy password record for unknown accounts.

Set the cookie only after session persistence succeeds. Return public identity and generic credential errors; map operational failures to SERVICE_UNAVAILABLE.

## Consequences

Tests can exercise request guards, credentials and session effects independently. Incorrect input consumes an admitted attempt. A second alias does not roll back an earlier successful login. IP allowance and verification capacity are different controls. Both are process-local; restarting resets rate-limit state. Docker/NAT may cause clients to share an IP. The custom header is not an authentication secret, and cross-origin browser policy remains part of the trust boundary.

## Evidence and revisit triggers

See [login resolver](../../../backend/src/resolvers/login.ts), [request guard](../../../backend/src/auth/request-guard.ts), [attempt guard](../../../backend/src/auth/login-attempt.ts), [credentials](../../../backend/src/auth/credentials.ts) and [login integration tests](../../../backend/tests/integration/login.test.ts). The tests cover multiple aliases, shared attempt allowance, capacity-error mapping and session-storage failure. Revisit limits using measured resource use; revisit storage and proxy trust before multiple replicas or reverse-proxy deployment.

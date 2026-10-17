# ADR 0001: Docker development with one Express backend and MongoDB

Status: Accepted - implemented. Recorded retrospectively: 17 October 2026.

## Context

The project teaches GraphQL engineering through a small Express application. Development must not require host installations of Node.js or MongoDB. The user chose TypeScript and MongoDB.

## Alternatives

- Run Node.js and MongoDB directly on the host: fewer container commands, but violates the agreed environment constraint.
- Split domain responsibilities into services immediately: useful for distributed ownership exercises, but adds deployment and network failure concerns before the local request path is understood.
- Choose a different HTTP framework or database: possible, but does not match the agreed Express/MongoDB learning scope.

## Decision

Use Docker Compose for a Node.js/Express backend and MongoDB. Keep application modules inside one backend process. Bind-mount source for development; store node_modules and database files in separate named volumes. Use a separate test MongoDB service for integration tests.

## Consequences

The environment is reproducible without a host runtime install. File ownership and mount behavior need explicit handling. Multiple infrastructure containers do not make the application microservices. Shared local hardware and watch-mode execution constrain interpretation of benchmarks.

## Evidence and revisit triggers

See [Compose](../../../compose.yaml), [main.ts](../../../backend/src/main.ts) and the [C4 container view](../../c4-architecture.md#level-2---containers). Revisit application boundaries when a distributed exercise introduces concrete ownership or scaling requirements, not merely because more modules exist.

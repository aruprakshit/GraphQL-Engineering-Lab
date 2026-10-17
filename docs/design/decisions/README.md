# Decision records

These records describe choices already reflected in code. Status "Accepted - implemented" means the project uses that choice; it does not claim a historical formal approval process or a fresh test run. Recorded: 17 October 2026.

| Record | Decision |
|---|---|
| [0001](0001-development-stack-and-boundaries.md) | Docker development with one Express backend and MongoDB |
| [0002](0002-pagination-and-dataloader.md) | Combine bounded cursor pagination with request-scoped DataLoader |
| [0003](0003-opaque-sessions-and-identity.md) | Opaque sessions and one account per public user |
| [0004](0004-graphql-login-and-resource-limits.md) | GraphQL login with separate request and resource protections |
| [0005](0005-observability-and-evidence.md) | Correlated traces/logs and verification with explicit evidence limits |

For a new choice, record context, alternatives, decision, consequences, evidence and revisit triggers. If a choice changes, add a superseding record rather than silently rewriting its original reasoning. Small implementation details do not each need an ADR.

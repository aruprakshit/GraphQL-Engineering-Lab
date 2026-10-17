# ADR 0003: Opaque sessions and one account per public user

Status: Accepted - implemented at the service and cookie-issuance layers. Incoming request integration is pending. Recorded retrospectively: 17 October 2026.

## Context

Authorization needs trusted identity. The project needs to demonstrate expiry, revocation and the difference between public user data and private credentials without introducing a separate token-learning project.

## Alternatives

- JWT access tokens: useful in some distributed designs, but revocation, stale claims and key lifecycle introduce additional decisions beyond this exercise.
- Independent account and user IDs: useful for multiple identities or independent lifecycles, but requires an explicit relationship that the current one-to-one model does not need.
- Store raw bearer tokens in MongoDB: simpler lookup, but a database leak would expose immediately usable session tokens.

## Decision

Generate a fresh random 32-byte token, store its SHA-256 hash as the session ID, and deliver the raw token through an HttpOnly cookie. Sessions expire after eight hours without sliding renewal. Lookup enforces expiry and current supported account role; TTL performs background cleanup. Revocation deletes the supplied session and is idempotent.

Keep users and accounts in separate collections with the same ID. Provisioning requires an existing public user. Username uniqueness is enforced by an index. The current model allows one account per user and multiple sessions per account.

## Consequences

Private password records stay outside the public user document. Session helpers can reflect current role or missing-account changes, but authenticated requests will depend on storage once integrated. Shared IDs constrain independent identity lifecycles. Cookie issuance alone does not authenticate subsequent requests. Session lookup and insertion are not one cross-collection transaction; production lifecycle and race requirements would need further design.

## Evidence and revisit triggers

See [sessions](../../../backend/src/auth/sessions.ts), [models](../../../backend/src/auth/models.ts), [provisioning](../../../backend/src/auth/provision-account.ts) and [session integration tests](../../../backend/tests/integration/sessions.test.ts). Revisit the identity relationship for multiple login identities, external identity providers or independently managed accounts. Revisit token architecture when an actual distributed requirement exists.

# Authorization design

This document defines the intended policy. Authentication and
authorization enforcement are not yet implemented.

## Identity and post status

- An actor is an authenticated user with a user ID and a role:
  user or admin.
- Anonymous requests have no actor.
- "Post author" means the authenticated user whose ID matches
  the post's authorId. It is a relationship, not a global role.
- Posts have a status of draft or published.
- Existing seed posts have been marked published.

## Permissions

| Action | Anonymous | Signed-in non-author | Post author | Admin |
|---|---|---|---|---|
| Read published posts | Allowed | Allowed | Allowed | Allowed |
| Read a draft | Denied | Denied | Allowed | Allowed |
| Create a draft | Denied | Allowed | Allowed | Allowed |
| Edit a post | Denied | Denied | Allowed | Allowed |
| Publish a draft | Denied | Denied | Allowed | Allowed |

Creating a draft assigns the authenticated actor as its author.
Clients cannot choose another author through this operation.

Publishing requires the post to currently be a draft, including
when the actor is an admin.

## Responsibility boundaries

### Authentication

Establish the actor's user ID and role from validated credentials
or a session. GraphQL arguments cannot establish or override identity.

### Object authorization

Determine whether the actor may access or modify a specific post,
based on its publication status, ownership, and the actor's role.

### Business rules

Determine whether an authorized action is valid for the post's
current state. For example, an already published post cannot
undergo the draft-to-published transition again.

### Enforcement location

Post services will enforce object authorization and business rules.
GraphQL resolvers will call those services.

The same rules must apply when services are called through future
REST routes, command-line tools, or background jobs.

Lists must filter out inaccessible records before applying pagination
and calculating page information.

## Authorization test scenarios

| Scenario | Expected |
|---|---|
| Anonymous visitor reads a published post | Allowed |
| Anonymous visitor reads a draft | Denied |
| Ada reads Grace's draft | Denied |
| Grace reads her own draft | Allowed |
| Admin reads Grace's draft | Allowed |
| Anonymous visitor creates a draft | Denied |
| Ada creates a draft | Allowed; author is Ada |
| Ada edits Grace's post | Denied |
| Grace edits her own post | Allowed |
| Admin edits Grace's post | Allowed |
| Grace publishes her own draft | Allowed |
| Ada publishes Grace's draft | Denied |
| Admin publishes Grace's draft | Allowed |
| Grace publishes an already published post | Rejected by business rule |
| Admin publishes an already published post | Rejected by business rule |

These scenarios define expected behavior for subsequent
implementation tickets.

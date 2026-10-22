# GraphQL authentication contract

Status: login, incoming session lookup, `me`, and logout are implemented.
See [the authentication overview](README.md) for diagrams, storage design,
verification commands, and remaining work.

## Schema

These are the authentication fields; existing query fields remain in the schema.

```graphql
enum AccountRole {
  USER
  ADMIN
}

input LoginInput {
  username: String!
  password: String!
}

type AuthUser {
  id: ID!
  name: String!
  role: AccountRole!
}

type LoginPayload {
  user: AuthUser!
}

extend type Query {
  me: AuthUser
}

type Mutation {
  login(input: LoginInput!): LoginPayload
  logout: Boolean
}
```

Stored roles are `user` and `admin`; resolvers map them to `USER` and `ADMIN`.
Nullable root fields allow field errors without requiring the entire response to
be null. GraphQL mutation fields execute serially, but they are not a transaction:
a successful first field is not rolled back when a later field fails.

## Playground walkthrough

Open `/playground` and configure these request headers for login and logout:

```json
{
  "X-GraphQL-Auth": "1"
}
```

The browser supplies Origin automatically. Configure `AUTH_ALLOWED_ORIGIN` to
match the application's exact origin, for example `http://localhost:4000`.
A different host or port is a different origin.

### Login

```graphql
mutation Login($input: LoginInput!) {
  login(input: $input) {
    user {
      id
      name
      role
    }
  }
}
```

Example variables only; use your provisioned account and its actual password:

```json
{
  "input": {
    "username": "ada",
    "password": "example only; replace with your provisioned password"
  }
}
```

The response contains public identity. `Set-Cookie` supplies the opaque token
only after session storage succeeds. Inspect cookie attributes in DevTools;
do not share actual passwords or cookie values.

### Current identity

```graphql
query CurrentUser {
  me {
    id
    name
    role
  }
}
```

The browser sends the stored cookie. A valid session returns identity; missing,
malformed, unknown, expired, or revoked sessions return `me: null` without an error.
Deleted accounts or public users also produce no identity. Each request reads the
current account role. Storage failure is an error, not an anonymous result.

### Logout

```graphql
mutation Logout {
  logout
}
```

Success returns `logout: true`, deletes the incoming session, and expires its
cookie. Running `me` afterward returns `null`. Repeating logout succeeds.
Other sessions for the same account remain valid.

## Error contract

Inspect `errors[].extensions.code` and `errors[].path`, not just HTTP status.
Parsing, validation, and transport failures can have different HTTP behavior
from resolver execution errors.

| Situation | Code | Behavior |
| --- | --- | --- |
| Wrong password or unknown username | `UNAUTHENTICATED` | Same message: Invalid username or password |
| Invalid username or password policy | `BAD_USER_INPUT` | No session created |
| Additional login invocation in one request | `BAD_USER_INPUT` | No additional verification or session |
| Invalid auth method, header, or supplied Origin | `FORBIDDEN` | No authentication state change |
| Login IP allowance exhausted | `TOO_MANY_REQUESTS` | `retryAfterSeconds` in extensions |
| Password verification capacity exhausted | `SERVICE_UNAVAILABLE` | `retryAfterSeconds: 1`; no waiting queue |
| Login rate-limit storage exhausted or client IP missing | `SERVICE_UNAVAILABLE` | Generic login-unavailable response |
| Account lookup, hashing, or session creation fails | `SERVICE_UNAVAILABLE` | No successful login or new cookie |
| Session resolution fails | `SERVICE_UNAVAILABLE` | No anonymous fallback |
| Public profile lookup fails during me | `SERVICE_UNAVAILABLE` | Generic user-unavailable response |
| Session revocation fails | `SERVICE_UNAVAILABLE` | No cookie clearing or successful logout |

## Request protections and limits

| Control | Implemented behavior |
| --- | --- |
| Authentication mutations | POST and `X-GraphQL-Auth: 1` required |
| Supplied Origin | Exact match to configured allowed origin |
| Missing Origin | Allowed with required method and header |
| Password policy | 15-128 Unicode code points; at most 1024 UTF-8 bytes; whitespace preserved |
| Verification concurrency | Two active checks per process, no waiting queue |
| Login rate | Ten invocations per IP per 15-minute fixed window |
| Attempt storage | At most 10,000 keys; reject new keys if full after expiry cleanup |
| Login invocation guard | At most one attempt per request |
| Session lifetime | Eight hours; no sliding renewal |
| GraphQL caching | `Cache-Control: no-store` |

Request validation happens before counting an attempt. After validation, both
successful and failed invocations count; additional aliases also consume the IP
allowance before the invocation guard rejects them. Unknown usernames use a dummy
hash. This reduces a timing difference without making the whole request constant-time.

The limiter is shared across requests within one process. Restarting resets it;
replicas do not share counts. Express uses connection-derived `req.ip` with default
`trust proxy: false`; Docker may make clients share an address.

The proposed 64 KiB JSON body cap is pending, not an implemented guarantee.
[Depth protection](../query-depth.md) is implemented under ticket #32. Current authentication limits do
not replace general depth, complexity, width, or response-size controls.

## Implementation map

Paths below are relative to `backend/`.

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Extract cookie, create per-request helpers, connect Express response helpers |
| `src/graphql-context.ts` | Typed resolver dependencies |
| `src/resolvers/index.ts` | Register login, me, and logout in rootValue |
| `src/resolvers/login.ts` | Guards, verification, session creation, cookie issuance |
| `src/resolvers/me.ts` | Resolve actor and read public profile |
| `src/resolvers/logout.ts` | Request guard, revocation, cookie clearing |
| `src/auth/request-guard.ts` | Method, custom header, and Origin policy |
| `src/auth/login-attempt.ts` | Request-scoped login guard and shared limiter use |
| `src/auth/login-rate-limit.ts` | Bounded in-memory attempt windows |
| `src/auth/credentials.ts` | Credential lookup and real/dummy verification |
| `src/auth/concurrency.ts` | Bound active password verification work |
| `src/auth/session-cookie.ts` | Strict extraction of incoming token |
| `src/auth/request-actor.ts` | Lazy per-request actor Promise and sanitized errors |
| `src/auth/sessions.ts` | Transport-independent session creation, lookup, revocation |
| `src/auth/cookies.ts` | Express cookie setting and clearing |

`getActor()` shares a Promise within the request, including a null result or
rejection. It is not a global identity cache. Logout uses the incoming token
directly, without actor lookup or login rate counting.

## Boundaries and follow-ups

Authentication supplies identity. Post authorization and publication rules still
need service-level implementation; they are not automatically applied to existing
post queries by adding login.

One successful login is not rolled back if a later login alias fails. Combining
login and logout within the same operation still needs an explicit policy and
tests: logout currently targets the incoming cookie, and an already resolved actor
stays cached for the request. Use separate operations for the documented flow.

Keep passwords, password records, raw tokens, cookie headers, and sensitive
GraphQL documents or variables out of logs and traces. An instrumentation audit
remains a follow-up; using variables alone does not establish safe logging.


# Verify setup in a separate checkout

Use this procedure to verify the README from a clean dependency installation and empty database without stopping or modifying the usual development application. All runtime commands use Docker. Commands target WSL Bash and begin in the original repository root.

## Isolation plan

| Resource | Verification setup |
| --- | --- |
| Source | Separate local clone at ../graphql-lab-readme-check |
| Compose project | graphql-lab-readme-check |
| Backend dependency volume | graphql-lab-readme-check-node-modules |
| User-service dependency volume | graphql-lab-readme-check-user-service-node-modules |
| MongoDB data volume | graphql-lab-readme-check_mongo-data |
| Backend host port | 4002 |
| Jaeger host port | 16688 |
| Browser authentication origin | http://localhost:4002 |
| Environment | New ignored .env and independently generated service token |

The original app's ports 4000 and 16686, dependency volumes, and database volume are not used. Image downloads and host CPU/memory are still shared: this is resource-name isolation for functional setup verification, not a performance-isolation experiment.

`compose.verify.yaml` is explicit opt-in configuration. It changes published ports and dependency volume names, leaving service source paths and behavior intact. The !override tag replaces the port list rather than appending another binding. It requires Docker Compose 2.24.4 or newer. See [Docker's merge documentation](https://docs.docker.com/reference/compose-file/merge/).

## 1. Commit the setup documentation checkpoint

A local clone copies committed source, not uncommitted edits, ignored files, or the original .env. First commit README.md, .env.example, compose.verify.yaml, and this guide on the feature branch. Then check:

```sh
git status --short
docker compose version
```

If the intended target directory or verification volumes already exist, do not treat them as fresh or overwrite/remove them blindly. Inspect the earlier verification state first. This procedure assumes the named sandbox has not been used before.

## 2. Make the separate checkout

From the original repository root:

```sh
git clone --no-hardlinks --single-branch \
  --branch "$(git branch --show-current)" \
  . ../graphql-lab-readme-check

cd ../graphql-lab-readme-check

git rev-parse --short HEAD
```

This clones the current local feature branch, so it does not require pushing unfinished documentation to main. --no-hardlinks avoids sharing Git object files through hard links. It is not a worktree and does not copy the original working directory's local changes.

## 3. Create the sandbox environment

In the new checkout only:

```sh
{
  printf 'LOCAL_UID=%s\nLOCAL_GID=%s\n' "$(id -u)" "$(id -g)"
  docker run --rm node:26-alpine node -e \
    'console.log("USER_SERVICE_TOKEN=" + require("node:crypto").randomBytes(32).toString("hex"))'
} > .env
```

Do not copy or print the original service token. Confirm .env is ignored:

```sh
git check-ignore .env
```

Define a terminal-local helper so every following command uses the sandbox project and override:

```sh
dc() {
  docker compose \
    -p graphql-lab-readme-check \
    -f compose.yaml \
    -f compose.verify.yaml \
    "$@"
}

dc config --quiet
```

Keep using dc in this terminal and checkout. A new terminal needs the helper defined again. Do not run bare docker compose commands during verification, because they omit the sandbox override. Do not print full resolved configuration into issue reports: it includes environment credentials.

## 4. Create dedicated dependency volumes

```sh
docker volume create graphql-lab-readme-check-node-modules
docker volume create graphql-lab-readme-check-user-service-node-modules

docker run --rm \
  -v graphql-lab-readme-check-node-modules:/app/node_modules \
  node:26-alpine \
  chown "$(id -u):$(id -g)" /app/node_modules

docker run --rm \
  -v graphql-lab-readme-check-user-service-node-modules:/app/node_modules \
  node:26-alpine \
  chown "$(id -u):$(id -g)" /app/node_modules
```

Then follow the README's dependency-installation steps through the sandbox helper:

```sh
dc run --rm --no-deps backend npm ci
dc run --rm --no-deps user-service npm ci
```

Do not substitute the original application's external volume names. The override deliberately redirects both installations to new storage.

## 5. Verify empty storage, seed, and indexes

```sh
dc up -d mongo

dc exec mongo mongosh graphql_engineering_lab --quiet --eval '
  printjson({
    users: db.users.countDocuments({}),
    posts: db.posts.countDocuments({})
  })
'
```

Wait for MongoDB to become healthy if the shell command runs before startup completes. On genuinely fresh verification storage, both counts must be zero. If they are not, stop and establish which storage is mounted; do not delete data merely to force the expected result.

```sh
dc up -d jaeger user-service backend

dc exec backend npm run seed
dc exec backend npm run db:indexes

dc exec backend npm run seed
dc exec backend npm run db:indexes

dc ps
dc logs --tail=30 backend user-service
```

The first seed inserts three users and 30 published posts. The second inserts zero of each. Index creation succeeds when repeated. This checks repeatability without treating seed as a reset command.

```sh
dc exec mongo mongosh graphql_engineering_lab --quiet --eval '
  printjson({
    users: db.users.countDocuments({}),
    posts: db.posts.countDocuments({}),
    published: db.posts.countDocuments({ status: "published" }),
    drafts: db.posts.countDocuments({ status: "draft" })
  })
'
```

Before any mutation walkthrough, expect users=3, posts=30, published=30, drafts=0.

## 6. Follow the browser walkthrough

Use these sandbox addresses:

- Playground: http://localhost:4002/playground
- Backend health: http://localhost:4002/health
- Jaeger: http://localhost:16688

Follow the README's posts query, pagination, account provisioning, login, me, draft creation, editing, publishing, logout, and partial-failure examples. Replace docker compose with dc for every terminal command. The override sets AUTH_ALLOWED_ORIGIN to port 4002, matching the sandbox browser origin.

For example:

```sh
dc exec backend npm run account:provision -- \
  --user-id user-1 --username ada

dc exec backend node --import tsx/esm src/check-loader.ts
```

Use the prompted password only in the browser's login variables; do not save it in the verification record. Set X-GraphQL-Auth to 1 for login/logout and ensure cookies are sent. Record outcomes, not passwords, cookies, or tokens.

When testing service failure, stop only the sandbox user service:

```sh
dc stop user-service
# Compare a posts query with author selections against one without them.
dc start user-service
# Confirm author queries recover.
```

In Jaeger, confirm one GraphQL trace contains both service names. Mutations change sandbox fixture counts; do not expect the original 30-post count after creating drafts.

## 7. Run automated checks

```sh
dc exec backend npm run format:check
dc exec backend npm run typecheck
dc exec backend npm test
dc exec backend npm run schema:check

dc exec user-service npm run format:check
dc exec user-service npm run typecheck
dc exec user-service npm test

dc --profile test run --rm integration-tests
dc --profile test run --rm user-service-integration-tests
```

If formatting fails, report the file first; do not silently rewrite the clean checkout and claim the checked-out commit passed. Apply intentional fixes on the feature branch, commit them, and repeat from that corrected state.

To verify the documented load-test command, run the existing 30-second one-user workload:

```sh
dc --profile loadtest run --rm -e VUS=1 k6
```

The purpose here is to confirm startup and response checks, not establish another performance baseline. Inspect README examples and local links as well as automated results.

## 8. Stop the sandbox

In the verification checkout and terminal with dc defined:

```sh
dc down
```

This retains the sandbox database and both dedicated external dependency volumes. No volume-removal command is required for verification. The original application remains separate; confirm its usual health endpoint and services still work.

Leave the checkout available until any setup corrections have been incorporated into the feature branch. Do not use verification as a reason to overwrite or remove the original checkout or volumes.

## Verification record

Status: the developer reported that the isolated setup and all requested verification steps passed during issue #71. This records the developer's manual verification; it is not a claim that the documentation editor executed the Docker commands.

| Check | Reported outcome |
| --- | --- |
| Separate checkout and isolated Docker resources | Verified |
| Fresh locked dependency installation for both applications | Verified |
| Empty initial storage, seed fixtures, and repeatable seeding/indexes | Verified |
| Sandbox Playground and documented pagination | Verified |
| Account provisioning, login, me, draft creation/editing/publication, and logout | Verified |
| GraphQL trace containing both services | Verified |
| Profile-service outage behavior and subsequent recovery | Verified |
| Backend and user-service automated checks, including integration tests | Verified |
| Documented load-test command and response checks | Verified |

No blocking setup issue was reported. The exact tested checkout commit and Docker Compose version were not supplied with the completion report, so this record does not assert those values. Capture them when repeating the procedure for release-specific reproducibility.

Keep future verification records free of passwords, cookies, service tokens, and raw resolved Compose environment output.

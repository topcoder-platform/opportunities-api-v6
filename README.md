# Topcoder Opportunities API v6

This NestJS service owns the small cross-domain aggregate used by the Topcoder
Opportunities header. Detailed competition, engagement, copilot, and review
records continue to come dynamically from their owning v6 APIs. This service
does not fan out to those HTTP APIs: it uses their supported Prisma client
packages to read each owning database directly.

## Summary endpoint

`GET /v6/opportunities/summary` is public and accepts no parameters. It runs
bounded lightweight reads against the owning domains concurrently and returns a
standard v6 envelope:

```json
{
  "result": {
    "success": true,
    "status": 200,
    "content": {
      "cells": {
        "competitions": { "count": 12, "amount": 38500 },
        "engagements": { "count": 8 },
        "copilots": { "count": 2 },
        "reviews": { "count": 3 }
      },
      "generatedAt": "2026-08-13T01:23:45.678Z"
    }
  }
}
```

The cell rules intentionally match anonymous discovery:

- Competitions are `ACTIVE`, non-task challenges whose `groups` array is empty
  and which have no user-whitelist rows. `amount` is the sum of their
  non-negative `overviewTotalPrizes` values, rounded to USD cents.
- Engagements are `OPEN` and `isPrivate = false`. The free-form
  `compensationRange` is not parsed, so no amount or speculative tag is emitted.
- Copilot opportunities are `active` and not soft-deleted. The current projects
  schema stores payment descriptions inside request JSON but no numeric payment,
  so `amount` is omitted until the owning schema provides one.
- Reviews are `OPEN` review-opportunity rows attached to the same public,
  `ACTIVE` challenge set. Review payments are not part of the Figma cell.

If any database read fails or the whole-summary deadline expires, the endpoint
returns HTTP `503` with `Opportunity summary is temporarily unavailable.` It
never converts a failed domain into a misleading zero or returns a partial
summary. Failed or timed-out work is not cached, and the shared in-flight slot
is released so a later request can retry.

Successful summaries are cached in-process for 15 seconds by default, and
concurrent cache misses share one in-flight query. The endpoint is also limited
to 60 requests per client IP per 60 seconds. These controls bound repeated
public fan-out while keeping the header current; tune them with the runtime
settings below. Rate-limit state is process-local, so multi-replica deployments
should use an ingress or shared store when a globally consistent quota is
required.

The throttler keys clients using Express `request.ip`. At startup the service
configures an exact trusted-proxy hop count so requests arriving through an ALB,
API gateway, or ingress use the forwarded client address instead of collapsing
onto the edge address. The default trusts one immediate proxy hop. This assumes
the origin is reachable only through that trusted edge and that the edge
replaces or safely appends forwarding headers. Do not expose the origin directly
to untrusted clients with proxy trust enabled, because a direct client could
forge its forwarded address and evade per-IP throttling. Set the hop count to
the exact fixed trusted topology: too few hops can merge clients, while too many
can trust client-supplied addresses.

## Configuration and lifecycle

Copy `.env.example` to `.env`, then configure four distinct PostgreSQL URLs:

- `CHALLENGE_DATABASE_URL`
- `ENGAGEMENTS_DATABASE_URL`
- `PROJECTS_DATABASE_URL`
- `REVIEW_DATABASE_URL`

Optional positive-integer runtime settings are:

- `TRUST_PROXY_HOPS` (default `1`, the immediate trusted edge between clients
  and this process)
- `SUMMARY_CACHE_TTL_MS` (default `15000`)
- `SUMMARY_JOIN_ROW_LIMIT` (default `10000`)
- `SUMMARY_RATE_LIMIT` (default `60`)
- `SUMMARY_RATE_TTL_MS` (default `60000`)
- `SUMMARY_TIMEOUT_MS` (default `12000` for the complete aggregation)
- `DATABASE_CONNECT_TIMEOUT_MS` (default `5000` per connection/acquisition)
- `DATABASE_QUERY_TIMEOUT_MS` (default `5000` per database statement)
- `DATABASE_DISCONNECT_TIMEOUT_MS` (default `5000` per client)

All four database URLs are required and validated before the server starts;
errors name invalid variables without logging credentials. The external
factories create one lazy Prisma client per process. The Prisma 7 challenge,
engagements, and projects factories receive PostgreSQL `connectionTimeoutMillis`,
client-side query timeout, and server-side statement timeout settings. The
Prisma 6 review client receives equivalent `connect_timeout`, `pool_timeout`,
and `socket_timeout` URL parameters in memory; the configured secret URL is not
logged or rewritten on disk. The outer `SUMMARY_TIMEOUT_MS` deadline includes
lazy connection work and both stages of the review visibility join, providing
a final response-time bound if a driver is slow to settle.

Nest shutdown hooks disconnect all four pools in parallel on application
shutdown, bounding each attempt by the configured timeout. If a later factory
fails during startup, already-created clients receive the same bounded
best-effort cleanup before startup fails.

The cross-database review visibility join reads at most
`SUMMARY_JOIN_ROW_LIMIT + 1` lightweight review rows. Exceeding the configured
limit fails the whole summary with `503` rather than returning a partial count
or allowing unbounded memory use; raise it deliberately or investigate stale
open opportunities if that operational guard is reached.

Keep `SUMMARY_TIMEOUT_MS` high enough for the two sequential review stages; the
default is slightly above twice the per-statement default. Reducing it below
`DATABASE_QUERY_TIMEOUT_MS` is valid when a stricter whole-request deadline is
preferred.

The Prisma-client dependencies retain their `path:packages/...` selectors and
are pinned to the immutable merge commits that introduced the Opportunities
contracts in Challenge, Engagements, Projects, and Review. When an owning
client changes, update its commit deliberately and refresh the frozen lockfile;
do not switch deployment builds back to a mutable branch reference.

## Local development

```bash
nvm use
pnpm install
pnpm start:dev
```

The default API prefix is `/v6/opportunities`; override it with `API_PREFIX`.
OpenAPI documentation is served from `/docs`, and
`GET /v6/opportunities/health` provides the process health probe.

## Container deployment

The production image is a multi-stage Node 26 Alpine build. It verifies lint,
unit tests, and compilation in the build stage, installs production-only
dependencies into a clean stage, removes npm from the runtime image, and runs as
the unprivileged `node` user. Git is available only in the tooling stages used
to resolve source packages; it is absent from the final runtime image. The
frozen lockfile resolves each source dependency to a verified HTTPS tarball and
immutable commit. Refresh the lockfile whenever a source-client branch advances.

```bash
docker build --tag topcoder/opportunities-api-v6:local .
docker run --rm --env-file .env --publish 3000:3000 \
  topcoder/opportunities-api-v6:local
```

The image health check calls
`GET /v6/opportunities/health` on `${PORT:-3000}`. This is a liveness probe for
the HTTP process; callers should use `GET /v6/opportunities/summary` to verify
that all four database reads are available. When `API_PREFIX` is overridden,
the deployment health-check path must be overridden at the orchestrator level
to match it.

## Continuous deployment

CircleCI builds and deploys this service through the shared Topcoder deployment
suite. Commits on `develop` select the AWS development account (`DEPLOY_ENV=DEV`),
and commits on `master` select the AWS production account
(`DEPLOY_ENV=PROD`). Both jobs build a `linux/amd64` image whose Docker build
runs lint, unit tests, and compilation before deployment. BuildKit provenance
attestations are disabled so the image pushed to ECR is a single Docker
manifest that ECR basic scanning supports, rather than an attested OCI index.

The deployment reads configuration from Parameter Store without embedding
credentials in the repository:

- `/config/opportunities-api-v6/deployvar` supplies deployment coordinates.
- `/config/opportunities-api-v6/appvar` supplies service-specific task secrets.
- `/config/common/global-appvar` supplies shared task secrets.

Infrastructure must exist before CircleCI runs. The deployment preflight
requires the configured ECR repository and an `ACTIVE` ECS service, then the
shared suite publishes the new image, registers a new task-definition revision,
and updates that service. It deliberately fails rather than allowing the suite
to create missing infrastructure.

The development deployment coordinates are
`AWS_ECS_CLUSTER=tc-challenge-serverless` and
`AWS_ECS_SERVICE=opportunities-api-v6`. The container, task family, and ECR
repository should also use `opportunities-api-v6`. Each environment's
`deployvar` path must provide the deployment suite's standard values:

- `AWS_ECS_CLUSTER`
- `AWS_ECS_CONTAINER_CPU`
- `AWS_ECS_CONTAINER_MEMORY_RESERVATION`
- `AWS_ECS_CONTAINER_NAME`
- `AWS_ECS_FARGATE_CPU`
- `AWS_ECS_FARGATE_MEMORY`
- `AWS_ECS_PORTS` (normally `3000:3000:tcp`)
- `AWS_ECS_READONLY_ROOTFILESYSTEM`
- `AWS_ECS_SERVICE`
- `AWS_ECS_TASK_FAMILY`
- `AWS_REPOSITORY`
- `COUNTER_LIMIT`

The service-specific `appvar` path must provide the four required database URLs
listed in Configuration and lifecycle. Optional runtime settings can be added
there when an environment needs to override their documented defaults.

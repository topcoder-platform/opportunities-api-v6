# Topcoder Opportunities API v6

This NestJS service owns the aggregated summary endpoint used by the Topcoder Opportunities experience. Detailed competition, engagement, copilot, and review-opportunity records continue to come from their owning v6 APIs.

## Local development

```bash
nvm use
pnpm install
pnpm start:dev
```

The API is mounted below `/v6/opportunities`. OpenAPI documentation is served from `/docs`, and `GET /v6/opportunities/health` provides the process health probe.

Copy `.env.example` to `.env` when local values are required. Never commit database credentials.

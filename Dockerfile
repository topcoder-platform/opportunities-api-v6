# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:26.12.1-alpine3.24@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
ARG PNPM_VERSION=11.15.1

FROM ${NODE_IMAGE} AS tooling
ARG PNPM_VERSION
RUN apk upgrade --no-cache \
    && apk add --no-cache git \
    && npm install --global "pnpm@${PNPM_VERSION}"
WORKDIR /usr/src/app

FROM tooling AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tools ./tools
RUN pnpm install --frozen-lockfile

FROM tooling AS build

COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY . .
RUN pnpm lint \
    && pnpm test --runInBand \
    && pnpm test:dependency-compat \
    && pnpm build

FROM tooling AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tools ./tools
RUN pnpm install --prod --frozen-lockfile

FROM ${NODE_IMAGE} AS production
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules /opt/yarn* /usr/local/include/node \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY --from=build --chown=node:node /usr/src/app/dist ./dist
COPY --from=production-dependencies --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/package.json ./package.json

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/v6/opportunities/health" || exit 1

CMD ["node", "dist/main.js"]

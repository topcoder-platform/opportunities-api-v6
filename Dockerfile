# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
ARG PNPM_VERSION=11.15.1

FROM ${NODE_IMAGE} AS tooling
ARG PNPM_VERSION
RUN apk upgrade --no-cache \
    && apk add --no-cache 'zlib>=1.4-r0' git \
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

FROM alpine:3.24 AS production
ENV NODE_ENV=production
WORKDIR /usr/src/app
RUN apk upgrade --no-cache \
    && apk add --no-cache ca-certificates 'nodejs-current~26' 'nodejs-current>=26.13.1-r0' 'zlib>=1.4-r0' 'libcrypto3>=3.5.9-r1' 'libssl3>=3.5.9-r1' \
    && addgroup -S -g 1000 node \
    && adduser -S -D -u 1000 -G node node

COPY --from=build --chown=node:node /usr/src/app/dist ./dist
COPY --from=production-dependencies --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/package.json ./package.json

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/v6/opportunities/health" || exit 1

CMD ["node", "dist/main.js"]

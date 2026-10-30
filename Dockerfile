# syntax=docker/dockerfile:1.7

ARG ALPINE_VERSION=3.24
ARG NODE_PACKAGE_VERSION=26.5.1-r0
ARG OPENSSL_PACKAGE_VERSION=3.5.8-r0
ARG PNPM_VERSION=11.15.1

FROM alpine:${ALPINE_VERSION} AS tooling

ARG NODE_PACKAGE_VERSION
ARG OPENSSL_PACKAGE_VERSION
ARG PNPM_VERSION
RUN apk upgrade --no-cache \
    && apk add --no-cache \
        git \
        "libcrypto3=${OPENSSL_PACKAGE_VERSION}" \
        "libssl3=${OPENSSL_PACKAGE_VERSION}" \
        "nodejs-current=${NODE_PACKAGE_VERSION}" \
        npm \
    && npm install --global "pnpm@${PNPM_VERSION}" \
    && npm cache clean --force
WORKDIR /usr/src/app

FROM tooling AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM tooling AS build

COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY . .
RUN pnpm lint \
    && pnpm test --runInBand \
    && pnpm build

FROM tooling AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM alpine:${ALPINE_VERSION} AS production

ARG NODE_PACKAGE_VERSION
ARG OPENSSL_PACKAGE_VERSION
RUN apk upgrade --no-cache \
    && apk add --no-cache \
        "libcrypto3=${OPENSSL_PACKAGE_VERSION}" \
        "libssl3=${OPENSSL_PACKAGE_VERSION}" \
        "nodejs-current=${NODE_PACKAGE_VERSION}" \
    && addgroup -S node \
    && adduser -S -G node node
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

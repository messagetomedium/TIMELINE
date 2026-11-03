# syntax=docker/dockerfile:1
FROM node:24.19.0-trixie-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --strict-ssl=true

FROM dependencies AS build
COPY . .
RUN npm run build && npm run server:build

FROM node:24.19.0-trixie-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --omit=optional --strict-ssl=true && npm cache clean --force

FROM node:24.19.0-trixie-slim AS runtime
WORKDIR /app
# Standard PostgreSQL tools let an authorized one-off operator use this same image.
RUN --mount=type=secret,id=system_ca \
    if [ -f /run/secrets/system_ca ]; then export APT_CA_OPTION='Acquire::https::CaInfo=/run/secrets/system_ca'; else export APT_CA_OPTION='Acquire::https::Verify-Peer=true'; fi; \
    apt-get -o "$APT_CA_OPTION" update && \
    apt-get -o "$APT_CA_OPTION" install -y --no-install-recommends ca-certificates postgresql-client-17 && \
    rm -rf /var/lib/apt/lists/*
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/build/server ./build/server
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/server/db/migrations ./server/db/migrations
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 STATIC_ROOT=/app/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "build/server/main.js"]

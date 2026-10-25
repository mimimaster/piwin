# syntax=docker/dockerfile:1
#
# piwin relay (ADR 0101). Build from the repository root:
#
#   docker build -f apps/gateway/Dockerfile -t piwin-gateway .
#
# Only contracts, host-transport and the gateway enter the build context
# (see Dockerfile.dockerignore). The relay speaks plain ws:// on 7466; put a
# TLS reverse proxy in front of it (docs/guides/remote-relay.md).

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @piwin/gateway... \
 && pnpm --filter @piwin/gateway bundle

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /repo/apps/gateway/dist/piwin-gateway.mjs ./piwin-gateway.mjs
RUN mkdir -p /data && chown node:node /data
ENV PIWIN_RELAY_USERS=/data/users.json \
    PORT=7466 \
    NODE_ENV=production
VOLUME ["/data"]
EXPOSE 7466
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "/app/piwin-gateway.mjs"]
CMD ["serve", "--host", "0.0.0.0"]

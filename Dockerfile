# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
RUN npm run build && npm run build:web

FROM node:20-bookworm-slim AS runtime
ARG CODEX_VERSION=0.144.4
ENV NODE_ENV=production \
    DC_COLLEAGUE_DIR=/opt/dcolleague/colleague \
    DC_MEMORY_DIR=/var/lib/dcolleague/memory \
    DC_AGENT_RUNTIME=echo \
    DC_PORT=8787
WORKDIR /opt/dcolleague
RUN groupadd --gid 10001 dcolleague \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/dcolleague dcolleague \
    && mkdir -p /var/lib/dcolleague/memory /home/dcolleague/.codex \
    && npm install --global "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /workspace/dist ./dist
COPY --from=build /workspace/dist-web ./dist-web
COPY deploy/docker ./deploy/docker
RUN chmod 0555 deploy/docker/entrypoint.sh \
    && chown -R dcolleague:dcolleague /opt/dcolleague /home/dcolleague /var/lib/dcolleague
USER 10001:10001
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "/opt/dcolleague/deploy/docker/healthcheck.mjs"]
ENTRYPOINT ["/opt/dcolleague/deploy/docker/entrypoint.sh"]

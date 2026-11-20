# syntax=docker/dockerfile:1
# Margin review hub. Build from the browser-review/ folder:
#   docker build -f hub/Dockerfile -t margin-hub .

FROM node:26-alpine AS build
WORKDIR /src
# The pnpm version from "packageManager" in package.json (Node 26 has no corepack).
RUN npm install -g pnpm@12.9.1 --no-fund --no-audit
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json LICENSE ./
COPY shared/package.json shared/
COPY hub/package.json hub/
RUN pnpm install --frozen-lockfile --filter "@brm/hub..." --ignore-scripts
COPY shared/ shared/
COPY hub/ hub/
RUN pnpm --dir hub build

FROM node:26-alpine
ENV NODE_ENV=production \
    MARGIN_DATA=/data/.margin \
    PORT=4780
WORKDIR /app
COPY --from=build /src/hub/dist/ ./
# `margin token add ...` inside the container; the data folder belongs to the unprivileged node user.
RUN ln -s /app/hub.js /usr/local/bin/margin \
 && mkdir -p /data/.margin \
 && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 4780
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["node", "/app/hub.js", "serve"]

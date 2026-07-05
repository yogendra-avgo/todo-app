# --- Stage 1: Build & Dependencies ---
FROM harbor.mgmt.vks.lab/docker.io/library/node:18-alpine AS builder
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org/
COPY package.json ./

RUN npm config set registry ${NPM_REGISTRY} && \
    npm install && \
    npm cache clean --force

COPY server.js ./

# --- Stage 2: Minimal Runtime ---
FROM harbor.mgmt.vks.lab/docker.io/library/node:18-alpine
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js

EXPOSE 3000
CMD ["node", "server.js"]
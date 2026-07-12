# --- Stage 1: Build & Dependencies ---
FROM node:18-alpine AS builder
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org/
COPY package.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm config set registry ${NPM_REGISTRY} && \
    npm install

COPY server.js metrics.js ./
COPY static ./static

# --- Stage 2: Minimal Runtime ---
FROM node:18-alpine
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js /app/metrics.js ./
COPY --from=builder /app/static ./static

EXPOSE 3000
CMD ["node", "server.js"]
# AccrediHub — single container, zero npm dependencies (Node's built-in SQLite).
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY lib ./lib
COPY api ./api
COPY migrations ./migrations
COPY public ./public

# Database, uploads and generated secrets all live here — mount a volume on it.
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]

FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json npm-shrinkwrap.json Makefile ./
RUN apt-get update && apt-get install -y --no-install-recommends make ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY data ./data
COPY fixtures ./fixtures
RUN mkdir -p /app/runtime && chown node:node /app/runtime
ENV HOST=0.0.0.0 ALLOW_REMOTE=1 PORT=3000 DATA_DIR=/data RUNTIME_DIR=/app/runtime MODEL_DIR=/models/e5 INDEX_DIR=/app/runtime/indexes
EXPOSE 3000
USER node
CMD ["node", "src/server.mjs"]

# Personal Tracker — one container that serves both the API and the web app.
#   docker build -t personal-tracker .
#   docker run -p 4000:4000 --env-file .env -e NODE_ENV=production personal-tracker

# ---- 1. Build: compile the server and bundle the client ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY client/package.json client/
# "npm ci" needs the lock file to match exactly; fall back to a normal install if it doesn't
RUN npm ci --include=dev || npm install --include=dev
COPY . .
RUN npm run build

# ---- 2. Production dependencies only (server workspace) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY client/package.json client/
RUN (npm ci --omit=dev --workspace server || npm install --omit=dev --workspace server) && npm cache clean --force

# ---- 3. Run ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/package.json ./package.json
COPY --chown=node:node server/package.json server/
COPY --from=build --chown=node:node /app/server/dist server/dist
COPY --from=build --chown=node:node /app/client/dist client/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/server
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

# IncidentFlow application image
FROM node:20-alpine

ENV NODE_ENV=production DATA_FILE=/data/incidentflow.json PORT=3000
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
    && mkdir -p /data && chown node:node /data

COPY app.js server.js ./
COPY src ./src
COPY public ./public

USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]

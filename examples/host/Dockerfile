# Lives in the backend repo (e.g. docker/releases/Dockerfile, build context = repo root).
# Coolify: build from this Dockerfile, mount a persistent volume at /data,
# set RELEASES_SECRET, PUBLIC_URL, FRAME_ANCESTORS, domain releases.personizely.net.
FROM node:22-alpine

ARG RELEASES_VERSION=0.4.0
RUN npm install -g @personizely/releases@${RELEASES_VERSION} && npm cache clean --force

WORKDIR /app
COPY releases.config.json ./
COPY releases ./releases
# Icons the config reuses from the app, at the same relative paths
COPY public/favicon.ico ./public/favicon.ico
COPY public/img/apple-touch-icon.png ./public/img/apple-touch-icon.png

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
USER node
CMD ["releases", "serve"]

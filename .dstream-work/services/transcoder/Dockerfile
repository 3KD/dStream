FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/transcoder/index.mjs services/transcoder/policy.mjs /app/transcoder/
COPY services/media-auth.mjs /app/media-auth.mjs

CMD ["node", "/app/transcoder/index.mjs"]

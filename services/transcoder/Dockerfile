FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/transcoder/index.mjs /app/services/transcoder/index.mjs

CMD ["node", "/app/services/transcoder/index.mjs"]

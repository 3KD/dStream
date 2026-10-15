FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY services/manifest/package.json services/manifest/package-lock.json ./
RUN npm ci --omit=dev

COPY services/manifest/index.mjs ./manifest/index.mjs
COPY services/media-auth.mjs ./media-auth.mjs

CMD ["node", "/app/manifest/index.mjs"]

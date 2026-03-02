# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public config (inlined into the client bundle at build time)
ARG NEXT_PUBLIC_NOSTR_RELAYS
ARG NEXT_PUBLIC_HLS_ORIGIN
ARG NEXT_PUBLIC_WEBRTC_ICE_SERVERS
ENV NEXT_PUBLIC_NOSTR_RELAYS=$NEXT_PUBLIC_NOSTR_RELAYS
ENV NEXT_PUBLIC_HLS_ORIGIN=$NEXT_PUBLIC_HLS_ORIGIN
ENV NEXT_PUBLIC_WEBRTC_ICE_SERVERS=$NEXT_PUBLIC_WEBRTC_ICE_SERVERS

RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app /app

EXPOSE 5656
CMD ["npm", "--workspace", "web", "run", "start"]

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
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/protocol ./packages/protocol

# Public config (inlined into the client bundle at build time)
ARG NEXT_PUBLIC_NOSTR_RELAYS
ARG NEXT_PUBLIC_HLS_ORIGIN
ARG NEXT_PUBLIC_WEBRTC_ICE_SERVERS
ARG NEXT_PUBLIC_SUPPORT_XMR_ADDRESS
ARG NEXT_PUBLIC_SUPPORT_BTC_ADDRESS
ARG NEXT_PUBLIC_SUPPORT_BTC_LIGHTNING
ARG NEXT_PUBLIC_SUPPORT_ETH_ADDRESS
ARG NEXT_PUBLIC_SUPPORT_TRX_ADDRESS
ENV NEXT_PUBLIC_NOSTR_RELAYS=$NEXT_PUBLIC_NOSTR_RELAYS
ENV NEXT_PUBLIC_HLS_ORIGIN=$NEXT_PUBLIC_HLS_ORIGIN
ENV NEXT_PUBLIC_WEBRTC_ICE_SERVERS=$NEXT_PUBLIC_WEBRTC_ICE_SERVERS
ENV NEXT_PUBLIC_SUPPORT_XMR_ADDRESS=$NEXT_PUBLIC_SUPPORT_XMR_ADDRESS
ENV NEXT_PUBLIC_SUPPORT_BTC_ADDRESS=$NEXT_PUBLIC_SUPPORT_BTC_ADDRESS
ENV NEXT_PUBLIC_SUPPORT_BTC_LIGHTNING=$NEXT_PUBLIC_SUPPORT_BTC_LIGHTNING
ENV NEXT_PUBLIC_SUPPORT_ETH_ADDRESS=$NEXT_PUBLIC_SUPPORT_ETH_ADDRESS
ENV NEXT_PUBLIC_SUPPORT_TRX_ADDRESS=$NEXT_PUBLIC_SUPPORT_TRX_ADDRESS

RUN if [ ! -d "apps/web/.next" ]; then npx turbo run build --filter=web; else echo "Skipping build, apps/web/.next exists"; fi

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app /app

EXPOSE 5656
CMD ["npm", "--workspace", "web", "run", "start"]

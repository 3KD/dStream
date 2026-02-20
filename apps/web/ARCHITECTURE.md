# dStream Architecture

## Directory Structure

```
apps/web/
├── app/                    # Next.js App Router pages
│   ├── layout.tsx          # Root layout with Providers
│   ├── page.tsx            # Homepage
│   ├── broadcast/          # Broadcast page
│   └── watch/[channel]/    # Watch page (dynamic route)
│
├── src/
│   ├── lib/                # Core libraries (no React)
│   │   ├── types.ts        # Type definitions
│   │   ├── config.ts       # App configuration
│   │   ├── nostr.ts        # Nostr relay communication
│   │   └── whip.ts         # WebRTC WHIP client
│   │
│   ├── hooks/              # React hooks
│   │   ├── useCamera.ts    # Camera/mic access
│   │   └── useChat.ts      # Chat subscription
│   │
│   └── context/            # React contexts
│       ├── IdentityContext.tsx   # User identity (Nostr keys)
│       ├── BroadcastContext.tsx  # Broadcast state
│       └── Providers.tsx         # Combined providers
│
└── components/             # UI components (to be added)
```

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                        UI Layer                          │
│  (pages, components)                                     │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                      Hooks Layer                         │
│  useCamera, useChat, useBroadcast                       │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                    Context Layer                         │
│  IdentityContext, BroadcastContext                      │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                    Service Layer                         │
│  lib/nostr.ts, lib/whip.ts                              │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                   External Services                      │
│  Nostr Relays, MediaMTX                                 │
└─────────────────────────────────────────────────────────┘
```

## Core Types

See `src/lib/types.ts` for:
- `Identity` - Nostr keypair
- `Stream` - Stream metadata
- `BroadcastSession` - Active broadcast state
- `ChatMessage` - Chat messages
- `NOSTR_KINDS` - Nostr event kinds

## Configuration

All configuration in `src/lib/config.ts`:
- `PORTS` - App and MediaMTX ports
- `RELAYS` - Nostr relay URLs
- `MEDIA_CONFIG` - WHIP/HLS endpoints

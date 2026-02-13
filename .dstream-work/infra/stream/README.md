# Local streaming stack (MediaMTX)

This stack provides local WHIP ingest + HLS output for development.

## Run

```bash
docker compose up -d
```

## Ports

- WHIP/WebRTC: `8889`
- HLS/HTTP: `8888` (mapped from MediaMTX `8880`)
- Local Nostr relay: `8081`


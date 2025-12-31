# dStream Production Deployment Guide

## Domain
**Primary Domain**: `dstream.stream`
**DNS Records**:
- `A` record -> `<Your VPS IP>`
- `CNAME` www -> `dstream.stream`

## Infrastructure
The stack consists of 3 services orchestrated by Docker Compose:
1.  **dStream_web**: Next.js App (Port 3000)
2.  **dStream_ingest**: MediaMTX (RTMP/WebRTC/HLS)
3.  **Caddy**: Reverse Proxy (SSL Termination)

## Deployment Steps

### Step 0: Buy a Server (VPS)
We recommend **DigitalOcean** for simplicity.
1.  **Sign Up** at digitalocean.com.
2.  Click **Create -> Droplets**.
3.  **Region**: Choose the city closest to you.
4.  **Image**: Select **Ubuntu 24.04** (LTS).
5.  **Size**: Choose **Basic -> Regular -> $6/mo** (1GB RAM is enough for starting).
6.  **Authentication**: Choose **Password** (Create a strong root password).
7.  Click **Create Droplet**.
8.  Wait 30 seconds, then copy the **ipv4 Address** shown next to your new server.

### Step 1: Provision Server
Use `setup_vps.sh` (if available) or ensuring Docker & Docker Compose are installed.

### 2. DNS
Point `dstream.stream` to your VPS IP address.

### 3. Deploy Stack
Run the production compose file:

```bash
cd infra/stream
docker-compose -f docker-compose.prod.yml up -d
```

### 4. SSL (Automatic)
We use Caddy for automatic HTTPS.
1. Download Caddy binary or run it via Docker (Recommended).
2. Place `Caddyfile` in `/etc/caddy/Caddyfile`.
3. Start Caddy.

*Alternative: If using Docker Caddy:*
Add Caddy to `docker-compose.prod.yml`:

```yaml
  caddy:
    image: caddy:latest
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ../../infra/prod/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - web
      - mediamtx
```

## Maintenance
- **Logs**: `docker-compose -f docker-compose.prod.yml logs -f`
- **Update**: `git pull && docker-compose -f docker-compose.prod.yml build && docker-compose -f docker-compose.prod.yml up -d`

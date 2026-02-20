#!/bin/bash
set -e

echo "🛑 Stopping all dStream containers..."
# Kill both Prod and Dev containers to ensure no conflicts
docker rm -f dStream_ingest dStream_stream_prod dStream_web dStream_manifest dStream_relay dStream_monero 2>/dev/null || true

echo "🧹 Cleaning up Proxy..."
pkill -f "node scripts/proxy.js" || true
pkill -f "node apps/web/scripts/proxy.js" || true

echo "🚀 Starting Dev Stream Backend (MediaMTX)..."
# Use the STREAM compose file (which has port 8889 exposed)
docker-compose -f infra/stream/docker-compose.yml up -d mediamtx

echo "⏳ Waiting for MediaMTX to initialize..."
sleep 3

echo "📡 Starting Proxy Server (Port 5656 -> 8889)..."
# Ensure we run from the correct directory or path
PROJECT_ROOT=$(pwd)
if [ -f "apps/web/scripts/proxy.js" ]; then
    nohup node apps/web/scripts/proxy.js > /var/tmp/proxy.log 2>&1 &
elif [ -f "scripts/proxy.js" ]; then
    nohup node scripts/proxy.js > /var/tmp/proxy.log 2>&1 &
else
    echo "❌ Could not find proxy.js! Please run this script from project root."
    exit 1
fi

echo "✅ Dev Stream Environment Reset!"
echo "👉 1. Refresh your browser at https://localhost:5656"
echo "👉 2. Click 'Use Test Signal'"
echo "👉 3. Click 'Go Live'"

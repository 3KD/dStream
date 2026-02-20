#!/bin/bash

echo "🧹 Cleaning up DStream Dev Environment..."

# 1. Kill Specific Ports
PORTS=(5655 5656 5657)
for PORT in "${PORTS[@]}"; do
    PID=$(lsof -t -i:$PORT)
    if [ -n "$PID" ]; then
        echo "   Killing process on port $PORT (PID: $PID)..."
        kill -9 $PID
    fi
done

# 2. Kill by Name (Backup)
pkill -f "next-server"
pkill -f "scripts/proxy.js"

# 3. Wait for clearance
echo "⏳ Waiting for ports to clear..."
sleep 2

# 3b. Ensure Infra (MediaMTX) is running
echo "🐳 Checking Infrastructure..."

# Check if Docker Daemon is responding
if ! docker info >/dev/null 2>&1; then
    echo "⚠️  Docker daemon is not running. Starting Docker Desktop..."
    open -a Docker
    echo "⏳ Waiting for Docker to start..."
    
    # Wait loop
    count=0
    while ! docker info >/dev/null 2>&1; do
        sleep 2
        echo -n "."
        count=$((count+1))
        if [ $count -ge 30 ]; then
            echo "❌ Docker failed to start."
            exit 1
        fi
    done
    echo " ✅ Online!"
fi

# Check relative to where this script is run (apps/web-legacy)
if ! docker compose -f ../../infra/stream/docker-compose.yml ps | grep -q "mediamtx"; then
    echo "   Starting MediaMTX & Relay..."
    docker compose -f ../../infra/stream/docker-compose.yml up -d mediamtx relay
fi

# 4. Final verification
STILL_RUNNING=$(lsof -t -i:5656)
if [ -n "$STILL_RUNNING" ]; then
    echo "❌ ERROR: Port 5656 is still occupied by PID $STILL_RUNNING. Manual intervention required."
    exit 1
else
    echo "✅ Ports cleared. Starting Server..."
    npm run dev:internal
fi

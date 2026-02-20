#!/bin/bash

# clean-restart.sh
# Cleanly restarts ONLY the dStream project infrastructure.
# Does NOT touch other Docker containers on the system.

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔄 dStream Clean Restart Initiated...${NC}"

# 1. Kill processes on dStream-specific ports
# 3001 (Manifest), 8081 (Relay), 8888 (HLS), 8889 (WebRTC), 9990 (API), 1935 (RTMP)
PORTS=(3001 8081 8888 8889 9990 1935)

echo -e "${BLUE}🔪 Cleaning up stale processes on ports: ${PORTS[*]}...${NC}"

for PORT in "${PORTS[@]}"; do
    PID=$(lsof -t -i:$PORT)
    if [ -n "$PID" ]; then
        echo -e "${RED}   Killing PID $PID on port $PORT${NC}"
        kill -9 $PID 2>/dev/null
    fi
done

# 2. Stop ONLY dStream containers
echo -e "${BLUE}🛑 Stopping dStream containers...${NC}"
docker compose -f infra/stream/docker-compose.yml down

# 3. Start dStream containers (With Build)
echo -e "${BLUE}🏗️  Rebuilding and Starting dStream...${NC}"
docker compose -f infra/stream/docker-compose.yml up -d --build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ dStream Infrastructure Restarted Successfully!${NC}"
    echo -e "   - MediaMTX: localhost:8888 (HLS), localhost:8889 (WHIP)"
    echo -e "   - Relay: localhost:8081"
    echo -e "   - Manifest: localhost:3001"
else
    echo -e "${RED}❌ Docker Start Failed! Check logs.${NC}"
    exit 1
fi

#!/bin/bash

# restart-all.sh
# Hard Reset for dStream Development Environment

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔄 dStream Hard Reset Initiated...${NC}"

# 1. Kill Stale Processes
echo -e "${BLUE}🔪 Killing stale processes on known ports...${NC}"
PORTS=(4747 5655 8888 8889 9990)

for PORT in "${PORTS[@]}"; do
    PID=$(lsof -t -i:$PORT)
    if [ -n "$PID" ]; then
        echo -e "${RED}   Killing process on port $PORT (PID: $PID)${NC}"
        kill -9 $PID 2>/dev/null
    else
        echo -e "${GREEN}   Port $PORT is clear.${NC}"
    fi
done

# 2. Reset Docker
echo -e "${BLUE}🐳 Checking Docker Status...${NC}"

# Function to wait for Docker
wait_for_docker() {
    echo -n "Waiting for Docker daemon..."
    local count=0
    while ! docker info >/dev/null 2>&1; do
        sleep 2
        echo -n "."
        count=$((count+1))
        if [ $count -ge 30 ]; then
            echo -e "\n${RED}❌ Docker failed to start after 60 seconds.${NC}"
            exit 1
        fi
    done
    echo -e " ${GREEN}Online!${NC}"
}

if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}⚠️  Docker daemon is not responding.${NC}"
    echo -e "${BLUE}🚑 Attempting to restart Docker Desktop automatically...${NC}"
    
    # Gracefully quit Docker
    osascript -e 'quit app "Docker"' 2>/dev/null
    
    # Force kill if still running after a moment
    sleep 3
    pkill -f "Docker Desktop" 2>/dev/null
    
    # Start Docker
    echo -e "${BLUE}🚀 Launching Docker Desktop...${NC}"
    open -a Docker
    
    wait_for_docker
fi

echo -e "${BLUE}🧹 Pruning Containers and Networks...${NC}"
docker compose -f infra/stream/docker-compose.yml down --remove-orphans 2>/dev/null
docker network prune -f >/dev/null 2>&1

echo -e "${BLUE}🏗️  Starting Infrastructure...${NC}"
docker compose -f infra/stream/docker-compose.yml up -d mediamtx relay

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Infrastructure Started!${NC}"
else
    echo -e "${RED}❌ Docker Start Failed!${NC}"
    exit 1
fi

# 3. Start Legacy App
echo -e "${BLUE}💻 Starting Legacy App (Port 5655)...${NC}"
echo -e "${GREEN}Environment is ready. Starting web server...${NC}"

cd apps/web-legacy
npm run dev

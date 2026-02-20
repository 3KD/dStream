#!/bin/bash

# start-web.sh - Startup for NEW dStream Web App (apps/web)

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting dStream 'apps/web' Environment...${NC}"

# Ensure we are in the project root
if [ ! -f "infra/stream/docker-compose.yml" ]; then
    echo -e "${RED}Error: Please run this script from the project root.${NC}"
    exit 1
fi

# 1. Check for Docker
# 1. Docker Check (Skipped as per user confirmation)
# if ! docker info > /dev/null 2>&1; then
#   echo -e "${RED}Error: Docker is not running.${NC}"
#   echo "Please start Docker Desktop and try again."
#   # exit 1
# fi
echo -e "${GREEN}Assuming Docker is running...${NC}"

# 2. Check for Process on Port 5656 (Next.js)
if lsof -i:5656 -t >/dev/null; then
    echo -e "${RED}WARNING: Something is running on Port 5656 (Next.js). Terminating it...${NC}"
    lsof -i:5656 -t | xargs kill -9
fi

# 3. Start Infrastructure (MediaMTX, Relay)
echo -e "${BLUE}📦 Starting Infrastructure...${NC}"
# Exclude 'web' service from docker-compose as we run it locally
docker compose -f infra/stream/docker-compose.yml up -d mediamtx relay manifest

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to start Docker containers.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Infrastructure is running!${NC}"

# 4. Cleanup Function
cleanup() {
    echo -e "\n${BLUE}🛑 Shutting down environment...${NC}"
    # Optional: Stop infra on exit? Usually better to keep it running for dev speed, 
    # but strictly speaking should clean up. Let's keep it running for now or ask user.
    # For now, we leave infra running.
    echo -e "${GREEN}👋 App stopped. Infrastructure left running (use 'docker compose stop' to halt).${NC}"
    exit 0
}

# Trap Ctrl+C (SIGINT)
trap cleanup SIGINT

# 5. Start Frontend
echo -e "${BLUE}💻 Starting Web Client (apps/web)...${NC}"
echo -e "   - ${GREEN}HTTPS: https://localhost:5656${NC}"
echo "Press Ctrl+C to stop app."

cd apps/web && npm run dev

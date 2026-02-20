#!/bin/bash

# start-dev.sh - Single command startup for dStream development

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting dStream Development Environment...${NC}"

# Ensure we are in the project root
cd /Users/erik/Projects/JRNY

# 0. Port Safety Check (User Requirement: NEVER allow 3000 or 3001)
# Checks if the user is trying to run on bounded ports or defaults
if [[ "$*" == *"-p 3000"* ]] || [[ "$*" == *"-p 3001"* ]]; then
    echo -e "${RED}ERROR: PORTS 3000 AND 3001 ARE FORBIDDEN.${NC}"
    echo "Please use Port 5655."
    exit 1
fi

# Also check if anything is running on 3000 just in case
if lsof -i:3000 -t >/dev/null; then
    echo -e "${RED}WARNING: Something is running on Port 3000. Terminating it to prevent confusion...${NC}"
    lsof -i:3000 -t | xargs kill -9
fi


# 1. Check for Docker
if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}Error: Docker is not running.${NC}"
  echo "Please start Docker Desktop and try again."
  exit 1
fi

# 2. Start Infrastructure (Docker Compose)
echo -e "${BLUE}📦 Starting Infrastructure (Relay, Media Server, Manifest Service)...${NC}"
# We only want mediamtx, relay, and manifest. We run 'web' locally.
docker compose -f infra/stream/docker-compose.yml up -d mediamtx relay manifest

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to start Docker containers.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Infrastructure is running!${NC}"

# 3. Cleanup Function
cleanup() {
    echo -e "\n${BLUE}🛑 Shutting down environment...${NC}"
    docker compose -f infra/stream/docker-compose.yml stop mediamtx relay manifest
    echo -e "${GREEN}👋 Bye!${NC}"
    exit 0
}

# Trap Ctrl+C (SIGINT)
trap cleanup SIGINT

# 4. Start Frontend
echo -e "${BLUE}💻 Starting Web Client (apps/web-legacy)...${NC}"
echo -e "   - ${GREEN}HTTPS: https://localhost:5656 (Recommended)${NC}"
echo -e "   - HTTP:  http://localhost:5655"
echo "Press Ctrl+C to stop everything."

# Run legacy app
cd apps/web-legacy && npm run dev

# Alternatively, if turbo name is different, try:
# cd apps/web && npm run dev

# Call cleanup if the frontend process exits
cleanup

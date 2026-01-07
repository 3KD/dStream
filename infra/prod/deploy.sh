#!/bin/bash
# dStream Push-to-Deploy Script
# Usage: ./deploy.sh [user@ip]
# Example: ./deploy.sh root@123.456.78.90

TARGET=$1

if [ -z "$TARGET" ]; then
    echo "Usage: ./deploy.sh [user@ip]"
    exit 1
fi

echo "🚀 Deploying dStream to $TARGET..."

# 1. Create directory
echo "🔹 Creating remote directory..."
ssh $TARGET "mkdir -p /opt/dstream"

# 2. Sync Files (With Exclusions)
echo "🔹 Syncing project files..."
cd "$(dirname "$0")/../.."  # Go to project root

rsync -avz --progress --relative --delete \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude '.git' \
    --exclude 'tmp' \
    apps \
    infra \
    docs \
    services \
    package.json \
    package-lock.json \
    tsconfig.json \
    $TARGET:/opt/dstream/

# Restore working directory just in case
cd - > /dev/null

# 3. Remote Build & Launch
echo "🔹 Building and Launching on Remote..."
# Assuming dstream.stream is the intended domain, though we could pass it as arg
DOMAIN="dstream.stream"

ssh $TARGET "cd /opt/dstream && \
    export DOMAIN=$DOMAIN && \
    docker compose -f infra/prod/docker-compose.prod.yml build && \
    docker compose -f infra/prod/docker-compose.prod.yml up -d --remove-orphans && \
    docker system prune -f"

echo "✅ Deployment Complete!"
echo "👉 Check status: ssh $TARGET 'docker compose -f /opt/dstream/infra/prod/docker-compose.prod.yml ps'"
echo "👉 Logs: ssh $TARGET 'docker compose -f /opt/dstream/infra/prod/docker-compose.prod.yml logs -f'"

#!/usr/bin/env bash
set -e

SSH_TARGET=$1
if [ -z "$SSH_TARGET" ]; then
  echo "========================================="
  echo "❌ Error: Missing SSH Target."
  echo "Usage: ./infra/prod/deploy.sh user@host_ip"
  echo "Example: ./infra/prod/deploy.sh root@123.45.67.89"
  echo "========================================="
  exit 1
fi

REMOTE_DIR=${DSTREAM_DEPLOY_PROJECT_DIR:-"/opt/dstream"}
LOCAL_DIR=$(cd "$(dirname "$0")/../.." && pwd)

echo "========================================="
echo "🚀 Deploying dStream Node"
echo "From: ${LOCAL_DIR}"
echo "To:   ${SSH_TARGET}:${REMOTE_DIR}"
echo "========================================="

# 1. Ensure remote directory exists
echo "📁 Preparing remote directory..."
ssh "$SSH_TARGET" "mkdir -p ${REMOTE_DIR}"

# 2. Rsync codebase (with strict exclusions to prevent overwriting production data)
echo "☁️  Uploading node architecture via rsync..."
rsync -avz --delete \
  --exclude="node_modules/" \
  --exclude="apps/web/.next/" \
  --exclude=".env" \
  --exclude=".env.production" \
  --exclude="relay_data/" \
  --exclude="xmr_wallet_data/" \
  --exclude="hls/" \
  --exclude="recordings/" \
  --exclude=".git/" \
  --exclude=".DS_Store" \
  "$LOCAL_DIR/" "$SSH_TARGET:$REMOTE_DIR/"

# 3. Boot the remote containers natively
echo "🐳 Rebuilding and booting remote Docker infrastructure..."
ssh "$SSH_TARGET" "cd ${REMOTE_DIR} && docker compose -f docker-compose.yml up -d --build --remove-orphans"

echo "========================================="
echo "✅ DEPLOYMENT SUCCESSFUL!"
echo "Your peer-to-peer Node is now actively routing!"
echo "========================================="

#!/bin/bash
# dStream Production Deploy Script

DOM=$1
EMAIL=$2
PASS=$3

if [ -z "$DOM" ] || [ -z "$EMAIL" ] || [ -z "$PASS" ]; then
    echo "Usage: ./deploy.sh <DOMAIN> <ADMIN_EMAIL> <PUBLISH_PASSWORD>"
    echo "Example: ./deploy.sh dstream.example.com admin@example.com supersecret"
    exit 1
fi

echo "Deploying dStream to $DOM..."

# Set Env Vars
export DOMAIN=$DOM
export ACME_EMAIL=$EMAIL
export PUBLISH_PASSWORD=$PASS

# Generate Manifest Private Key (if not already set)
# This key signs the HLS manifests to prevent modification.
if [ -z "$MANIFEST_PRIVATE_KEY" ]; then
    echo "🔑 Generating ephemeral Manifest Signing Key..."
    export MANIFEST_PRIVATE_KEY=$(openssl rand -hex 32)
fi

# Create docker network if missing
docker network create web_net 2>/dev/null || true

# Pull latest images
docker-compose -f docker-compose.prod.yml pull

# Start Stack
docker-compose -f docker-compose.prod.yml up -d --remove-orphans

echo "Deployment Complete. Access at https://$DOM"

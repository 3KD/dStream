#!/bin/bash
# dStream VPS Provisioning Script (Ubuntu 20.04/22.04)
# Run this on your fresh VPS as root.

set -e

echo "🔹 Updating System..."
apt-get update && apt-get upgrade -y

echo "🔹 Installing Dependencies..."
apt-get install -y apt-transport-https ca-certificates curl software-properties-common git ufw

echo "🔹 Installing Docker..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "🔹 Installing Docker Compose (Standalone if needed)..."
# Check if docker compose command works, else install standalone
if ! docker compose version &> /dev/null; then
    curl -SL https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose
fi

echo "🔹 Configuring Firewall (UFW)..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 1935/tcp  # RTMP
ufw --force enable

echo "✅ Server Provisioned! Ready for dStream deployment."
echo "👉 Next: Copy your project files and run ./infra/prod/deploy.sh"

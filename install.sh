#!/bin/bash

# POLY-SHORE Premium Installer
set -e

echo "--- POLY-SHORE Deployment Utility ---"

# 1. Check dependencies
check_dep() {
    if ! command -v $1 &> /dev/null; then
        echo "Error: $1 not installed."
        exit 1
    fi
}

check_dep node
check_dep pnpm
check_dep pm2

# 2. Setup Environment
if [ ! -f .env ]; then
    echo "Creating .env from example..."
    cp .env.example .env
    echo "PLEASE EDIT THE .env FILE WITH YOUR API KEYS."
fi

# 3. Install & Build
echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Building production artifacts..."
pnpm build

# 4. Initialize Database
echo "Running database migrations..."
pnpm db:push

# 5. Setup PM2
echo "Configuring PM2..."
cat <<PM2EOF > ecosystem.config.js
module.exports = {
  apps: [{
    name: "poly-shore-engine",
    script: "dist/index.js",
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: "production"
    }
  }]
}
PM2EOF

echo "--- Installation Complete ---"
echo "To start the system: pm2 start ecosystem.config.js"

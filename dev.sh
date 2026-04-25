#!/usr/bin/env bash
set -e

# Install dependencies
pnpm install

# Start DB (OrbStack / Docker)
docker-compose up db -d

# Wait for Postgres to be ready
echo "Waiting for database..."
until docker-compose exec -T db pg_isready -U postgres &>/dev/null; do
  sleep 1
done

# Push schema
pnpm db:push

# Start dev server
pnpm dev

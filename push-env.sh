#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env.dev"

while IFS= read -r line; do
  # skip comments and blank lines
  [[ "$line" =~ ^# ]] && continue
  [[ -z "$line" ]] && continue

  key="${line%%=*}"
  value="${line#*=}"

  echo "Adding $key..."
  printf '%s' "$value" | pnpm dlx vercel env add "$key" production --force
done < "$ENV_FILE"

echo "Done. All env vars pushed to Vercel production."

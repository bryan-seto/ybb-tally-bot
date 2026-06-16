#!/usr/bin/env bash
#
# Build and (re)run the YBB Tally Bot container on a host (e.g. Oracle Cloud
# Always Free VM). Long-polling mode: no public endpoint required.
#
# Prerequisites on the host:
#   - Docker installed and running
#   - An env file at /opt/ybb-tally-bot/env.production with the bot's secrets
#     (see .env.example for the full required set). For long polling, leave
#     WEBHOOK_URL blank/unset.
#
# Usage:
#   bash deploy/oracle/run.sh
#
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/ybb-tally-bot/env.production}"
IMAGE_TAG="${IMAGE_TAG:-ybb-tally-bot:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-ybb-tally-bot}"

# Move to the repo root (two levels up from this script).
cd "$(dirname "$0")/../.."

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Env file not found at: $ENV_FILE"
  echo "   Create it from .env.example and set your secrets, then re-run."
  exit 1
fi

echo "🔨 Building image $IMAGE_TAG ..."
docker build -t "$IMAGE_TAG" .

echo "🧹 Removing any existing container named $CONTAINER_NAME ..."
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "🚀 Starting container (restart=always) ..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart=always \
  --env-file "$ENV_FILE" \
  "$IMAGE_TAG"

echo "✅ Started. Following logs (Ctrl-C to stop watching; container keeps running):"
docker logs -f "$CONTAINER_NAME"

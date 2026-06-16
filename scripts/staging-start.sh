#!/usr/bin/env bash
# ============================================================
# YBB Tally Bot — Local Staging Runner
# Usage: source scripts/staging-start.sh
# Or run standalone: bash scripts/staging-start.sh
# ============================================================
# Prereqs:
#   1. colima start  (already running if container is up)
#   2. /tmp/ybb_staging.env exists with real TELEGRAM_BOT_TOKEN + GEMINI_API_KEY
# ============================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="/tmp/ybb_staging.env"

# ── 1. Check env file ──────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "❌  $ENV_FILE not found."
  echo "   Copy from: $REPO_DIR/scripts/staging-start.sh"
  echo "   Template:  /tmp/ybb_staging.env.template"
  exit 1
fi

# ── 2. Check for unfilled placeholders ────────────────────
if grep -q 'REPLACE_ME' "$ENV_FILE"; then
  echo "❌  $ENV_FILE still has REPLACE_ME placeholders."
  echo "   Fill in TELEGRAM_BOT_TOKEN and GEMINI_API_KEY first."
  exit 1
fi

# ── 3. Make sure Colima + container are up ────────────────
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'ybb-tally-db'; then
  echo "⚠️  ybb-tally-db container not running. Starting Colima…"
  colima start
  docker start ybb-tally-db 2>/dev/null || echo "  (container may auto-start with colima)"
fi

# ── 4. Export PATH (nvm node) ─────────────────────────────
export PATH="/Users/bryan.seto/.nvm/versions/node/v24.13.1/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

# ── 5. Load env ───────────────────────────────────────────
set -a
source "$ENV_FILE"
set +a

echo "✅  Env loaded from $ENV_FILE"
echo "🤖  Bot token: ${TELEGRAM_BOT_TOKEN:0:10}…"
echo "🗄️   DB: $DATABASE_URL"
echo ""
echo "🚀  Starting YBB Tally Bot in STAGING mode (long-polling)…"
echo "    Press Ctrl+C to stop."
echo ""

# ── 6. Run with tsx watch (hot-reload on file changes) ────
cd "$REPO_DIR"
node node_modules/.bin/tsx watch src/index.ts

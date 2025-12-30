#!/bin/bash
set -e  # Exit on error

echo "=========================================="
echo "  STAGING TO PRODUCTION ROLLBACK SCRIPT"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Ensure we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found. Please run this script from the project root.${NC}"
    exit 1
fi

# Step 0: Check current state
echo "=== STEP 0: Current State Analysis ==="
echo ""

# Ensure we're on staging branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "staging" ]; then
    echo -e "${YELLOW}Warning: Not on staging branch. Current branch: $CURRENT_BRANCH${NC}"
    read -p "Switch to staging branch? (yes/no): " switch_branch
    if [ "$switch_branch" == "yes" ]; then
        git checkout staging
    else
        echo "Aborting. Please switch to staging branch first."
        exit 1
    fi
fi

echo "Current branch: $(git rev-parse --abbrev-ref HEAD)"
echo ""

# Fetch latest
echo "Fetching latest from origin..."
git fetch origin
echo ""

# Show commits that will be lost
echo -e "${YELLOW}=== COMMITS THAT WILL BE LOST ===${NC}"
echo "Commits in staging that are NOT in production (main):"
echo ""

STAGING_COMMIT=$(git rev-parse origin/staging)
MAIN_COMMIT=$(git rev-parse origin/main)

if [ "$STAGING_COMMIT" = "$MAIN_COMMIT" ]; then
    echo -e "${GREEN}✓ Staging already matches production. Nothing to rollback.${NC}"
    exit 0
fi

git log --oneline origin/main..origin/staging
COMMITS_AHEAD=$(git rev-list --count origin/main..origin/staging)
echo ""
echo -e "${YELLOW}Total commits to be removed: $COMMITS_AHEAD${NC}"
echo ""

# Show files that will change
echo -e "${YELLOW}=== FILES THAT WILL CHANGE ===${NC}"
echo "Files that differ between staging and production:"
echo ""

git diff --stat origin/main origin/staging
FILE_COUNT=$(git diff --name-only origin/main origin/staging | wc -l | tr -d ' ')
echo ""
echo -e "${YELLOW}Total files that will change: $FILE_COUNT${NC}"
echo ""

# Show production commit info
echo "=== PRODUCTION TARGET ==="
echo "Production (main) commit:"
git log --oneline -1 origin/main
echo ""

# Final warning
echo -e "${RED}⚠️  WARNING: This will PERMANENTLY remove $COMMITS_AHEAD commits and change $FILE_COUNT files.${NC}"
echo ""
read -p "Continue with rollback? Type 'yes' to confirm: " confirm

if [ "$confirm" != "yes" ]; then
    echo "Rollback cancelled."
    exit 0
fi

echo ""
echo "=========================================="
echo "  EXECUTING ROLLBACK"
echo "=========================================="
echo ""

# Step 1: Create backup
echo -e "${GREEN}=== STEP 1: Creating Backup Branch ===${NC}"
BACKUP_BRANCH="backup-staging-$(date +%Y%m%d-%H%M%S)"
git checkout staging
git branch "$BACKUP_BRANCH"
echo -e "${GREEN}✓ Backup created: $BACKUP_BRANCH${NC}"
echo ""

# Step 2: Reset staging to match production
echo -e "${GREEN}=== STEP 2: Resetting Staging to Match Production ===${NC}"
git fetch origin
git reset --hard origin/main
echo -e "${GREEN}✓ Staging reset to production commit${NC}"
echo "Current commit:"
git log --oneline -1
echo ""

# Step 3: Verify parity
echo -e "${GREEN}=== STEP 3: Verifying Parity ===${NC}"
MAIN_COMMIT=$(git rev-parse origin/main)
STAGING_COMMIT=$(git rev-parse HEAD)

if [ "$MAIN_COMMIT" != "$STAGING_COMMIT" ]; then
    echo -e "${RED}✗ ERROR: Commit hashes don't match!${NC}"
    echo "Main:    $MAIN_COMMIT"
    echo "Staging: $STAGING_COMMIT"
    exit 1
fi

echo -e "${GREEN}✓ Commit hashes match: $STAGING_COMMIT${NC}"

# Check file differences
DIFF_FILES=$(git diff --name-only origin/main HEAD)
if [ -n "$DIFF_FILES" ]; then
    echo -e "${RED}✗ ERROR: Files still differ:${NC}"
    echo "$DIFF_FILES"
    exit 1
fi

echo -e "${GREEN}✓ No file differences${NC}"
echo ""

# Step 4: Clean build verification
echo -e "${GREEN}=== STEP 4: Clean Build Verification ===${NC}"

# Remove node_modules
echo "Cleaning environment..."
if [ -d "node_modules" ]; then
    rm -rf node_modules
    echo -e "${GREEN}✓ Removed node_modules${NC}"
else
    echo "node_modules not found (already clean)"
fi

# Restore production package-lock.json for exact dependency matching
echo "Restoring production package-lock.json for exact dependency matching..."
git checkout origin/main -- package-lock.json
echo -e "${GREEN}✓ Restored package-lock.json from production${NC}"

# Install dependencies with npm ci (exact match)
echo ""
echo "Installing dependencies with npm ci (exact match from lockfile)..."
npm ci
echo -e "${GREEN}✓ Dependencies installed (exact versions from production)${NC}"
echo ""

# Type check
echo "Running TypeScript type check..."
if npx tsc --noEmit; then
    echo -e "${GREEN}✓ TypeScript compilation successful${NC}"
else
    echo -e "${RED}✗ TypeScript compilation failed!${NC}"
    exit 1
fi
echo ""

# Final summary
echo "=========================================="
echo "  FINAL VERIFICATION SUMMARY"
echo "=========================================="
echo ""

MAIN_COMMIT=$(git rev-parse origin/main)
STAGING_COMMIT=$(git rev-parse HEAD)
DIFF_COUNT=$(git diff --name-only origin/main HEAD | wc -l | tr -d ' ')

echo "Commit Verification:"
echo "  Main:    $MAIN_COMMIT"
echo "  Staging: $STAGING_COMMIT"
if [ "$MAIN_COMMIT" = "$STAGING_COMMIT" ]; then
    echo -e "  ${GREEN}✓ Status: MATCH${NC}"
else
    echo -e "  ${RED}✗ Status: MISMATCH${NC}"
fi
echo ""

echo "File Differences:"
echo "  Files different: $DIFF_COUNT"
if [ "$DIFF_COUNT" -eq 0 ]; then
    echo -e "  ${GREEN}✓ Status: NO DIFFERENCES${NC}"
else
    echo -e "  ${RED}✗ Status: FILES DIFFER${NC}"
fi
echo ""

echo "Build Status:"
echo -e "  ${GREEN}✓ TypeScript: PASSED${NC}"
echo -e "  ${GREEN}✓ Dependencies: INSTALLED (exact match from production)${NC}"
echo ""

echo "Backup Branch:"
echo "  $BACKUP_BRANCH"
echo ""

echo "=========================================="
echo "  READY FOR PUSH"
echo "=========================================="
echo ""

echo -e "${YELLOW}⚠️  REMINDER: Before pushing, verify Render environment variables:${NC}"
echo "  - WEBHOOK_URL must be explicitly set (not RENDER_EXTERNAL_URL)"
echo "  - Should be set to: https://ybb-tally-staging.onrender.com"
echo ""

read -p "Push to remote staging? Type 'yes' to confirm: " push_confirm

if [ "$push_confirm" = "yes" ]; then
    echo ""
    echo "Force pushing to remote staging..."
    git push origin staging --force
    echo ""
    echo -e "${GREEN}✓ Rollback complete! Staging is now at production commit.${NC}"
    echo ""
    echo "=========================================="
    echo "  WEBHOOK TEST COMMAND"
    echo "=========================================="
    echo ""
    echo "After Render deploys, test the webhook with:"
    echo ""
    echo 'curl -X POST https://ybb-tally-staging.onrender.com/webhook \'
    echo '  -H "Content-Type: application/json" \'
    echo '  -d '\''{'
    echo '    "update_id": 999999999,'
    echo '    "message": {'
    echo '      "message_id": 1,'
    echo '      "from": {'
    echo '        "id": 109284773,'
    echo '        "is_bot": false,'
    echo '        "first_name": "Test"'
    echo '      },'
    echo '      "chat": {'
    echo '        "id": -1003370162727,'
    echo '        "type": "supergroup",'
    echo '        "title": "Test Group"'
    echo '      },'
    echo '      "date": 1767027490,'
    echo '      "text": "Hello"'
    echo '    }'
    echo '  }'\'
    echo ""
    echo "Expected response: 200 OK"
else
    echo ""
    echo "Push cancelled. Local staging branch has been reset."
    echo "To push later, run: git push origin staging --force"
    echo ""
    echo -e "${YELLOW}⚠️  Note: Your current staging branch is now reset to production.${NC}"
    echo "   Backup saved at: $BACKUP_BRANCH"
fi


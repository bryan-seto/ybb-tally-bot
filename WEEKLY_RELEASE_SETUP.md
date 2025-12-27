# Weekly Release Automation Setup

This document explains how to set up the Weekly Release Automation workflow.

## Overview

The Weekly Release Automation workflow:
1. Extracts git commit logs from the past 7 days
2. Uses Gemini AI to generate a user-friendly Telegram summary
3. Uses Gemini AI to update the USER_GUIDE.md file with new features
4. Sends the summary to Telegram users with inline buttons

## GitHub Secrets Configuration

You need to configure the following secrets in your GitHub repository:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add:

### Required Secrets

- **`GEMINI_API_KEY`**: Your Google Gemini API key
  - Get it from: https://makersuite.google.com/app/apikey
  
- **`TELEGRAM_BOT_TOKEN`**: Your Telegram bot token
  - Get it from: @BotFather on Telegram
  
- **`TELEGRAM_USER_IDS`**: Comma-separated list of Telegram user IDs to send messages to
  - Example: `109284773,424894363`
  - To find user IDs, you can use a bot like @userinfobot or check your bot's logs

## Workflow Schedule

The workflow runs:
- **Automatically**: Every Monday at 9:00 AM UTC (5:00 PM SGT)
- **Manually**: You can trigger it from the GitHub Actions tab → "Weekly Release Automation" → "Run workflow"

## How It Works

### Step 1: Git Log Extraction
- Extracts all commits from the past 7 days
- Format: `git log --since="7 days ago" --pretty=format:"%h - %s (%an, %ar)"`

### Step 2: Telegram Summary Generation
- Sends git logs to Gemini AI with a prompt to create a user-friendly summary
- Removes technical jargon, groups by features/fixes
- Generates an exciting, casual message under 200 words

### Step 3: User Guide Updates
- Reads current `USER_GUIDE.md`
- Sends both the guide and git logs to Gemini AI
- AI identifies new features not yet documented
- Appends new sections to the guide (under "Recent Updates")

### Step 4: Telegram Dispatch
- Sends the summary to all users in `TELEGRAM_USER_IDS`
- Includes inline buttons:
  - **📖 Read Updated User Guide** → Links to GitHub USER_GUIDE.md
  - **💬 Provide Feedback** → Opens Telegram chat with you

## Testing Locally

You can test the script locally before pushing to GitHub:

```bash
# Set environment variables
export GEMINI_API_KEY="your-api-key"
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_USER_IDS="109284773,424894363"
export GITHUB_REPOSITORY="your-username/ybb-tally-bot"

# Build and run
npm run build
node dist/scripts/weekly-release.js
```

## Troubleshooting

### Workflow fails with "No commits found"
- This is normal if there were no commits in the past 7 days
- The workflow will skip execution gracefully

### Telegram messages not sending
- Check that `TELEGRAM_BOT_TOKEN` is correct
- Verify `TELEGRAM_USER_IDS` are valid user IDs (numbers only, comma-separated)
- Check GitHub Actions logs for specific error messages

### USER_GUIDE.md not updating
- The AI may determine no updates are needed (if features are already documented)
- Check the workflow logs to see what the AI returned
- The workflow will only commit if there are actual changes

## Customization

### Change Schedule
Edit `.github/workflows/weekly-release.yml`:
```yaml
schedule:
  - cron: '0 9 * * 1'  # Monday 9 AM UTC
```

Cron format: `minute hour day-of-month month day-of-week`

### Modify AI Prompts
Edit `src/scripts/weekly-release.ts`:
- `generateTelegramSummary()` - Change the system prompt for Telegram messages
- `generateUserGuideUpdates()` - Change the system prompt for guide updates

### Change User Guide Location
Update the `readUserGuide()` and `appendToUserGuide()` methods in the script.


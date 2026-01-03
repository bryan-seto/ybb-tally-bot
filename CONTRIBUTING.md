# Contributing / Local Development Guide

This guide explains how to set up a local development environment for the YBB Tally Bot.

## Prerequisites

- **Node.js** (v18 or higher)
- **Docker Desktop** installed and running
- **Telegram account** (for creating dev bot)
- **Gemini API key** (reuse existing or create new)

## Initial Setup

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd ybb-tally-bot
npm install
```

### 2. Create Local Environment File

```bash
cp .env.local.example .env.local
```

### 3. Get Dev Bot Token

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Name: `Bryan Dev Bot` (or your preferred name)
4. Username: `bryan_dev_tally_bot` (must be unique, ending in `bot`)
5. Copy the token provided
6. Paste into `.env.local` as `TELEGRAM_BOT_TOKEN`

### 4. Configure Local Environment

Edit `.env.local` and set:
- `TELEGRAM_BOT_TOKEN` - Your dev bot token from BotFather
- `DATABASE_URL` - Should be `postgresql://postgres:password@localhost:5432/ybb_tally_bot` (matches docker-compose.yml)
- `USER_A_ID` and `USER_B_ID` - Your test user IDs
- `BACKUP_RECIPIENT_ID` - Your Telegram ID (where backups go)
- `GEMINI_API_KEY` - Your Gemini API key

## Daily Development Workflow

### Start Local Database

```bash
npm run db:local:up
```

This starts the PostgreSQL database in Docker. The database persists between restarts (data stored in Docker volume).

**Verify it's running:**
```bash
docker ps
```
You should see `ybb-tally-db` container running.

### Run Database Migrations

```bash
npm run db:local:migrate
```

This applies all Prisma migrations to your local database.

### Start Bot in Local Mode

```bash
npm run dev:local
```

This starts the bot using your `.env.local` configuration. The bot will:
- Connect to your local Docker database
- Use your dev bot token
- Run in development mode (long polling, no webhooks)
- Auto-reload on code changes (ts-node-dev)

**You should see:**
- `✅ Database connected successfully`
- `✅ Created user: [User A Name]`
- `✅ Created user: [User B Name]`
- `💻 Running in DEVELOPMENT mode with LONG POLLING`
- `YBB Tally Bot is running...`

### Stop Local Database

```bash
npm run db:local:down
```

### Reset Local Database (Delete All Data)

```bash
npm run db:local:reset
```

⚠️ **Safety:** This command is **blocked in production**. It will:
1. Stop Docker database
2. Remove all data
3. Restart database
4. Run migrations
5. Seed initial data

**If you see:** `🚨 SAFETY BLOCKED: Database reset operation is not allowed in production`
- This means `NODE_ENV=production` is set
- Check your `.env.local` file - it should be `NODE_ENV=development`

### View Database (Prisma Studio)

```bash
npm run db:local:studio
```

Opens Prisma Studio in browser (usually http://localhost:5555) to view/edit database data.

## Testing

### Run Tests

```bash
npm test
```

### Run E2E Tests

```bash
npm run test:e2e
```

## Safety Features

### Production Protection

The codebase includes safety guards to prevent accidental data deletion in production:

- **`ensureNotProduction()` function** - Blocks dangerous operations if `NODE_ENV === 'production'`
- **Database reset operations** - Blocked in production
- **Test truncate operations** - Blocked in production

**How it works:**
- When `NODE_ENV=production`, any call to `ensureNotProduction()` throws an error
- This prevents running `db:reset` or truncate operations on production databases
- Local development (`NODE_ENV=development`) allows these operations safely

### Backup Recipient

All bot instances send backups to the configured `BACKUP_RECIPIENT_ID` (defaults to Bryan: 109284773).

Backups are sent daily at 02:00 Asia/Singapore time via Telegram.

**To configure:**
- Set `BACKUP_RECIPIENT_ID` environment variable in Render.com
- All instances should use the same backup recipient ID

## Development vs Production

| Aspect | Local Development | Production (Render) |
|--------|------------------|---------------------|
| Database | Docker PostgreSQL | Supabase PostgreSQL |
| Bot Token | Dev bot (via @BotFather) | Production bot token |
| Environment | `.env.local` | Render Environment Variables |
| Mode | `NODE_ENV=development` | `NODE_ENV=production` |
| Webhooks | Disabled (long polling) | Enabled |
| Safety Guards | Can reset/truncate | Blocked |
| Port | 10001 (configurable) | 10000 |

## Quick Reference (Cheatsheet)

```bash
# Start local database
npm run db:local:up

# Run migrations
npm run db:local:migrate

# Start bot locally
npm run dev:local

# Stop database
npm run db:local:down

# Reset database (delete all data)
npm run db:local:reset

# View database
npm run db:local:studio

# Run tests
npm test
```

## Troubleshooting

### Database Connection Failed

**Check:**
1. Docker is running: `docker ps`
2. Database container is up: `docker ps | grep ybb-tally-db`
3. Connection string in `.env.local` matches docker-compose.yml

**Fix:**
```bash
npm run db:local:up
# Wait a few seconds for database to start
npm run db:local:migrate
```

### Bot Not Responding

**Check:**
1. Bot token in `.env.local` is correct
2. Bot is started: `npm run dev:local`
3. Check console for errors
4. Verify you're messaging the correct dev bot (not production bot)

**Fix:**
- Verify bot token with @BotFather
- Check logs for error messages
- Ensure NODE_ENV is set to `development` in `.env.local`

### Port Already in Use

If port 5432 is already in use:
1. Check what's using it: `lsof -i :5432` (macOS/Linux) or `netstat -ano | findstr :5432` (Windows)
2. Stop conflicting service
3. Or change port in docker-compose.yml and update DATABASE_URL

### "Cannot reset in production" Error

**If you see:** `🚨 SAFETY BLOCKED: Database reset operation is not allowed in production`

**Check:**
- Your `.env.local` file has `NODE_ENV=development`
- You're not accidentally using production `.env` file
- Environment variable is not overridden

**Fix:**
- Verify `.env.local` contains `NODE_ENV=development`
- Make sure you're running `npm run db:local:reset` (not `npm run db:reset` without local)

### dotenv-cli Not Found

If you see errors about `dotenv` command:
```bash
npm install --save-dev dotenv-cli
```

## Architecture

### Database Strategy

- **Local Dev:** Docker PostgreSQL on localhost (port 5432)
- **Production A:** Your Supabase database
- **Production B:** Friends' Supabase database

Each environment is completely isolated - no risk of affecting production data during development.

### Branch Strategy

- `main` branch: Production-ready code
- All instances deploy from `main` branch
- Different behavior via environment variables

## Getting Help

If you encounter issues:
1. Check this guide
2. Check logs in console
3. Verify environment variables are set correctly
4. Ensure Docker is running
5. Verify `.env.local` file exists and is configured

---

**Last Updated:** 2025-01-03


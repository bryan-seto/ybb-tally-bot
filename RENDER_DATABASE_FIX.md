# Render Deployment - Troubleshooting Database Issues

## Current Errors

1. **Database Error**: `FATAL: Tenant or user not found`
2. **Telegram 409 Conflict**: Multiple bot instances

## Fix Steps

### 1. Fix Database Connection (CRITICAL)

Your `DATABASE_URL` in Render is incorrect. You need to use the **direct connection string**, not the pooler URL.

#### In Render Dashboard:

1. Go to your service → **Environment**
2. Find `DATABASE_URL`
3. Replace it with your **Supabase Direct Connection String**:

**Current (WRONG - Pooler):**
```
postgresql://postgres.bctwuxduyvoxpebdlpwt:PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Should be (CORRECT - Direct):**
```
postgresql://postgres.bctwuxduyvoxpebdlpwt:PASSWORD@aws-1-ap-southeast-1.connect.supabase.com:5432/postgres
```

**Where to find it:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Click **Settings** → **Database**
4. Under **Connection string**, select **URI** tab
5. Copy the connection string (it should have port `5432`, not `6543`)
6. Replace `[YOUR-PASSWORD]` with your actual database password

### 2. Fix Telegram 409 Conflict

The 409 error means another bot instance is running. To fix:

#### Option A: Wait (Recommended)
- Wait 1-2 minutes for the old instance to timeout
- Render will auto-restart with the new code

#### Option B: Manual Cleanup
In Render dashboard:
1. Go to **Shell**
2. Run:
```bash
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook?drop_pending_updates=true
```
Replace `<YOUR_BOT_TOKEN>` with your actual token.

3. Restart the service

### 3. Verify Environment Variables

Make sure these are set in Render:

```bash
NODE_ENV=production
PORT=10000
TELEGRAM_BOT_TOKEN=your_new_token_here
GEMINI_API_KEY=your_new_key_here
DATABASE_URL=postgresql://postgres.bctwuxduyvoxpebdlpwt:PASSWORD@aws-1-ap-southeast-1.connect.supabase.com:5432/postgres
ALLOWED_USER_IDS=109284773,424894363
TZ=Asia/Singapore
WEBHOOK_URL=https://your-service.onrender.com
```

### 4. Run Prisma Migrations

If you haven't run migrations on your Supabase database:

1. In Render Shell, run:
```bash
npx prisma migrate deploy
```

Or locally:
```bash
DATABASE_URL="your_supabase_direct_url" npx prisma migrate deploy
```

## After Fixing

The logs should show:
```
✅ Database connected successfully
✅ User Bryan already exists
✅ User Hwei Yeen already exists
✅ Database initialization complete
✅ Webhook verified: https://...
✅ YBB Tally Bot is running with webhooks...
```

## If Still Failing

Check:
1. Supabase project is not paused
2. Database password is correct (no special characters that need escaping)
3. Supabase allows connections from Render's IP range (usually automatic)


# Bot Not Responding - Debugging Steps

## Current Status:
✅ Bot is deployed on Render
✅ Webhook is set up
❌ Bot is NOT responding to messages

## Most Likely Issues:

### 1. Check Render Logs for Crashes
Go to Render Dashboard → Logs and look for:
- Any errors AFTER "YBB Tally Bot is running with webhooks..."
- Database connection errors
- Prisma errors
- Any stack traces

### 2. Test the Webhook Endpoint
Run this in your terminal:
```bash
curl https://ybb-tally-bot.onrender.com/health
```

Should return: `Bot is alive`

### 3. Check Telegram Webhook Status
Run this:
```bash
curl "https://api.telegram.org/bot8542481510:AAHeUJbKxVlxnbeYvLRdvPTdDSLBiIzosig/getWebhookInfo"
```

Look for:
- `"url"`: Should show your webhook URL
- `"pending_update_count"`: Number of messages waiting
- `"last_error_date"`: If there are errors
- `"last_error_message"`: What the error is

### 4. Missing Environment Variables
Check that ALL these are set in Render:
```
NODE_ENV=production
PORT=10000  
TELEGRAM_BOT_TOKEN=8542481510:AAHeUJbKxVlxnbeYvLRdvPTdDSLBiIzosig
GEMINI_API_KEY=(your new key)
DATABASE_URL=postgresql://postgres.bctwuxduyvoxpebdlpwt:PASSWORD@aws-1-ap-southeast-1.connect.supabase.com:5432/postgres
ALLOWED_USER_IDS=109284773,424894363
TZ=Asia/Singapore
WEBHOOK_URL=https://ybb-tally-bot.onrender.com
```

### 5. Database Still Not Connected?
If database connection failed during startup, the bot might crash when trying to process messages.

Check your Supabase:
1. Is the project active (not paused)?
2. Is the password correct in DATABASE_URL?

## Quick Test Commands:

### Test 1: Health Check
```bash
curl https://ybb-tally-bot.onrender.com/
```
Expected: `Bot is alive`

### Test 2: Webhook Info
```bash
curl "https://api.telegram.org/bot8542481510:AAHeUJbKxVlxnbeYvLRdvPTdDSLBiIzosig/getWebhookInfo" | python3 -m json.tool
```

### Test 3: Send Test Update
```bash
curl "https://api.telegram.org/bot8542481510:AAHeUJbKxVlxnbeYvLRdvPTdDSLBiIzosig/getUpdates"
```

## Common Causes:

1. **Database not connected** → Bot crashes on first message
2. **Webhook URL mismatch** → Telegram sending to wrong endpoint  
3. **Express not handling webhook path correctly**
4. **Render service sleeping** (shouldn't happen with our keep-alive)
5. **GEMINI_API_KEY still invalid** → Crashes when processing receipts

## Next Steps:

1. Check the latest Render logs - scroll to the BOTTOM
2. Send a test message to your bot
3. Immediately check logs again - what error appears?
4. Share the error message with me


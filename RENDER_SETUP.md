# Render Deployment Setup Instructions

## Critical: Service Configuration

The logs show Render is running `npm run dev` instead of `npm start`. You need to update the service settings in Render dashboard.

### Steps to Fix:

1. **Go to Render Dashboard** → Your service (`ybb-tally-bot`)
2. **Click on "Settings"** in the left sidebar
3. **Scroll to "Build & Deploy"** section
4. **Update these fields:**
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start` (NOT `npm run dev`)
5. **Save changes** - Render will automatically redeploy

### Environment Variables

Make sure these are set in Render dashboard → Environment:

- `NODE_ENV` = `production`
- `PORT` = `10000` (Render sets this automatically, but you can override)
- `WEBHOOK_URL` = `https://your-service-name.onrender.com` (your Render service URL)
- `TELEGRAM_BOT_TOKEN` = (your bot token)
- `GEMINI_API_KEY` = (your API key)
- `ALLOWED_USER_IDS` = `109284773,424894363`
- `DATABASE_URL` = (your Supabase connection string)
- `TZ` = `Asia/Singapore`

### Verify Deployment

After updating settings, check the logs:
- Should see: `Running 'npm run build'` (not `npm run dev`)
- Should see: `Running 'npm start'`
- Should see: `Webhook server listening on port 10000`
- Should see: `YBB Tally Bot is running with webhooks...`

### Health Check

Once deployed, test the health endpoint:
```bash
curl https://your-service-name.onrender.com/health
```

Should return:
```json
{
  "status": "ok",
  "message": "Bot is running!",
  "timestamp": "...",
  "mode": "webhook"
}
```


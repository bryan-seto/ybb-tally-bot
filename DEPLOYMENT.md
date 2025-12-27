# Render Deployment Guide

This guide explains how to deploy YBB Tally Bot to Render's free tier.

## Environment Variables

Set these in your Render dashboard:

### Required Variables:
- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token
- `GEMINI_API_KEY` - Google Gemini API key
- `ALLOWED_USER_IDS` - Comma-separated user IDs (e.g., "109284773,424894363")
- `DATABASE_URL` - Your Supabase PostgreSQL connection string
- `TZ` - Set to "Asia/Singapore"

### Render-Specific Variables:
- `NODE_ENV` - Set to "production"
- `PORT` - Render will set this automatically (defaults to 10000)
- `WEBHOOK_URL` - Your Render service URL (e.g., `https://ybb-tally-bot.onrender.com`)

## Deployment Steps

1. **Connect your GitHub repository** to Render
2. **Create a new Web Service** in Render
3. **Configure the service:**
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment:** Node
   - **Health Check Path:** `/health`

4. **Set all environment variables** listed above

5. **Deploy!** Render will:
   - Install dependencies
   - Generate Prisma client
   - Build TypeScript
   - Start the bot with webhooks

## Features

### Health Check Endpoints
- `GET /` - Returns bot status
- `GET /health` - Health check endpoint for Render

Both endpoints return:
```json
{
  "status": "ok",
  "message": "Bot is running!",
  "timestamp": "2025-12-26T...",
  "mode": "webhook"
}
```

### Webhook Mode
In production, the bot automatically:
- Sets up Telegram webhooks
- Listens on the webhook endpoint: `/webhook/{BOT_TOKEN}`
- Responds immediately to incoming messages (no polling delay)

### Keep-Alive Server
The bot runs an HTTP server that:
- Prevents Render from spinning down the instance
- Responds to health checks
- Listens on `0.0.0.0` (all interfaces) as required by Render

## Troubleshooting

### Bot Not Responding
1. Check Render logs for errors
2. Verify `WEBHOOK_URL` is set correctly
3. Ensure `TELEGRAM_BOT_TOKEN` is valid
4. Check that the health endpoint responds: `curl https://your-app.onrender.com/health`

### Connection Refused on Port 10000
- Render automatically sets the `PORT` environment variable
- The bot uses `process.env.PORT || 10000` as fallback
- Ensure the service is listening on `0.0.0.0`, not `localhost`

### Webhook Not Working
1. Verify `WEBHOOK_URL` matches your Render service URL exactly
2. Check that the webhook path is accessible
3. Use Telegram's `getWebhookInfo` API to verify webhook status

## Development vs Production

- **Development:** Uses long polling (no webhook URL needed)
- **Production:** Uses webhooks (requires `WEBHOOK_URL` and `NODE_ENV=production`)

The bot automatically detects the environment and switches modes accordingly.


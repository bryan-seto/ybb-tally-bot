# Environment Variables Template for Railway.app

Copy and paste these into Railway.app dashboard → Service → Variables tab:

## Required Variables (Copy-Paste This Section)

```
TELEGRAM_BOT_TOKEN=
DATABASE_URL=
USER_A_ID=
USER_A_NAME=
USER_B_ID=
USER_B_NAME=
GEMINI_API_KEY=
NODE_ENV=production
PORT=10000
WEBHOOK_URL=
```

---

## What to Fill In (Get From Your Friend):

### From Your Friend:
- `USER_A_ID` = [Friend's Telegram User ID - numeric, no quotes]
- `USER_A_NAME` = [Friend's Display Name - e.g., "Sarah"]
- `USER_B_ID` = [Friend's Partner Telegram User ID - numeric, no quotes]
- `USER_B_NAME` = [Friend's Partner Display Name - e.g., "John"]

### You Need to Create:
- `TELEGRAM_BOT_TOKEN` = [Create new bot via @BotFather on Telegram]
- `DATABASE_URL` = [Create new Supabase project → Settings → Database → Connection string URI]
- `GEMINI_API_KEY` = [Reuse existing or create new at https://aistudio.google.com/apikey]
- `WEBHOOK_URL` = [Set AFTER first deploy - use the Railway service URL, e.g., https://ybb-tally-bot-production.up.railway.app]

### Standard Values:
- `NODE_ENV` = `production`
- `PORT` = `10000`

---

## Quick Checklist:

- [ ] Get friend's Telegram User IDs (use @userinfobot)
- [ ] Get friend's display names
- [ ] Create new Telegram bot via @BotFather
- [ ] Create new Supabase database project
- [ ] Copy connection string (replace password placeholder)
- [ ] Have Gemini API key ready
- [ ] Fill in template above
- [ ] Paste into Railway.app Environment Variables (Service → Variables tab)
- [ ] Deploy service (automatic from GitHub)
- [ ] Update WEBHOOK_URL after first deploy with Railway public URL


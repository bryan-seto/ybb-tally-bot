# Stripe Setup Guide

## Step 1: Get Your Stripe API Keys

1. **Go to Stripe Dashboard**: https://dashboard.stripe.com
2. **Sign in** or create an account (use Test mode for development)
3. **Get your Secret Key**:
   - Click on "Developers" → "API keys"
   - Copy your **Secret key** (starts with `sk_test_` for test mode, `sk_live_` for production)
   - Paste it in your `.env` file as `STRIPE_SECRET_KEY`

## Step 2: Set Up Stripe Webhook

### For Development (Local Testing with ngrok):

1. **Install ngrok** (if not already installed):
   ```bash
   # macOS
   brew install ngrok
   
   # Or download from https://ngrok.com/download
   ```

2. **Start your bot locally**:
   ```bash
   npm run dev
   ```

3. **In another terminal, start ngrok**:
   ```bash
   ngrok http 3000
   # This will give you a URL like: https://abc123.ngrok.io
   ```

4. **Configure Stripe Webhook**:
   - Go to Stripe Dashboard → "Developers" → "Webhooks"
   - Click "Add endpoint"
   - **Endpoint URL**: `https://your-ngrok-url.ngrok.io/stripe-webhook`
   - **Description**: "YBB Tally Bot Webhook"
   - **Events to send**: Select `checkout.session.completed`
   - Click "Add endpoint"

5. **Get Webhook Secret**:
   - After creating the webhook, click on it
   - Find "Signing secret" and click "Reveal"
   - Copy the secret (starts with `whsec_`)
   - Paste it in your `.env` file as `STRIPE_WEBHOOK_SECRET`

### For Production (Render/Deployed):

1. **Deploy your bot** to Render (or your hosting platform)
   - Make sure your bot is deployed and running
   - Note your bot's public URL (e.g., `https://ybb-tally-bot.onrender.com`)

2. **Configure Stripe Webhook**:
   - Go to Stripe Dashboard → "Developers" → "Webhooks"
   - Click "Add endpoint"
   - **Endpoint URL**: `https://your-bot-url.onrender.com/stripe-webhook`
   - **Description**: "YBB Tally Bot Webhook (Production)"
   - **Events to send**: Select `checkout.session.completed`
   - Click "Add endpoint"

3. **Get Webhook Secret**:
   - After creating the webhook, click on it
   - Find "Signing secret" and click "Reveal"
   - Copy the secret (starts with `whsec_`)
   - Add it to your Render environment variables as `STRIPE_WEBHOOK_SECRET`

4. **Update Environment Variables in Render**:
   - Go to your Render dashboard
   - Select your service
   - Go to "Environment" tab
   - Add/Update:
     - `STRIPE_SECRET_KEY`: Your Stripe secret key
     - `STRIPE_WEBHOOK_SECRET`: Your webhook signing secret
     - `WEBHOOK_URL`: Your bot's public URL (e.g., `https://ybb-tally-bot.onrender.com`)

## Step 3: Verify Product IDs

Make sure these product IDs exist in your Stripe account:
- **Monthly**: `prod_TgMwheF4szla3f`
- **Yearly**: `prod_TgMwYI9LQnZFWe`

If they don't exist, you'll need to:
1. Create products in Stripe Dashboard
2. Update the product IDs in `src/services/subscriptionService.ts`

## Step 4: Test the Flow

### Test 1: Add Bot to Group (Trial Initialization)

1. **Create a new Telegram group** (or use an existing one)
2. **Add your bot** to the group
3. **Send any message** in the group
4. **Expected behavior**:
   - Bot should initialize the group
   - If you're a new user: Group gets 14-day trial
   - If you've used trial before: Group starts as "locked" and prompts for payment

### Test 2: Smart Split Flow (Receipt Photo)

1. **Send a receipt photo** to the group
2. **Expected behavior**:
   - Bot processes the photo with OCR
   - Shows amount confirmation
   - After confirmation, shows **Smart Split UI** with:
     - All group members listed with ✅/❌ toggles
     - "➕ Add Person" button
     - "✅ Confirm" button
3. **Test the UI**:
   - Click member names to toggle them on/off
   - Click "➕ Add Person" and type a name (creates virtual user)
   - Click "✅ Confirm" to save the expense

### Test 3: Smart Split Flow (Text Input)

1. **Type**: `Dinner 120` in the group
2. **Expected behavior**:
   - Bot parses: description = "Dinner", amount = 120
   - Shows Smart Split UI immediately
   - Follow same steps as Test 2

### Test 4: Identity Merging

1. **Create a virtual user** (via "Add Person" in split UI)
2. **Add some expenses** with that virtual user
3. **Have someone join the group** (or simulate by adding a new member)
4. **Expected behavior**:
   - Bot detects unlinked virtual users with debt
   - Shows prompt: "Welcome! I found existing expense records..."
   - Lists virtual users with their debt amounts
   - New member can click to claim identity or select "No, I'm new"

### Test 5: Subscription Payment

1. **Try to use bot in a locked/expired group**
2. **Expected behavior**:
   - Bot blocks expense commands
   - Shows payment prompt with Stripe checkout link
3. **Click the link**:
   - Should open Stripe checkout page
   - Complete test payment
   - Webhook should activate subscription
   - Bot should work again

## Troubleshooting

### Webhook Not Working?

1. **Check webhook logs** in Stripe Dashboard → "Developers" → "Webhooks" → Your webhook → "Logs"
2. **Verify endpoint URL** is correct and accessible
3. **Check webhook secret** matches in `.env`
4. **Test webhook** using Stripe's "Send test webhook" feature

### Migration Errors?

If you get migration errors:
```bash
# Use db push instead (for development)
npx prisma db push

# Or reset and start fresh (WARNING: deletes all data)
npx prisma migrate reset
```

### Bot Not Responding?

1. **Check bot is running**: Look for "Bot is alive" in logs
2. **Verify Telegram token** is correct
3. **Check group permissions**: Bot needs to read messages
4. **Review logs** for error messages

## Next Steps

After testing, you can:
1. **Switch to production mode** in Stripe (use live keys)
2. **Update product IDs** if you created new products
3. **Deploy to production** with all environment variables set
4. **Monitor webhook events** in Stripe Dashboard


# Manual Testing Guide: Photo Processing Fix

## Overview
This guide tests the fix for the SystemLog foreign key constraint error when processing photos.

## Pre-Testing Setup

1. **Start the bot in development mode:**
   ```bash
   cd /Users/bryanseto/ybb-tally-bot
   npm run dev:local
   ```
   
   Or if database is not running:
   ```bash
   npm run dev:local:full
   ```

2. **Verify bot is running:**
   - Check console output for "Bot is running..." or "Server listening on port..."
   - Bot should show: `✅ Database connected successfully`

---

## Test Case 1: Send Photo (Primary Fix)

### Objective
Verify that photos are processed without SystemLog foreign key constraint errors.

### Steps
1. **Open Telegram** and go to your test group/chat with the bot
2. **Send a photo** (receipt/screenshot) to the bot
3. **Wait 10-15 seconds** for processing

### Expected Results
- ✅ Bot replies with "📥 Collecting receipts... (1 photo received)" message
- ✅ After ~10 seconds, bot processes the photo
- ✅ Bot shows "🧠 AI is analyzing your receipt(s)..." message
- ✅ Bot replies with expense summary (e.g., "✅ Recorded 1 expense...")
- ✅ **NO errors in console** about "Foreign key constraint violated"
- ✅ **NO errors in console** about "system_logs_userId_fkey"

### Verification
- ✅ Photo processing completes successfully
- ✅ Expense is recorded in database
- ✅ Console shows no database errors
- ✅ Bot shows dashboard with updated balance

---

## Test Case 2: Send Text Message (Verify Normal Flow Still Works)

### Objective
Verify that normal text message processing still works after the fix.

### Steps
1. **In the same chat**, send a text message: `20 coffee`
2. **Wait a few seconds** for processing

### Expected Results
- ✅ Bot replies with expense recorded message
- ✅ Bot shows updated balance
- ✅ **NO errors in console**

### Verification
- ✅ Text processing works normally
- ✅ No regression in text message handling
- ✅ SystemLog entries are created correctly (if user exists in User table)

---

## Success Criteria

✅ **Test Case 1 passes:**
- Photo is processed successfully
- No database foreign key constraint errors
- Expense is recorded

✅ **Test Case 2 passes:**
- Text messages work normally
- No regressions

---

## If Test Fails

If you see "Foreign key constraint violated" errors:
1. Check that the user ID sending messages exists in the User table
2. Check console logs for the exact userId causing the error
3. Verify that `bot.ts` line 243-265 has the user existence check

If photo processing fails for other reasons:
1. Check console logs for AI service errors
2. Verify GEMINI_API_KEY is set correctly
3. Check network connectivity


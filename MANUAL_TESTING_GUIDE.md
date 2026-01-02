# Manual Testing Guide: Watermark Strategy Settlement Safety

## Overview
This guide tests the new Watermark Strategy implementation that prevents accidental batch settlements. The system now shows a preview before settlement and uses a watermark (max transaction ID) to prevent race conditions.

## Pre-Testing Setup

1. **Ensure you're on staging environment**
   - Bot should be running in staging mode
   - Check that you have some unsettled transactions in the database

2. **Verify current state**
   - Type `/balance` in the bot
   - Note the current outstanding balance
   - Type `/pending` to see unsettled transactions

---

## Test 1: `/settle` Command - Preview Flow

### Objective
Verify that `/settle` command shows a preview instead of settling immediately.

### Steps
1. **Type in bot:** `/settle`
2. **Expected Result:**
   - Bot should reply with a message showing:
     - "Ready to settle X transactions for SGD $Y.YY?"
     - "⚠️ This will mark all unsettled transactions as paid."
     - Two buttons: "✅ Confirm" and "❌ Cancel"
   - **DO NOT click Confirm yet**

### Verification
- ✅ Preview message shows correct transaction count
- ✅ Preview message shows correct total amount
- ✅ Buttons are displayed correctly
- ✅ No transactions are settled yet (check with `/balance`)

---

## Test 2: Cancel Button Functionality

### Objective
Verify that cancel button properly cleans up the preview message.

### Steps
1. **Type in bot:** `/settle`
2. **Click:** "❌ Cancel" button
3. **Expected Result:**
   - Preview message should be deleted
   - OR bot should reply "Settlement cancelled."
   - No transactions should be settled

### Verification
- ✅ Preview message is removed/updated
- ✅ No transactions were settled (check with `/balance`)
- ✅ Can run `/settle` again without issues

---

## Test 3: Confirm Settlement with Watermark

### Objective
Verify that settlement works correctly with watermark protection.

### Steps
1. **Type in bot:** `/settle`
2. **Note:** The transaction count and total amount shown
3. **Click:** "✅ Confirm" button
4. **Expected Result:**
   - Bot should reply: "🤝 All Settled! Marked X transaction(s) as paid."
   - Dashboard should refresh automatically
   - All transactions shown in preview should now be settled

### Verification
- ✅ Settlement message shows correct count
- ✅ Transactions are actually settled (check with `/balance` - should show "All settled")
- ✅ Dashboard refreshes correctly

---

## Test 4: Race Condition Protection (Watermark Test)

### Objective
Verify that new transactions added after preview are NOT accidentally settled.

### Steps
1. **Type in bot:** `/settle`
2. **Note:** The transaction count shown (e.g., "Ready to settle 5 transactions...")
3. **DO NOT click Confirm yet**
4. **In another chat or quickly:** Add a new transaction (e.g., type "10 Test Transaction")
5. **Go back to preview message and click:** "✅ Confirm"
6. **Expected Result:**
   - Only the transactions that existed at preview time should be settled
   - The new transaction added after preview should remain unsettled

### Verification
- ✅ New transaction is NOT settled
- ✅ Only original transactions from preview are settled
- ✅ Check with `/balance` - should show balance for the new transaction only

---

## Test 5: Menu "Settle Up" Button Flow

### Objective
Verify that the "💸 Settle Up" button from the menu uses the same watermark approach.

### Steps
1. **Type in bot:** `/menu` (or click menu button if available)
2. **Click:** "💸 Settle Up" button
3. **Expected Result:**
   - Bot should show balance message
   - Bot should show: "Ready to settle X transactions for SGD $Y.YY?"
   - Two buttons: "✅ Yes, Settle" and "❌ Cancel"
4. **Click:** "✅ Yes, Settle"
5. **Expected Result:**
   - Settlement should execute with watermark protection
   - Same behavior as `/settle` command

### Verification
- ✅ Menu button shows preview (not immediate settlement)
- ✅ Watermark protection works
- ✅ Settlement executes correctly

---

## Test 6: Idempotency Test (Already Settled)

### Objective
Verify that attempting to settle when already settled is handled gracefully.

### Steps
1. **Ensure all transactions are settled** (run `/settle` and confirm if needed)
2. **Type in bot:** `/settle`
3. **Expected Result:**
   - Bot should reply: "✅ All expenses are already settled! No outstanding balance."
   - No preview should be shown

### Verification
- ✅ No error occurs
- ✅ Appropriate message is shown
- ✅ No duplicate settlement attempts

---

## Test 7: Invalid Watermark Handling (Edge Case)

### Objective
Verify that invalid watermark IDs are rejected.

### Note: This test requires manual code injection or may not be easily testable via UI. The validation happens in the callback handler.

### Steps (if possible)
1. Try to manipulate callback data (advanced - may not be testable via normal UI)
2. **Expected Result:**
   - Invalid watermark should be rejected
   - Error message: "❌ Invalid settlement request. Please try again."

---

## Test 8: BigInt Serialization Test

### Objective
Verify that BigInt values are properly serialized (no errors in logs).

### Steps
1. **Type in bot:** `/settle`
2. **Click:** "✅ Confirm"
3. **Check logs/console:**
   - No BigInt serialization errors
   - Logs should contain watermark as string, not BigInt object

### Verification
- ✅ No errors in console/logs
- ✅ Settlement executes successfully
- ✅ Logs show watermark as string value

---

## Test 9: Multiple Settlement Attempts

### Objective
Verify that multiple settlement attempts work correctly.

### Steps
1. **Add some test transactions** (if needed, create a few unsettled transactions)
2. **Type in bot:** `/settle`
3. **Click:** "✅ Confirm"
4. **Wait for settlement to complete**
5. **Add new transactions**
6. **Type in bot:** `/settle` again
7. **Click:** "✅ Confirm"
8. **Expected Result:**
   - Each settlement should work independently
   - Only unsettled transactions at preview time should be settled

### Verification
- ✅ Multiple settlements work correctly
- ✅ Each settlement respects its own watermark
- ✅ No conflicts or errors

---

## Test 10: Error Handling

### Objective
Verify that errors are handled gracefully.

### Steps
1. **Type in bot:** `/settle`
2. **Click:** "✅ Confirm"
3. **If an error occurs:**
   - Bot should show: "❌ Sorry, an error occurred during settlement. Please try again."
   - No partial settlements should occur

### Verification
- ✅ Error messages are user-friendly
- ✅ No partial data corruption
- ✅ System remains in consistent state

---

## Post-Testing Verification

1. **Check final state:**
   - Type `/balance` - verify balance is correct
   - Type `/pending` - verify unsettled transactions list is correct

2. **Check logs:**
   - Verify settlement operations are logged
   - Check that watermark IDs are stored as strings in logs
   - Verify transaction counts match actual settlements

3. **Cleanup (if needed):**
   - If you want to revert test settlements, use the revert script:
     ```bash
     npx tsx scripts/revert_settlements.ts
     ```

---

## Expected Behavior Summary

### ✅ What Should Work:
- `/settle` shows preview before settlement
- Preview shows correct count and total
- Cancel button removes preview
- Confirm button settles only transactions up to watermark
- New transactions added after preview are NOT settled
- Menu "Settle Up" button uses same approach
- Already-settled check works correctly
- Error handling is graceful
- Logging captures all operations

### ❌ What Should NOT Happen:
- Immediate settlement without preview
- New transactions accidentally included in settlement
- BigInt serialization errors
- Invalid watermark IDs accepted
- Partial settlements on error
- Duplicate settlements

---

## Troubleshooting

### If preview doesn't show:
- Check that there are unsettled transactions
- Verify bot is running latest code
- Check console for errors

### If settlement doesn't work:
- Check database connection
- Verify watermark ID is valid
- Check logs for error messages

### If new transactions are included:
- This indicates watermark is not working
- Check that watermark constraint is in query: `id: { lte: watermarkID }`
- Verify watermark is calculated correctly (max ID from preview)

---

## Success Criteria

All tests pass if:
1. ✅ Preview is shown before settlement
2. ✅ Cancel works correctly
3. ✅ Settlement respects watermark (race condition protection)
4. ✅ Menu button uses same approach
5. ✅ Idempotency works
6. ✅ No BigInt errors
7. ✅ Error handling is graceful
8. ✅ Logging works correctly

---

## Notes

- The watermark is the maximum transaction ID at preview time
- Settlement only affects transactions with `id <= watermarkID`
- This prevents new transactions from being accidentally included
- All BigInt values are converted to strings for safety
- Input validation prevents injection attacks


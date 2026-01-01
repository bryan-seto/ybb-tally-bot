# Test Plan: Magic Edit Feature (Phase 3)

## Overview
This test plan covers the new "Magic Edit" feature that allows users to edit transactions via natural language commands like `edit /15 20` or `edit /15 lunch`.

**Deployment Status:** ✅ Pushed to `staging` branch

**Commit:** `8180a8e` - "feat: Add Magic Edit feature - natural language transaction editing"

---

## Files Changed
1. **NEW:** `src/services/editService.ts` - Core service handling edit commands
2. **MODIFIED:** `src/services/ai.ts` - Added `parseEditIntent` method
3. **MODIFIED:** `src/handlers/messageHandlers.ts` - Added edit command routing
4. **MODIFIED:** `src/bot.ts` - Updated dashboard footer
5. **MODIFIED:** `src/handlers/callbackHandlers.ts` - Updated history footer

---

## Test Areas & Scenarios

### 1. ✅ Edit Command Parsing & Recognition

#### Test Cases:
- [ ] **1.1** Basic edit command with slash: `edit /15 20`
  - Expected: Command is recognized and processed
  - Verify: Bot responds with success message

- [ ] **1.2** Edit command without slash: `edit 15 20`
  - Expected: Command is recognized (slash is optional)
  - Verify: Same behavior as 1.1

- [ ] **1.3** Case insensitive: `Edit /15 20` or `EDIT /15 20`
  - Expected: Command is recognized regardless of case
  - Verify: Same behavior as 1.1

- [ ] **1.4** Invalid format: `edit /15` (missing instruction)
  - Expected: Command is ignored (regex requires non-empty instruction with `.+`)
  - Verify: Bot does NOT process this as edit command
  - Note: Should fall through to other handlers or be ignored

- [ ] **1.5** Invalid format: `edit` (no ID)
  - Expected: Command is ignored
  - Verify: Bot does NOT process this as edit command

- [ ] **1.6** Invalid format: `edit /abc` (non-numeric ID)
  - Expected: Command is ignored (regex requires numeric ID)
  - Verify: Bot does NOT process this as edit command

---

### 2. ✅ Amount Editing

#### Test Cases:
- [ ] **2.1** Simple numeric amount: `edit /15 20`
  - Expected: Updates transaction amount to $20.00
  - Verify: 
    - Diff message shows: "💵 Amount: $X.XX ➡️ $20.00"
    - Dashboard refreshes automatically
    - Transaction amount is actually updated in database

- [ ] **2.2** Amount with decimal: `edit /15 20.50`
  - Expected: Updates amount to $20.50
  - Verify: Diff message shows correct decimal amount

- [ ] **2.3** Amount with dollar sign: `edit /15 $25`
  - Expected: AI parses and updates to $25.00
  - Verify: Amount updates correctly

- [ ] **2.4** Large amount: `edit /15 1000`
  - Expected: Updates to $1000.00
  - Verify: Large amounts work correctly

- [ ] **2.5** Small amount: `edit /15 0.50`
  - Expected: Updates to $0.50
  - Verify: Small decimal amounts work

- [ ] **2.6** Invalid amount: `edit /15 -10` or `edit /15 0`
  - Expected: Error message about invalid amount
  - Verify: Transaction is NOT updated

- [ ] **2.7** Non-numeric amount: `edit /15 abc`
  - Expected: AI attempts to parse, but may fail or treat as description
  - Verify: Either updates description or shows error

---

### 3. ✅ Description Editing

#### Test Cases:
- [ ] **3.1** Simple text: `edit /15 lunch`
  - Expected: Updates transaction description to "lunch"
  - Verify:
    - Diff message shows: "📝 Description: \"Old Desc\" ➡️ \"lunch\""
    - Dashboard refreshes
    - Description is updated in database

- [ ] **3.2** Multi-word description: `edit /15 coffee and pastries`
  - Expected: Updates to "coffee and pastries"
  - Verify: Multi-word descriptions work

- [ ] **3.3** Description with special characters: `edit /15 Café #1`
  - Expected: Updates description correctly
  - Verify: Special characters are preserved

- [ ] **3.4** Empty description: `edit /15 ""` (if possible)
  - Expected: Error about invalid description
  - Verify: Transaction is NOT updated

---

### 4. ✅ Category Editing

#### Test Cases:
- [ ] **4.1** Change category: `edit /15 Food`
  - Expected: Updates category to "Food"
  - Verify:
    - Diff message shows: "📂 Category: OldCat ➡️ Food"
    - Category is updated in database

- [ ] **4.2** Valid category: `edit /15 Transport`
  - Expected: Updates to Transport category
  - Verify: Category updates correctly

- [ ] **4.3** Invalid category: `edit /15 InvalidCategory`
  - Expected: Either updates (if AI allows) or shows error
  - Verify: Behavior is consistent

---

### 5. ✅ Multiple Field Updates

#### Test Cases:
- [ ] **5.1** Amount and description: `edit /15 20 coffee`
  - Expected: AI should parse both fields
  - Verify: Both amount and description are updated
  - Note: AI behavior may vary - test actual response

- [ ] **5.2** Amount and category: `edit /15 25 Food`
  - Expected: Both fields updated
  - Verify: Diff shows both changes

- [ ] **5.3** All three fields: `edit /15 30 lunch Food`
  - Expected: All three fields updated
  - Verify: Diff shows all changes

---

### 6. ✅ Error Handling & Edge Cases

#### Test Cases:
- [ ] **6.1** Invalid transaction ID: `edit /99999 20`
  - Expected: Error message: "❌ Transaction /99999 not found."
  - Verify: No database changes, user-friendly error

- [ ] **6.2** Non-existent user: (if possible to simulate)
  - Expected: Error message about user not found
  - Verify: Graceful error handling

- [ ] **6.3** AI parsing failure: `edit /15 gibberishxyz123`
  - Expected: Error message about not understanding the instruction
  - Verify: Transaction is NOT updated, error is user-friendly

- [ ] **6.4** Network/timeout during AI call: (if possible)
  - Expected: Graceful error handling
  - Verify: User gets error message, no partial updates

- [ ] **6.5** Empty instruction after parsing: `edit /15 "   "` (spaces only)
  - Expected: Error or ignored
  - Verify: Transaction not updated

---

### 7. ✅ Security & Authorization

#### Test Cases:
- [ ] **7.1** Edit own transaction: Normal user edits their transaction
  - Expected: Success
  - Verify: Edit works normally

- [ ] **7.2** Edit transaction from different group: (when Group model is added)
  - Expected: Error: "❌ Unauthorized: You can only edit transactions in your group."
  - Verify: Transaction is NOT updated
  - Note: This may not work yet if Group model not in schema

- [ ] **7.3** Transaction ID guessing: Try to edit random transaction IDs
  - Expected: Either "not found" or "unauthorized" (depending on existence)
  - Verify: No unauthorized access

---

### 8. ✅ UI & User Experience

#### Test Cases:
- [ ] **8.1** Dashboard footer update
  - Expected: Footer shows: "👇 **Quick Record:** Send a photo or type '5 Coffee'.\n💡 **Tip:** Type 'edit /ID [change]' to fix a mistake!"
  - Verify: Footer appears on dashboard message

- [ ] **8.2** History footer update
  - Expected: Footer shows: "💡 **Tip:** To fix a mistake, just type 'edit /ID' followed by the change (e.g., 'edit /15 20')."
  - Verify: Footer appears in History view (view_history callback)

- [ ] **8.3** Diff view formatting
  - Expected: Success message shows changed fields with emoji icons
  - Verify:
    - 💵 for Amount changes
    - 📝 for Description changes
    - 📂 for Category changes
    - Only changed fields are shown

- [ ] **8.4** Dashboard auto-refresh after edit
  - Expected: After successful edit, dashboard automatically refreshes
  - Verify: New dashboard message appears showing updated balance and activity

- [ ] **8.5** Multiple edits in sequence
  - Expected: Each edit works independently
  - Verify: Can edit same transaction multiple times

---

### 9. ✅ Integration with Existing Features

#### Test Cases:
- [ ] **9.1** Edit after quick expense: Create expense, then immediately edit it
  - Expected: Edit works on newly created transaction
  - Verify: Can get transaction ID and edit it

- [ ] **9.2** Edit after photo receipt: Create expense via photo, then edit
  - Expected: Edit works normally
  - Verify: Amount/description updates work

- [ ] **9.3** Edit vs transaction detail view: View transaction detail, then try to edit via command
  - Expected: Edit command still works
  - Verify: Command takes precedence or works alongside detail view

- [ ] **9.4** Edit vs AI correction (@bot tag): 
  - Expected: @bot tag commands still work for corrections
  - Verify: Edit command doesn't interfere with bot-tagged corrections

- [ ] **9.5** Edit vs quick expense pattern: `5 Coffee` vs `edit /15 coffee`
  - Expected: Both work correctly, edit command is checked first (after transaction ID)
  - Verify: No conflicts between patterns

---

### 10. ✅ Database & Data Integrity

#### Test Cases:
- [ ] **10.1** Amount precision: Edit to decimal amount
  - Expected: Decimal amounts stored correctly
  - Verify: Check database - amountSGD should be accurate

- [ ] **10.2** Updated timestamp: Check `updatedAt` field
  - Expected: `updatedAt` is updated when transaction is edited
  - Verify: Database field reflects edit time

- [ ] **10.3** Other fields unchanged: Edit only amount, verify description/category unchanged
  - Expected: Only specified fields change
  - Verify: Database shows partial updates correctly

- [ ] **10.4** Transaction history: Edit doesn't break transaction viewing
  - Expected: Edited transaction still appears in history
  - Verify: Transaction detail view shows updated values

---

## Regression Testing

### Areas to Verify Still Work:
- [ ] Transaction creation (photo receipts)
- [ ] Transaction creation (quick expense: "5 Coffee")
- [ ] Transaction detail view (typing `/15`)
- [ ] AI correction with @bot tag
- [ ] Dashboard display
- [ ] History view
- [ ] Settle up functionality
- [ ] Balance calculations
- [ ] Manual add expense flow
- [ ] Recurring expenses

---

## Performance & Load Testing

#### Test Cases:
- [ ] **P.1** Multiple rapid edits: Edit same transaction 5 times quickly
  - Expected: All edits complete successfully
  - Verify: No race conditions or errors

- [ ] **P.2** Edit during high activity: Edit while receiving photos
  - Expected: Both operations complete
  - Verify: No conflicts or deadlocks

---

## Test Data Setup

### Recommended Test Transactions:
1. Create transaction: `/add` → Amount: 10, Description: "Test Coffee", Category: Food
2. Create transaction: `/add` → Amount: 25.50, Description: "Lunch", Category: Food
3. Create transaction via quick expense: `50 Groceries`
4. Create transaction via photo receipt

### Test IDs to Note:
- Note the transaction IDs created for testing
- Use these IDs in your edit commands

---

## Success Criteria

✅ **Feature is ready for production if:**
- [ ] All basic edit scenarios work (amount, description, category)
- [ ] Error handling works correctly
- [ ] Dashboard auto-refreshes after edit
- [ ] UI footers are updated and visible
- [ ] No breaking changes to existing features
- [ ] Security checks work (or are ready for Group model)
- [ ] All tests pass
- [ ] No database corruption or data loss

---

## Known Limitations / Notes

1. **Group Model:** Security check is implemented but Group model may not exist in schema yet. This is OK - check will be enforced when Group model is added.

2. **AI Parsing:** The AI parsing may have some edge cases. Test various natural language inputs.

3. **Decimal Handling:** Schema uses `Float` type (not Decimal), so no `.toNumber()` needed - but code handles both.

4. **Regex Safety:** Using `.+` ensures empty instructions are rejected (command is ignored).

---

## Rollback Plan

If critical issues are found:
1. Revert commit `8180a8e` on staging branch
2. Or cherry-pick previous working commit
3. Redeploy staging

**Rollback Command:**
```bash
git revert 8180a8e
git push origin staging
```

---

## Test Execution Log

**Tester:** _________________  
**Date:** _________________  
**Environment:** Staging  
**Test Results:**

| Test ID | Status | Notes |
|---------|--------|-------|
| 1.1 | ⬜ Pass / ⬜ Fail | |
| 1.2 | ⬜ Pass / ⬜ Fail | |
| ... | | |

---

## Quick Test Checklist (Priority Tests)

**Must Test First:**
- [ ] `edit /15 20` - Basic amount edit
- [ ] `edit /15 lunch` - Basic description edit  
- [ ] `edit /99999 20` - Invalid ID error
- [ ] Dashboard footer appears
- [ ] History footer appears
- [ ] Dashboard refreshes after edit
- [ ] Existing features still work (create expense, view details)

---

**Last Updated:** 2025-01-01  
**Version:** Phase 3 - Magic Edit Feature


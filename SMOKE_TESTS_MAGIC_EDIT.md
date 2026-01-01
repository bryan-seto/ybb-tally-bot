# Smoke Tests: Magic Edit Feature

## Critical Manual Tests (Must Pass Before Production)

**Environment:** Staging  
**Priority:** HIGH - These tests verify core functionality works end-to-end

---

## Smoke Test 1: Basic Amount Edit ✅

**Test:** Edit transaction amount successfully

**Steps:**
1. Create a test transaction (via `/add` or photo)
2. Note the transaction ID (e.g., `/15`)
3. Type: `edit /15 20`
4. **Observe:**
   - ✅ Loading message appears: "⏳ Processing edit..."
   - ✅ Loading updates: "⏳ Understanding your change..."
   - ✅ Loading updates: "⏳ Updating transaction..."
   - ✅ Loading message disappears
   - ✅ Success message shows: "✅ **Updated /15**" with "💵 Amount: $X.XX ➡️ $20.00"
   - ✅ Dashboard refreshes automatically
   - ✅ Transaction amount is actually $20.00 in database

**Pass Criteria:** All ✅ items pass

---

## Smoke Test 2: Description Edit ✅

**Test:** Edit transaction description successfully

**Steps:**
1. Have an existing transaction (e.g., `/16`)
2. Type: `edit /16 lunch`
3. **Observe:**
   - ✅ Loading messages appear and update correctly
   - ✅ Success message shows: "📝 Description: \"Old Name\" ➡️ \"lunch\""
   - ✅ Dashboard refreshes
   - ✅ Transaction description is actually "lunch" in database

**Pass Criteria:** All ✅ items pass

---

## Smoke Test 3: Error Handling - Invalid Transaction ID ✅

**Test:** Graceful error when transaction doesn't exist

**Steps:**
1. Type: `edit /99999 20` (assuming transaction /99999 doesn't exist)
2. **Observe:**
   - ✅ Loading message appears: "⏳ Processing edit..."
   - ✅ Loading updates: "⏳ Understanding your change..."
   - ✅ Loading message disappears
   - ✅ Error message appears: "❌ Transaction /99999 not found."
   - ✅ No crash or unexpected behavior
   - ✅ Bot remains responsive

**Pass Criteria:** All ✅ items pass

---

## Smoke Test 4: UI Footer Updates ✅

**Test:** Verify improved copywriting is visible and clear

**Steps:**
1. Type `/menu` or wait for dashboard to appear
2. **Check Dashboard Footer:**
   - ✅ Footer shows: "💡 **Tip:** Made a mistake? Type 'edit /15 20' to change amount, or 'edit /15 lunch' to change description."
   - ✅ Tip is clear and actionable
   - ✅ Examples are visible and helpful
3. Click "📜 History" button
4. **Check History Footer:**
   - ✅ Footer shows: "💡 **Tip:** Tap an ID to view details. To edit: type 'edit /15 20' (change amount) or 'edit /15 lunch' (change name)."
   - ✅ Tip matches dashboard tone
   - ✅ Examples are clear

**Pass Criteria:** All ✅ items pass

---

## Smoke Test 5: Integration - Edit Doesn't Break Existing Features ✅

**Test:** Verify edit feature doesn't interfere with normal operations

**Steps:**
1. **Test Quick Expense:**
   - Type: `50 groceries`
   - ✅ Quick expense works normally (no edit command triggered)
2. **Test Photo Receipt:**
   - Send a photo receipt
   - ✅ Photo processing works normally
3. **Test Transaction View:**
   - Type: `/15` (existing transaction ID)
   - ✅ Transaction detail view works normally
4. **Test Dashboard:**
   - Type `/menu`
   - ✅ Dashboard displays correctly
   - ✅ All buttons work

**Pass Criteria:** All ✅ items pass - no regressions

---

## Quick Checklist

Before marking as "Ready for Production":

- [ ] Smoke Test 1: Amount edit works
- [ ] Smoke Test 2: Description edit works  
- [ ] Smoke Test 3: Error handling works
- [ ] Smoke Test 4: UI footers updated and clear
- [ ] Smoke Test 5: No regressions in existing features

**Estimated Time:** 5-10 minutes

**If any test fails:** Document the issue and revert/debug before production deployment.


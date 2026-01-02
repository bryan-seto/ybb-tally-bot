# Manual Test Cases: Balance Impact Display (Phase 1)

## Overview
Test the new balance impact visualization in transaction details. The system now shows exactly who owes whom and how much, replacing ambiguous percentage displays.

---

## Test Setup

1. Ensure you're on the staging environment
2. Have access to the Telegram bot
3. Have at least one transaction in the system (preferably multiple types)

---

## Test Case 1: View Transaction with Unsettled Debt

**Objective:** Verify that transaction details show clear debt relationships for unsettled transactions.

**Steps:**
1. Open a transaction detail view (click on any transaction from history)
2. Check if the transaction is unsettled (red circle 🔴)

**Expected Result:**
The transaction detail should show:
```
💳 **Transaction Details**

🔴 **Status:** Unsettled
📅 **Date:** [date]
🏪 **Merchant:** [merchant name]
💰 **Amount:** SGD $[amount]
📂 **Category:** [category]
👤 **Paid By:** [payer name]
⚖️ **Split:** [X]% Bryan / [Y]% HY
⚖️ **BALANCE IMPACT**
🔴 👉 [Person] owes [Other Person] $[amount]
📝 **Description:** [description]
```

**Test Text:** View transaction `/96` (or any transaction ID)

**Verification Points:**
- [ ] Balance Impact section appears
- [ ] Shows correct debtor and creditor
- [ ] Shows correct dollar amount
- [ ] Amount matches: (split percentage × transaction amount) - (amount paid by that person)

---

## Test Case 2: Transaction Where Bryan Owes Money

**Objective:** Verify display when Bryan owes Hwei Yeen.

**Steps:**
1. Find or create a transaction where:
   - Hwei Yeen paid (or Bryan paid less than his share)
   - Bryan's split percentage results in debt
2. View transaction details

**Expected Result:**
```
⚖️ **BALANCE IMPACT**
🔴 👉 Bryan owes Hwei Yeen $[amount]
```

**Test Scenarios:**
- Transaction where HY paid $100, Bryan's share is 70% → Should show "Bryan owes Hwei Yeen $70.00"
- Transaction where HY paid $252.55, Bryan's share is 100% → Should show "Bryan owes Hwei Yeen $252.55"

**Test Text:** View transaction `/96` (if it exists, "HY own Bryan - $252.55")

**Verification Points:**
- [ ] Shows "Bryan owes Hwei Yeen"
- [ ] Amount is calculated correctly
- [ ] Uses red circle emoji (🔴) for debt indication

---

## Test Case 3: Transaction Where Hwei Yeen Owes Money

**Objective:** Verify display when Hwei Yeen owes Bryan.

**Steps:**
1. Find or create a transaction where:
   - Bryan paid (or Hwei Yeen paid less than her share)
   - Hwei Yeen's split percentage results in debt
2. View transaction details

**Expected Result:**
```
⚖️ **BALANCE IMPACT**
🔴 👉 Hwei Yeen owes Bryan $[amount]
```

**Test Scenarios:**
- Transaction where Bryan paid $100, HY's share is 30% → Should show "Hwei Yeen owes Bryan $30.00"
- Transaction where Bryan paid $50, split is 50/50 → Should show "Hwei Yeen owes Bryan $25.00"

**Verification Points:**
- [ ] Shows "Hwei Yeen owes Bryan"
- [ ] Amount is calculated correctly
- [ ] Uses red circle emoji (🔴)

---

## Test Case 4: Settled Transaction

**Objective:** Verify display for settled transactions shows no active debt.

**Steps:**
1. View a transaction that is already settled (green checkmark ✅)
2. Check the Balance Impact section

**Expected Result:**
```
⚖️ **BALANCE IMPACT**
✅ Settled (No active debt)
```

**Test Text:** View any settled transaction

**Verification Points:**
- [ ] Shows "Settled (No active debt)"
- [ ] Uses green checkmark (✅)
- [ ] No dollar amount shown

---

## Test Case 5: Transaction with Zero Debt (Paid for Own Expense)

**Objective:** Verify display when someone paid for their own expense (no debt created).

**Steps:**
1. Find or create a transaction where:
   - Payer's share percentage equals 100%
   - Example: Bryan paid $100, Bryan's share is 100%
2. View transaction details

**Expected Result:**
```
⚖️ **BALANCE IMPACT**
✅ No debt created (Paid for own expense)
```

**Test Scenarios:**
- Bryan paid $100, Bryan's share is 100% → Should show "No debt created"
- HY paid $50, HY's share is 100% → Should show "No debt created"

**Verification Points:**
- [ ] Shows "No debt created (Paid for own expense)"
- [ ] Uses green checkmark (✅)
- [ ] No dollar amount shown

---

## Test Case 6: Transaction with Default Split (70/30)

**Objective:** Verify display works with default split percentages.

**Steps:**
1. View a transaction that doesn't have explicit split percentages set (uses defaults: 70% Bryan, 30% HY)
2. Check the Balance Impact calculation

**Expected Result:**
- Split shows "70% Bryan / 30% HY" (or fallback format)
- Balance Impact shows correct debt based on 70/30 split

**Test Text:** View any transaction without explicit split percentages

**Verification Points:**
- [ ] Defaults to 70/30 split
- [ ] Balance impact calculated correctly with defaults
- [ ] Shows correct debtor/creditor relationship

---

## Test Case 7: Transaction with 50/50 Split

**Objective:** Verify display with equal split.

**Steps:**
1. View a transaction with FIFTY_FIFTY split type
2. Check the Balance Impact section

**Expected Result:**
```
⚖️ **Split:** 50% / 50%
⚖️ **BALANCE IMPACT**
🔴 👉 [Person] owes [Other Person] $[amount]
```

**Test Text:** View transaction with 50/50 split

**Verification Points:**
- [ ] Shows "50% / 50%" in split section
- [ ] Balance impact calculated correctly (half the amount)
- [ ] Shows correct debtor based on who paid

---

## Test Case 8: Transaction with Custom Split Percentages

**Objective:** Verify display with non-standard split percentages.

**Steps:**
1. View a transaction with custom percentages (e.g., 80/20, 60/40)
2. Check both Split and Balance Impact sections

**Expected Result:**
- Split shows custom percentages
- Balance Impact reflects custom percentages accurately

**Test Text:** View transaction with custom split (e.g., 80% Bryan / 20% HY)

**Verification Points:**
- [ ] Custom percentages displayed correctly
- [ ] Balance impact uses custom percentages
- [ ] Calculation is accurate

---

## Test Case 9: Edge Case - Large Amount

**Objective:** Verify display with large transaction amounts.

**Steps:**
1. View a transaction with a large amount (e.g., > $1000)
2. Verify formatting of large numbers

**Expected Result:**
- Amount displays correctly with 2 decimal places
- Balance impact shows correct calculation
- No formatting errors

**Verification Points:**
- [ ] Large amounts format correctly (e.g., "$1,234.56" or "$1234.56")
- [ ] Balance impact calculations are accurate
- [ ] No scientific notation or overflow issues

---

## Test Case 10: Edge Case - Small Amount

**Objective:** Verify display with very small transaction amounts.

**Steps:**
1. View a transaction with a small amount (e.g., < $1.00)
2. Verify formatting and calculations

**Expected Result:**
- Small amounts display correctly
- Balance impact calculations are accurate
- Rounding is handled correctly

**Verification Points:**
- [ ] Small amounts format correctly (e.g., "$0.50")
- [ ] Balance impact calculations are accurate
- [ ] Decimal precision is maintained

---

## Test Case 11: Integration - View from Dashboard

**Objective:** Verify transaction details are accessible from main dashboard.

**Steps:**
1. Open the bot dashboard
2. Click on a transaction from "Latest Activity" section
3. Verify the transaction detail view includes Balance Impact

**Test Text:** Click on any transaction ID from the dashboard (e.g., `/96`)

**Verification Points:**
- [ ] Transaction detail view opens correctly
- [ ] Balance Impact section is visible
- [ ] All information is displayed correctly

---

## Test Case 12: Integration - View from History Menu

**Objective:** Verify transaction details from history menu include Balance Impact.

**Steps:**
1. Open History menu
2. Select a transaction
3. Verify the transaction detail view

**Test Text:** Navigate: Menu → History → Select transaction

**Verification Points:**
- [ ] History navigation works
- [ ] Transaction detail includes Balance Impact
- [ ] All sections display correctly

---

## Expected Behavior Summary

### For Unsettled Transactions:
- **Bryan owes HY:** `🔴 👉 Bryan owes Hwei Yeen $X.XX`
- **HY owes Bryan:** `🔴 👉 Hwei Yeen owes Bryan $X.XX`
- **Zero debt:** `✅ No debt created (Paid for own expense)`

### For Settled Transactions:
- **Any split:** `✅ Settled (No active debt)`

### Calculation Formula:
- `bryanNet = (amount × bryanPercentage) - (amount if Bryan paid, else 0)`
- `hyNet = (amount × hyPercentage) - (amount if HY paid, else 0)`
- If `bryanNet > 0.01`: Bryan owes HY
- If `hyNet > 0.01`: HY owes Bryan
- If both are < 0.01: No debt created

---

## Regression Testing

While testing, also verify that:
- [ ] Existing transaction list view still works
- [ ] Transaction editing still works
- [ ] Settling transactions still works
- [ ] No errors appear in bot logs
- [ ] Markdown formatting renders correctly in Telegram

---

## Known Issues / Notes

- The diagnostic script (`scripts/diagnose_transaction_96.ts`) was created but not committed (intentional - for debugging only)
- Snapshot tests were updated to reflect new format
- One e2e test may fail (unrelated to this change - about transaction settling)

---

## Quick Test Commands

Use these commands in Telegram to quickly test:

1. **View transaction:** `/96` (or any transaction ID)
2. **View history:** Click "History" button → Select transaction
3. **View from dashboard:** Click on transaction in "Latest Activity"

---

## Success Criteria

✅ All test cases pass
✅ Balance Impact shows correct calculations
✅ No formatting errors
✅ No crashes or errors in logs
✅ User can clearly see who owes whom
✅ Amounts match manual calculations


# HY UX Sprint — Requirements Document

**Project:** YBB Tally Bot  
**Sprint name:** HY Experience Improvement Sprint  
**Author:** PAX (Product)  
**Reviewers:** REX (TDD), BLADE (Code)  
**Date:** 2026-06-08  
**Status:** Draft — Ready for implementation

---

## 0. Sprint Overview

HY (Hwei Yeen) has been the primary daily user of YBB Tally Bot since December 2025. A NEMESIS audit identified five issues degrading her experience: three data-correctness bugs and two UX friction points. This document specifies the **exact behaviour change** for each item so that REX can write failing tests first and BLADE can make them pass.

Tech stack: **TypeScript · Telegraf · Prisma · Vitest**  
Test command: `node node_modules/.bin/vitest run`

---

## 1. Item Summary

| ID | Type | Title | Primary File(s) |
|----|------|-------|-----------------|
| BUG-1 | Bug | Settlement rows show 🔴 instead of ✅ | `historyService.ts`, `commandHandlers.ts` |
| BUG-2 | Bug | Balance total mismatch between `/balance` and Menu view | `expenseService.ts`, `MenuCallbackHandler.ts` |
| BUG-3 | Bug | Historical null-percent rows display 70/30 lie | `historyService.ts` |
| FEAT-1 | Feature | Settle-up confirmation step before payment fires | `SettleCallbackHandler.ts` |
| FEAT-2 | Feature | Dashboard header clarity — include who owes whom | `bot.ts` |

---

## 2. Detailed Requirements

---

### BUG-1 — Settlement rows show 🔴 instead of ✅

#### What
Settlement/Payment category transactions appear with a 🔴 unsettled emoji in `/history` and on the Dashboard activity feed. Additionally, the `/settle` command watermark preview inflates the displayed transaction count and total amount by including those same Settlement/Payment rows.

#### Why
`expenseService.recordPayment()` deliberately creates the payment transaction record with `isSettled: false` (line 786 of `expenseService.ts`) — the flag is semantically unused for payment rows because `calculateNetBalance()` classifies them by *category*, not flag. However, `historyService.getRecentTransactions()` and `formatTransactionModel()` both map status purely from `t.isSettled`:

```typescript
// historyService.ts — current (wrong)
status: t.isSettled ? 'settled' : 'unsettled',
```

`commandHandlers.handleSettle()` also queries `where: { isSettled: false }` without a category exclusion, so Settlement rows are counted in the watermark total.

#### Fix

**Part A — `historyService.ts` `getRecentTransactions()`**

In the `.map()` callback (line 40–50), change the status mapping to:
```typescript
status: (t.isSettled || t.category === 'Settlement' || t.category === 'Payment')
  ? 'settled'
  : 'unsettled',
```

**Part B — `historyService.ts` `formatTransactionModel()`**

Same guard on line 74:
```typescript
status: (rawTx.isSettled || rawTx.category === 'Settlement' || rawTx.category === 'Payment')
  ? 'settled'
  : 'unsettled',
```

**Part C — `commandHandlers.ts` `handleSettle()`**

Add `category: { notIn: ['Settlement', 'Payment'] }` to the Prisma query filter on line 70:
```typescript
const unsettled = await prisma.transaction.findMany({
  where: {
    isSettled: false,
    category: { notIn: ['Settlement', 'Payment'] },  // ← ADD THIS
  },
  orderBy: { id: 'desc' },
});
```

#### Definition of Done
- Settlement/Payment rows in `/history` list always show ✅.
- Settlement/Payment rows in the Dashboard "Latest Activity" feed always show ✅.
- `/settle` command watermark count and total **only** count non-Settlement, non-Payment rows.

---

### BUG-2 — Balance total mismatch between `/balance` and Menu view

#### What
The `/balance` command and the Menu "💰 Balance" button show different dollar amounts for the outstanding balance.

#### Why
The two call-sites use different calculation functions:

- `/balance` → `commandHandlers.handleBalance()` → `expenseService.getOutstandingBalanceMessage()` → **`calculateNetBalance()`** (correct: ignores Settlement/Payment by category, uses `bryanPercentage ?? 0.5`)
- Menu balance → `MenuCallbackHandler` line 66 → `expenseService.getDetailedBalanceMessage()` → **`calculateDetailedBalance()`** (buggy: queries `where: { isSettled: false }` without category filter)

`calculateDetailedBalance()` picks up Settlement rows. Those rows have `bryanPercentage: null`, which defaults to `0.5`, so they are counted as phantom 50/50 expenses, inflating both `bryanShare` and `hweiYeenShare`.

#### Fix

**Part A — `expenseService.ts` `calculateDetailedBalance()`**

Add a category filter to the Prisma query (around line 247):
```typescript
const transactions = await prisma.transaction.findMany({
  where: {
    isSettled: false,
    category: { notIn: ['Settlement', 'Payment'] },  // ← ADD THIS
  },
  include: { payer: true },
});
```

**Part B — `MenuCallbackHandler.ts` line 66**

Replace `getDetailedBalanceMessage()` with `getOutstandingBalanceMessage()` so both surfaces use the same canonical calculation:
```typescript
// BEFORE
const message = await this.expenseService.getDetailedBalanceMessage();

// AFTER
const message = await this.expenseService.getOutstandingBalanceMessage();
```

> **Do NOT** add intermediate `Math.round()` at any step — rounding must remain consistent with the existing `toFixed(2)` display calls.

#### Definition of Done
- `/balance` command and Menu balance button show **identical** dollar amounts.
- Settlement/Payment transactions do not contribute to the balance shown by either surface.
- `calculateDetailedBalance()` with a mix of real expenses + a Settlement row returns the same net figure as `calculateNetBalance()` for those same expenses.

---

### BUG-3 — Historical null-percent rows display 70/30 lie

#### What
Transaction detail cards and balance-impact lines for old transactions (recorded before the split-percentage feature was implemented) show `70% Bryan / 30% HY` instead of the truthful default `50% / 50%`.

#### Why
`historyService.ts` has hardcoded `?? 0.7` / `?? 0.3` fallbacks for null `bryanPercentage` / `hweiYeenPercentage`:

```typescript
// historyService.ts lines 192-193 (formatBalanceImpact)
const BRYAN_PCT = tx.bryanPercentage ?? 0.7;
const HY_PCT    = tx.hweiYeenPercentage ?? 0.3;

// historyService.ts lines 235-236 (formatTransactionDetail)
const bryanPercent = Math.round((tx.bryanPercentage ?? 0.7) * 100);
const hyPercent    = Math.round((tx.hweiYeenPercentage ?? 0.3) * 100);
```

The system's canonical default split is 50/50 (as evidenced by `calculateNetBalance()` using `?? 0.5`). The 70/30 display is incorrect and misleads HY.

#### Fix

In `historyService.ts`, change all four fallback literals from `0.7` / `0.3` to `0.5`:

```typescript
// formatBalanceImpact (lines 192-193)
const BRYAN_PCT = tx.bryanPercentage ?? 0.5;   // was 0.7
const HY_PCT    = tx.hweiYeenPercentage ?? 0.5; // was 0.3

// formatTransactionDetail (lines 235-236)
const bryanPercent = Math.round((tx.bryanPercentage ?? 0.5) * 100);  // was 0.7
const hyPercent    = Math.round((tx.hweiYeenPercentage ?? 0.5) * 100); // was 0.3
```

> **Note:** Do not change the storage layer. The `?? 0.5` fallback in `calculateNetBalance()` is already correct and stays unchanged.

#### Definition of Done
- A transaction with `bryanPercentage: null` and `hweiYeenPercentage: null` displays `50% Bryan / 50% HY` in the detail card.
- The balance-impact line for such a transaction uses 50/50 math.
- A transaction with explicit `bryanPercentage: 0.7` still displays `70% Bryan / 30% HY` (non-regression).

---

### FEAT-1 — Settle-up confirmation step before payment fires

#### What
Currently, pressing **💰 Pay $X** immediately records the payment with no confirmation step. HY wants a safety net so accidental taps don't fire a payment.

#### Why
The current `settle_pay_full_` callback in `SettleCallbackHandler` directly calls `expenseService.recordPayment()` without any intermediate prompt. A single misclick is irreversible.

#### Fix

**Two new callback prefixes are needed.** The prefix `settle_ok_` is chosen because it does **not** clash with the existing `settle_confirm_` prefix already handled in `SettleCallbackHandler.canHandle()`.

**Step 1 — Intercept `settle_pay_full_`**

Instead of recording the payment immediately, show a confirmation card:

```
✅ Confirm: Record payment of $X.XX to {recipientName}?

[Confirm ✅]  (callback: settle_ok_{amount})
[Cancel ❌]   (callback: settle_cancel)
```

Where `{recipientName}` is the name of the user being paid (the other person).

**Step 2 — New `settle_ok_` handler**

`settle_ok_{amount}` fires the original `recordPayment()` logic that was previously in `settle_pay_full_`.

**Step 3 — Update `canHandle()`**

```typescript
canHandle(data: string): boolean {
  return data === 'settle_up' ||
         data === 'menu_settle' ||
         data.startsWith('settle_confirm_') ||
         data.startsWith('settle_pay_full_') ||
         data.startsWith('settle_ok_') ||        // ← ADD THIS
         data === 'settle_cancel';
}
```

**Step 4 — `settle_cancel` already clears session state and shows "Settlement cancelled." No change needed for cancel handling.**

#### Definition of Done
- Pressing "💰 Pay $X" shows the confirmation card, does **not** record a payment.
- Pressing "Confirm ✅" in the confirmation card records the payment and returns to dashboard.
- Pressing "Cancel ❌" in the confirmation card shows "❌ Settlement cancelled." and does not record a payment.
- `canHandle()` returns `true` for `settle_ok_123.45`.
- `canHandle()` does **not** false-positive-match `settle_ok_` against `settle_confirm_` (non-regression).

---

### FEAT-2 — Dashboard header clarity

#### What
The dashboard header currently reads:

```
⚖️ To even out: $42.50 to Hwei Yeen
```

HY cannot tell at a glance who owes whom — the subject is missing. She wants clear subject–verb sentences.

#### Why
`bot.ts` `getRandomBalanceHeader()` (lines 332–335) constructs the string without a subject:

```typescript
if (balance.bryanOwes > 0) {
  return `⚖️ To even out: $${balance.bryanOwes.toFixed(2)} to ${hweiYeenName}`;
} else if (balance.hweiYeenOwes > 0) {
  return `⚖️ To even out: $${balance.hweiYeenOwes.toFixed(2)} to ${bryanName}`;
}
```

The function already calls `calculateNetBalance()` and has access to `netBalance.whoOwes`.

#### Fix

Replace the subject-less template strings with explicit debtor-named strings, using the `whoOwes` field already returned by `calculateNetBalance()`:

```typescript
// SETTLED
if (netBalance.netOutstanding === 0) {
  return 'All settled! ✅ Great teamwork.';
}

// WHO OWES
if (netBalance.whoOwes === 'HweiYeen') {
  return `⚖️ Hwei Yeen owes $${netBalance.netOutstanding.toFixed(2)} to Bryan`;
} else if (netBalance.whoOwes === 'Bryan') {
  return `⚖️ Bryan owes $${netBalance.netOutstanding.toFixed(2)} to Hwei Yeen`;
}

return '💰 Balance Status'; // fallback
```

> **Note:** `getUserNameByRole()` should still be used for the display name strings to remain config-driven. Replace literal `'Hwei Yeen'` / `'Bryan'` with `getUserNameByRole('HweiYeen')` / `getUserNameByRole('Bryan')`.

#### Definition of Done
- Dashboard header reads `"⚖️ Hwei Yeen owes $X.XX to Bryan"` when `whoOwes === 'HweiYeen'`.
- Dashboard header reads `"⚖️ Bryan owes $X.XX to Hwei Yeen"` when `whoOwes === 'Bryan'`.
- Dashboard header reads `"All settled! ✅ Great teamwork."` when `netOutstanding === 0`.
- Display names come from `getUserNameByRole()`, not hardcoded literals.

---

## 3. Acceptance Test Scenarios (Given / When / Then)

These feed directly into REX's test file. Suggested test file: `src/__tests__/hy-ux-sprint.test.ts`

---

### BUG-1 Scenarios

#### BUG-1-A: Settlement row maps to `settled` status in `getRecentTransactions()`
```
Given a transaction exists with category='Settlement' and isSettled=false
When  historyService.getRecentTransactions() is called
Then  the returned TransactionListItem.status is 'settled'
```

#### BUG-1-B: Payment row maps to `settled` status in `getRecentTransactions()`
```
Given a transaction exists with category='Payment' and isSettled=false
When  historyService.getRecentTransactions() is called
Then  the returned TransactionListItem.status is 'settled'
```

#### BUG-1-C: Regular unsettled row still maps to `unsettled`
```
Given a transaction exists with category='Food' and isSettled=false
When  historyService.getRecentTransactions() is called
Then  the returned TransactionListItem.status is 'unsettled'
```

#### BUG-1-D: Settlement row shows ✅ in list item format string
```
Given a TransactionListItem with status='settled' (derived from category='Settlement')
When  historyService.formatTransactionListItem(tx) is called
Then  the returned string contains '✅'
And   the returned string does NOT contain '🔴'
```

#### BUG-1-E: formatTransactionModel() gives 'settled' status for Settlement category
```
Given a raw Prisma transaction with category='Settlement', isSettled=false, and a payer object
When  historyService.formatTransactionModel(rawTx) is called
Then  the returned TransactionDetail.status is 'settled'
```

#### BUG-1-F: Watermark query in handleSettle excludes Settlement/Payment rows
```
Given the DB contains 3 expense transactions and 1 Settlement transaction (all isSettled=false)
When  commandHandlers.handleSettle() is called
Then  the displayed count is 3 (not 4)
And   the displayed total amount excludes the Settlement transaction amount
```

---

### BUG-2 Scenarios

#### BUG-2-A: calculateDetailedBalance() excludes Settlement/Payment rows
```
Given expense transactions totalling $100 (50/50 split, Bryan paid)
And   a Settlement transaction of $50 (category='Settlement', isSettled=false)
When  expenseService.calculateDetailedBalance() is called
Then  bryanPaid  = 100
And   hweiYeenPaid = 0
And   bryanShare = 50
And   hweiYeenShare = 50
And   bryanNet  = 50  (Bryan overpaid; HY owes him)
```
(i.e., the Settlement row does NOT contribute any phantom amounts)

#### BUG-2-B: calculateDetailedBalance() and calculateNetBalance() agree on net owed
```
Given the same set of transactions described in BUG-2-A
When  calculateDetailedBalance() and calculateNetBalance() are both called
Then  the net-owed figure derived from calculateDetailedBalance().bryanNet
      equals calculateNetBalance().hweiYeenOwes
```

#### BUG-2-C: Menu balance route uses getOutstandingBalanceMessage (integration)
```
Given expenseService.getOutstandingBalanceMessage is mocked to return '$42.50'
When  MenuCallbackHandler handles 'view_balance' (or equivalent menu balance trigger)
Then  the reply text contains '$42.50'
And   expenseService.getDetailedBalanceMessage is NOT called
```

---

### BUG-3 Scenarios

#### BUG-3-A: formatBalanceImpact uses 50/50 for null-percentage transactions
```
Given a TransactionDetail with bryanPercentage=null, hweiYeenPercentage=null,
      amount=100, payerRole='Bryan', status='unsettled'
When  (internal) formatBalanceImpact is called
Then  the returned string shows HY owes $50.00 (50% of $100)
And   the returned string does NOT contain '$70.00' or '$30.00'
```

#### BUG-3-B: formatTransactionDetail shows 50/50 split label for null-percentage row
```
Given a TransactionDetail with bryanPercentage=null, hweiYeenPercentage=null
When  historyService.formatTransactionDetail(tx) is called
Then  the output contains '50% Bryan'
And   the output contains '50% HY'
And   the output does NOT contain '70%'
And   the output does NOT contain '30%'
```

#### BUG-3-C: Explicit 70/30 split is still displayed correctly (non-regression)
```
Given a TransactionDetail with bryanPercentage=0.7, hweiYeenPercentage=0.3
When  historyService.formatTransactionDetail(tx) is called
Then  the output contains '70% Bryan' or '70%'
And   the output contains '30% HY' or '30%'
```

---

### FEAT-1 Scenarios

#### FEAT-1-A: canHandle() accepts settle_ok_ prefix
```
Given a SettleCallbackHandler instance
When  canHandle('settle_ok_42.50') is called
Then  the return value is true
```

#### FEAT-1-B: canHandle() still accepts settle_confirm_ prefix (non-regression)
```
Given a SettleCallbackHandler instance
When  canHandle('settle_confirm_999') is called
Then  the return value is true
```

#### FEAT-1-C: settle_pay_full_ shows confirmation card, does NOT record payment
```
Given a mocked expenseService.recordPayment
And   a valid Telegram ctx with user owing $42.50
When  SettleCallbackHandler.handle(ctx, 'settle_pay_full_42.50') is called
Then  ctx.editMessageText or ctx.reply is called with text containing 'Confirm'
And   the text contains '$42.50'
And   expenseService.recordPayment is NOT called
And   the inline keyboard contains a button with callback_data starting with 'settle_ok_'
And   the inline keyboard contains a button with callback_data 'settle_cancel'
```

#### FEAT-1-D: settle_ok_ records the payment
```
Given a mocked expenseService.recordPayment that resolves successfully
And   a valid Telegram ctx
When  SettleCallbackHandler.handle(ctx, 'settle_ok_42.50') is called
Then  expenseService.recordPayment is called with amount=42.50
And   the success message is displayed
```

#### FEAT-1-E: settle_cancel after confirmation card clears session, does not record payment
```
Given a mocked expenseService.recordPayment
And   a valid Telegram ctx with session.paymentMode=true
When  SettleCallbackHandler.handle(ctx, 'settle_cancel') is called
Then  expenseService.recordPayment is NOT called
And   session.paymentMode is falsy
And   ctx.editMessageText is called with text containing 'cancelled'
```

---

### FEAT-2 Scenarios

#### FEAT-2-A: Header when HY owes Bryan
```
Given calculateNetBalance() returns { whoOwes: 'HweiYeen', netOutstanding: 42.50 }
When  (internal) getRandomBalanceHeader() is called
Then  the returned string contains 'Hwei Yeen' (or getUserNameByRole('HweiYeen') value)
And   contains 'Bryan' (or getUserNameByRole('Bryan') value)
And   contains '$42.50'
And   does NOT contain 'To even out'
```

#### FEAT-2-B: Header when Bryan owes HY
```
Given calculateNetBalance() returns { whoOwes: 'Bryan', netOutstanding: 18.00 }
When  (internal) getRandomBalanceHeader() is called
Then  the returned string starts with '⚖️ Bryan owes' (or equivalent config-driven name)
And   contains '$18.00'
And   contains 'Hwei Yeen' (or getUserNameByRole('HweiYeen') value)
```

#### FEAT-2-C: Header when fully settled
```
Given calculateNetBalance() returns { netOutstanding: 0, whoOwes: null }
When  (internal) getRandomBalanceHeader() is called
Then  the returned string contains 'settled' or 'All settled'
And   does NOT contain '$0.00' as a debt amount (no "owes $0.00" text)
```

#### FEAT-2-D: Display names come from getUserNameByRole, not hardcoded strings
```
Given getUserNameByRole('HweiYeen') returns 'Wifey' (hypothetical config override)
And   calculateNetBalance() returns { whoOwes: 'HweiYeen', netOutstanding: 10.00 }
When  getRandomBalanceHeader() is called
Then  the returned string contains 'Wifey'
And   does NOT contain the hardcoded string 'Hwei Yeen'
```

---

## 4. Out-of-Scope

The following are explicitly **not** part of this sprint:

| Item | Reason |
|------|---------|
| Backfilling `isSettled=true` on existing Settlement rows in production DB | That's a one-time data migration, not a code change. Safe to defer — the code fix is category-based. |
| Adding a `transactionType` enum column to the Prisma schema | Already noted as future work in `expenseService.ts` line 785. Out of scope here. |
| Changing `recordPayment()` to set `isSettled: true` on the payment row | The `calculateNetBalance()` algorithm correctly ignores the flag and uses category. Changing the flag is risky refactor with no behaviour benefit. |
| Custom payment amount input (typing a partial amount) | Only full-balance settle-up flow is in scope. Partial payment via text input is unchanged. |
| Split percentage editing UI | Not requested by HY this sprint. |
| `USER_GUIDE.md` update | Per `.cursorrules`, docs updates are Phase 4 (production release) only. |
| Analytics/telemetry changes | Out of scope — the `#region agent log` fetch calls are a separate concern. |
| Removing debug `fetch` telemetry calls | Technical debt; deferred to a separate cleanup PR. |

---

## 5. Risk & Dependency Notes

### R1 — Category guard consistency (BUG-1 / BUG-2)
The category strings `'Settlement'` and `'Payment'` are string-literal constants used in three places across two files. If a third recording path ever uses a different string (e.g., `'settlement'`, `'payment'`), the guard will silently fail. **Recommendation:** BLADE should extract these into a shared constant `PAYMENT_CATEGORIES = ['Settlement', 'Payment'] as const` and import it into all relevant files.

### R2 — `settle_confirm_` legacy handler (FEAT-1)
The existing `settle_confirm_` flow is the old watermark-based "mark all as settled" path still reachable via the `/settle` command. The new `settle_ok_` handler is for the newer per-payment flow via `settle_pay_full_`. These two flows must remain independent — BLADE must not collapse them. REX should add a non-regression test asserting `canHandle('settle_confirm_999')` still returns `true` after the FEAT-1 change.

### R3 — Test isolation for bot.ts `getRandomBalanceHeader()` (FEAT-2)
`getRandomBalanceHeader()` is a private method of the `Bot` class. REX should either (a) test it via the public `getDashboardMessage()` method (which calls it), or (b) extract it into a pure exported function for easier unit testing. Option (b) is preferred for testability but should be a non-breaking refactor.

### R4 — `calculateDetailedBalance()` retained for legacy callers (BUG-2)
`getDetailedBalanceMessage()` still calls `calculateDetailedBalance()` internally. Even after the MenuCallbackHandler is patched, BLADE must also fix `calculateDetailedBalance()` itself (Part A of BUG-2 fix) in case any other callers exist. Do not remove `calculateDetailedBalance()` — it is exported and may be called from tests or other handlers.

### R5 — Floating-point consistency (BUG-2)
Do **not** add intermediate `Math.round()` calls. Rounding must stay at the final `toFixed(2)` display layer only, consistent with existing behaviour in `calculateNetBalance()` and the payment tolerance logic.

### R6 — Prisma `notIn` operator availability
Verify that the version of Prisma Client used in this repo supports the `notIn` filter operator. Run `npx prisma --version` — any Prisma ≥ 2.x supports `{ notIn: [...] }`. No migration is required; this is a query-level filter only.

---

## 6. File Change Summary for BLADE

| File | Change |
|------|--------|
| `src/services/historyService.ts` | (BUG-1) Add category guard in `getRecentTransactions()` map; add same guard in `formatTransactionModel()`. (BUG-3) Change 4× `?? 0.7`/`?? 0.3` literals to `?? 0.5`. |
| `src/services/expenseService.ts` | (BUG-2) Add `category: { notIn: ['Settlement', 'Payment'] }` to `calculateDetailedBalance()` Prisma query. |
| `src/handlers/commandHandlers.ts` | (BUG-1) Add `category: { notIn: ['Settlement', 'Payment'] }` to `handleSettle()` Prisma query. |
| `src/handlers/callbacks/MenuCallbackHandler.ts` | (BUG-2) Replace `getDetailedBalanceMessage()` call with `getOutstandingBalanceMessage()`. |
| `src/handlers/callbacks/SettleCallbackHandler.ts` | (FEAT-1) Add `settle_ok_` to `canHandle()`; refactor `settle_pay_full_` to show confirmation card; add `settle_ok_` handler that fires `recordPayment()`. |
| `src/bot.ts` | (FEAT-2) Rewrite balance-header template strings in `getRandomBalanceHeader()` to include debtor subject using `whoOwes` from `calculateNetBalance()`. |

---

## 7. Test File Guidance for REX

- **New test file:** `src/__tests__/hy-ux-sprint.test.ts`
- **Pattern:** Mirror `src/services/__tests__/historyService.test.ts` — use `vi.mock('../../lib/prisma', ...)` for DB, `vi.fn()` for expenseService, and `vi.mocked()` for mock resolution.
- **Each scenario above maps 1:1 to one `it(...)` block.** Use the scenario ID (e.g., `BUG-1-A`) as the test description suffix for easy traceability.
- **For FEAT-2 `getRandomBalanceHeader()`:** If the method stays private, test via `getDashboardMessage()` by mocking `calculateNetBalance()` and `getRecentTransactions()`, then asserting the returned string. If extracted to a standalone function, test it directly.
- **For FEAT-1 `SettleCallbackHandler`:** Mock `expenseService.recordPayment` with `vi.fn()` and assert call count. Mock `ctx.editMessageText` and `ctx.reply` and inspect the message text and inline keyboard.

---

*End of document. Questions → PAX. Implementation → BLADE. Tests → REX.*

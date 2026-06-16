# HY UX Sprint — Test Cases & First-Round Results

**Branch:** `staging-test` (= origin/main + fix/hy-ux-sprint)
**Test runner:** `node node_modules/.bin/vitest run`
**DB-backed e2e:** NOT runnable locally (no Docker/Postgres on this machine) — mock-based unit/integration only.

---

## Legend
- **TC** = Test Case ID
- Status: ✅ automated (mock test) · 🟡 manual-only (needs live bot/DB) · ⬜ pending

---

## BUG-1 — Settlement/Payment rows show ✅ not 🔴

| TC | Scenario (Given/When/Then) | Type |
|----|----------------------------|------|
| BUG1-1 | Given a Settlement tx with `isSettled=false`, When `getRecentTransactions()` maps it, Then status = `settled` | ✅ |
| BUG1-2 | Given a Payment tx with `isSettled=false`, When mapped, Then status = `settled` | ✅ |
| BUG1-3 | Given a regular Food expense with `isSettled=false`, When mapped, Then status = `unsettled` | ✅ |
| BUG1-4 | Given a regular expense with `isSettled=true`, When mapped, Then status = `settled` | ✅ |
| BUG1-5 | Given a Settlement tx, When viewed via `getTransactionById()` → `formatTransactionModel()`, Then detail card status = `settled` (not 🔴) | ✅ NEW |
| BUG1-6 | Given a Payment tx, When `formatTransactionModel()` runs, Then status = `settled` | ✅ NEW |
| BUG1-7 | Given mixed unsettled rows incl. a Settlement, When `/settle` watermark query runs, Then Settlement/Payment excluded from count+total | 🟡 (needs DB) |

## BUG-2 — Balance total no longer double-counts settlements

| TC | Scenario | Type |
|----|----------|------|
| BUG2-1 | Given a $100 Food (70/30) + $50 Settlement by Bryan, When `calculateDetailedBalance()`, Then bryanPaid=100 (not 150), totalSpending=100 | ✅ |
| BUG2-2 | Given only Settlement/Payment txs, When `calculateDetailedBalance()`, Then bryanPaid=0, hweiYeenPaid=0, totalSpending=0 | ✅ |
| BUG2-3 | Given the same dataset, When Menu balance button calls `getOutstandingBalanceMessage()`, Then it matches `/balance` | ✅ NEW |

## BUG-3 — Null-percent transactions display 50/50 not 70/30

| TC | Scenario | Type |
|----|----------|------|
| BUG3-1 | Given a tx with null percentages, When `formatTransactionDetail()`, Then split shows 50/50 (not 70/30) | ✅ |
| BUG3-2 | Given null-percent Bryan-paid $100, When balance impact computed, Then "HY owes Bryan $50" (not $30) | ✅ |
| BUG3-3 | Given explicit 70/30 tx, When formatted, Then still shows 70/30 (regression guard — explicit values untouched) | ✅ NEW |

## FEAT-1 — Settle-up confirmation step

| TC | Scenario | Type |
|----|----------|------|
| FEAT1-1 | `canHandle('settle_ok_551.07')` returns true | ✅ |
| FEAT1-2 | `canHandle('settle_pay_full_551.07')` returns true (unchanged) | ✅ |
| FEAT1-3 | Given tap [Pay $X], When `settle_pay_full_` handled, Then confirmation card shown, recordPayment NOT called | ✅ |
| FEAT1-4 | Given tap [✅ Yes, confirm], When `settle_ok_` handled, Then recordPayment IS called | ✅ |
| FEAT1-5 | Given successful `settle_ok_`, Then session paymentMode cleared | ✅ NEW |
| FEAT1-6 | Given `settle_ok_` with invalid amount (`settle_ok_abc`), Then error reply, recordPayment NOT called | ✅ NEW |
| FEAT1-7 | Given `settle_ok_` and recordPayment throws, Then graceful error reply (no crash) | ✅ NEW |
| FEAT1-8 | `settle_confirm_yes_...` does NOT collide with new flow (legacy prefix guard) | ✅ NEW |

## FEAT-2 — Dashboard header includes subject

| TC | Scenario | Type |
|----|----------|------|
| FEAT2-1 | whoOwes=HweiYeen → header contains both names + "owes" | ✅ (via helper) |
| FEAT2-2 | whoOwes=Bryan → header contains both names + "owes" | ✅ (via helper) |
| FEAT2-3 | netOutstanding=0 → header indicates settled | ✅ (via helper) |
| FEAT2-4 | whoOwes=HweiYeen → exact format `⚖️ Hwei Yeen owes $X to Bryan` | ✅ NEW (helper) |
| FEAT2-5 | Amount formatted to 2 decimals | ✅ NEW (helper) |

## ARIA copy verification (string-level)

| TC | Scenario | Type |
|----|----------|------|
| COPY-1 | Confirmation card text matches approved copy | ✅ NEW |
| COPY-2 | Success message includes amount + recipient + butler salutation | ✅ NEW |
| COPY-3 | Cancel message = "No rush — the ledger will wait. 📒" | ✅ NEW |
| COPY-4 | Confirm button = "✅ Yes, confirm", Cancel button = "❌ Never mind" | ✅ NEW |

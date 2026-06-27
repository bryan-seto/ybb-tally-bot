# Plan: Fix Prod Ghost Data + Test Isolation

**Date:** 2026-06-27  
**Status:** DRAFT — awaiting critique  
**Symptom:** HY owes Bryan SGD $2,336,032.97 on dashboard (should be ~$32K or less)

---

## Root Cause (confirmed via prod DB query)

7 QA/e2e test rows were written directly to the **production Supabase DB** during the 2026-06-25 QA harness run. The harness ran with `DATABASE_URL` pointing to prod instead of `TEST_DATABASE_URL` pointing to localhost.

| Row IDs | amountSGD | description | date |
|---------|-----------|-------------|------|
| 369, 412, 475, 535 | $999,999 × 4 | "yacht" | 2026-06-25 |
| 460, 524 | $516,171 × 2 | "" | 2026-06-25 |
| 450 | $50,000 | "Expense" | 2026-06-25 |

Total fake injection: **~$5,082,338 SGD**. Real balance underneath: ~$32,102 SGD.

All 7 rows have `originalAmount: null`, `fxRate: null`, `currency: SGD` — fingerprint of programmatic test fixture inserts, not real user input.

---

## File Strategy

### Files to modify
1. `src/server.ts` — add `/diag` endpoint (temp, gated by NODE_ENV, for future prod inspection without local DB access)
2. `src/services/expenseService.ts` — add sanity guard on `amountSGD` at write time
3. `src/config.ts` — export `IS_PROD` flag (already partially exists, needs hardening)

### Files to create
4. `src/__tests__/e2e/prod-db-guard.test.ts` — new test: assert `DATABASE_URL !== PROD_DATABASE_URL` before e2e suite runs
5. `prisma/migrations/` — no schema changes needed (deletion only)

---

## Step-by-Step Execution

### Step 1 — Data fix (prod deletion)
Delete the 7 ghost rows from production. No schema changes. No downtime.

```sql
DELETE FROM public.transactions WHERE id IN (369, 412, 450, 460, 475, 524, 535);
```

Verification after: re-run the SUM query, confirm total drops to ~$32K range and balance display returns to a plausible figure.

**Risk:** Low. These rows are unambiguous test artifacts (description "yacht", $999,999, created same day as last QA run, null FX fields). No legitimate expense looks like this.

### Step 2 — Test harness prod-URL guard
Add a `beforeAll` assertion in every e2e test file that throws immediately if `DATABASE_URL` contains the prod Supabase host.

```typescript
// src/__tests__/e2e/prod-db-guard.ts  (shared helper)
export function assertNotProdDB() {
  const url = process.env.DATABASE_URL ?? '';
  if (url.includes('supabase.com')) {
    throw new Error(
      'SAFETY: DATABASE_URL points to Supabase prod. E2E tests must use TEST_DATABASE_URL / localhost.'
    );
  }
}
```

Import and call `assertNotProdDB()` in `beforeAll` of all `*.test.ts` files under `src/__tests__/e2e/`.

### Step 3 — Expense amount sanity guard
In `expenseService.ts → createSmartExpense()`, before the DB write, reject implausibly large amounts:

```typescript
const SGD_SINGLE_EXPENSE_CEILING = 9_999; // SGD — no single shared expense should exceed this
if (amountSGD > SGD_SINGLE_EXPENSE_CEILING) {
  throw new Error(
    `Amount SGD ${amountSGD.toFixed(2)} exceeds the single-expense ceiling of $${SGD_SINGLE_EXPENSE_CEILING}. ` +
    `If this is correct, use the manual override.`
  );
}
```

Same guard in `recordAISavedTransactions()`.

### Step 4 — Temp `/diag` endpoint (optional, gated)
Add a read-only `/diag` GET route to `server.ts`, only active when `NODE_ENV !== 'production'` OR gated by a secret header. Returns top-10 rows by amountSGD + sum. Lets us debug prod DB from curl without needing a new terminal session. **Remove after confirmed stable.**

---

## Test Strategy

### New tests
- `prod-db-guard.test.ts` — RED: fails when `DATABASE_URL` contains `supabase.com`. GREEN: passes on localhost URL.
- `expenseService.ceiling.test.ts` — RED: `createSmartExpense()` throws on amount > $9,999. GREEN: passes on $9,998. Also: $9,999 boundary passes, $10,000 fails.

### Existing tests to verify (no regressions)
- `expenseService.test.ts` — all existing balance calculation tests must still pass
- `critical-flows.test.ts` — core flow tests must pass
- `fixes-2c44ba3.test.ts` — regression suite must pass

---

## Docs Check
`USER_GUIDE.md` — no update needed (internal guard, not user-visible).

---

## Deployment Sequence
1. Delete 7 prod rows (Step 1) — immediate, no deploy needed
2. Implement Steps 2–3 on `production` branch
3. Run full local test suite: `npm test`
4. Push to staging, smoke test balance display
5. Deploy to prod via Safety Dance (`.cursorrules` Phase 4)

---

## Open Questions for Critique
1. Is `$9,999 SGD` the right ceiling, or should it be higher (e.g. hotel bookings can legitimately be $654)?  
   → The hotel (`/579`, $654.64) is well under $9,999 — ceiling seems fine.  
   → But should there be a **per-category** ceiling instead of a flat one?
2. Should the `/diag` endpoint be built at all, or is `railway logs` + a local script sufficient?
3. Should Step 1 (deletion) be wrapped in a transaction with a pre-check (`WHERE amountSGD > 50000 AND date = '2026-06-25'`) for extra safety, rather than deleting by ID?
4. Do we need to audit whether any of the 7 rows affected `daily_stats` or `analytics` tables and need a compensating update?

-- diag_balance.sql
-- Prod DB diagnostic queries — paste into Supabase Studio SQL editor.
-- Table name: lowercase `transactions` (Prisma maps Transaction → transactions).
-- Run on: dashboard.supabase.com → project → SQL editor

-- ── 1. Top-10 by amountSGD (finds poison rows instantly) ────────────────────
SELECT
  id::text,
  "amountSGD",
  currency,
  "originalAmount",
  "fxRate"::text,
  SUBSTRING(description, 1, 60)          AS desc,
  "isSettled",
  TO_CHAR(date, 'YYYY-MM-DD')            AS txdate,
  TO_CHAR("createdAt", 'YYYY-MM-DD')     AS created
FROM transactions
ORDER BY "amountSGD" DESC
LIMIT 10;

-- ── 2. Summary stats (non-payment) ──────────────────────────────────────────
SELECT
  COUNT(*)::int                           AS rows,
  ROUND(SUM("amountSGD")::numeric, 2)    AS total_sgd,
  ROUND(MAX("amountSGD")::numeric, 2)    AS max_sgd,
  ROUND(AVG("amountSGD")::numeric, 2)    AS avg_sgd
FROM transactions
WHERE category NOT IN ('Settlement', 'Payment');

-- ── 3. FX-invariant poison rows (non-SGD with null/1:1 rate) ────────────────
-- These are the "FX silent 1:1 fallback" failure mode — see skill notes.
SELECT
  id::text,
  currency,
  "originalAmount",
  "fxRate"::text,
  "amountSGD",
  SUBSTRING(description, 1, 60)          AS desc,
  TO_CHAR(date, 'YYYY-MM-DD')            AS txdate
FROM transactions
WHERE currency != 'SGD'
  AND ("fxRate" IS NULL OR "fxRate" = 1)
ORDER BY "amountSGD" DESC;

-- ── 4. Verify ghost row fingerprint before deleting ───────────────────────────
-- Expected: 7 rows — ids 369, 412, 450, 460, 475, 524, 535
SELECT
  id::text,
  "amountSGD",
  "originalAmount",
  "fxRate"::text,
  SUBSTRING(description, 1, 60)          AS desc,
  TO_CHAR(date, 'YYYY-MM-DD')            AS txdate
FROM transactions
WHERE id IN (369, 412, 450, 460, 475, 524, 535);

-- ── 5. Transactional ghost-row deletion ──────────────────────────────────────
-- Prerequisites:
--   a) Export query 4 results to a local JSON file as backup (ghost-row-backup-2026-06-25.json)
--   b) Confirm exactly 7 rows returned by query 4 above
--   c) Inspect row count inside the transaction — ROLLBACK if not exactly 7
--
-- BEGIN;
--
-- DELETE FROM transactions
-- WHERE id IN (369, 412, 450, 460, 475, 524, 535)
--   AND "amountSGD" >= 50000          -- guardrail: never touch normal-amount rows
--   AND date::date = '2026-06-25';   -- guardrail: only the QA-run day
--
-- -- Inspect the DELETE count here before committing.
-- -- Expected: DELETE 7. If not exactly 7 → ROLLBACK.
--
-- COMMIT;

-- ── 6. Verify balance recovery after deletion ────────────────────────────────
-- Expected total: approx 32,102 SGD
SELECT ROUND(SUM("amountSGD")::numeric, 2) AS total_sgd
FROM transactions
WHERE category NOT IN ('Settlement', 'Payment');

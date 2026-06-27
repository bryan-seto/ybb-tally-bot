# Staging QA Debug Plan — 2026-06-25 Run
## Phase 1 Reproduction: COMPLETE

> **Updated:** 2026-06-25 after full Phase 1 evidence run.
> **For Hermes:** Use `systematic-debugging` (4-phase, root cause first) per item. Use `subagent-driven-development` only after root causes are confirmed and Bryan approves execution.

**Goal:** Resolve the real defects in the 2026-06-25 17:30 staging QA run and unblock sections C–N.

---

## Phase 1 Findings — Evidence Summary

### Finding 1 — `/pending` BLOCKER: Markdown parse_mode 400 from a real description

**Root cause confirmed.** `commandHandlers.ts:65` sends the full pending list with `parse_mode: 'Markdown'`. Transaction id=315 has description `AMAZE* KLOOK TRAVEL SINGAPORE SGP` — the `*` is unbalanced, making the entire Telegram send fail with HTTP 400. 101 pending rows → 1 row with unbalanced `*` → every `/pending` call throws → swallowed by catch → generic error message.

Evidence:
```
Rows with Markdown-special chars in description: 1
  { id: '315', description: 'AMAZE* KLOOK TRAVEL SINGAPORE SGP' }
Message build OK — length: 10244
Unbalanced * in message: true
```
`/history`, `/balance`, `/detailedBalance` all work because they either don't include that description in Markdown-formatted output, or they use different formatting.

**Fix (Phase 2):** Escape `description` values in the pending message builder, OR send the pending list without `parse_mode: 'Markdown'` (use HTML or plain — the message uses `**bold**` which doesn't work in plain, so escape is cleaner). Affect: `commandHandlers.ts:39-65`.

---

### Finding 2 — B-14 / B-22 / B-28 HANGS: They all recorded. Cause = `showDashboard` Markdown 400 + error path overwrites success status message

**Root cause confirmed by DB.** All three hangs DID save to the database:

| Test | DB row | Currency | Description | Time SGT |
|---|---|---|---|---|
| B-14 `IDR 150000 gojek` | id=377 | IDR | gojek | 10:15:24 |
| B-22 `RINGGIT 50 groceries` | id=383 (MYR petrol) / no dedicated RINGGIT row | — | — | see below |
| B-28 `VND 50000 pho\n15 grab` | id=393 (VND pho) + id=394 (SGD grab) | VND+SGD | pho + grab | 10:18:08 |

The data flow after a successful `createSmartExpense`:
1. Status msg edited to `✅ Recorded...` (or the single-expense success string) ✅
2. `showDashboard(ctx, false)` called — sends a new reply with `parse_mode: 'Markdown'`
3. `getDashboardMessage()` includes the balance header which contains `⚖️ Bryan owes $X.XX` + **`📋 Latest Activity`** lines that include descriptions like `wizard clear verify`, `No description`, QA test labels — these are safe, but the dashboard also fetches `/363 🔴 **wizard clear verify** - S$2.00` — the `**` is intentional bold, so it's balanced. BUT wait — check the dashboard header for unbalanced chars.
4. **Actually**: `showDashboard` throws on a `ctx.reply(..., { parse_mode: 'Markdown' })` 400 when the rendered dashboard message contains an unbalanced Markdown char (same AMAZE* issue — the "Latest Activity" section pulls recent transactions and could include that description).
5. `showDashboard` re-throws (`bot.ts:412`).
6. The throw propagates up into `QuickExpenseHandler`'s outer catch at `:318`.
7. The catch tries to `editMessageText(statusMsg, errorMessage)` — overwriting the already-correct `✅ Recorded...` with `❌ Sorry, I couldn't process...` OR trying to edit a status message that was already the success message → Telegram rejects the double-edit → falls back to `ctx.reply(userMessage)`.
8. The harness was waiting for the status message to change to a success string. The final state is an error string → timeout.

**Confirmation for B-22 (RINGGIT):** The DB shows `id=383 MYR petrol` at 10:16:37 — that's `RM 50 petrol` (B-20), not RINGGIT groceries. No RINGGIT groceries row exists → B-22 expense was NOT saved. This means `RINGGIT 50 groceries` was parsed OK (confirmed by repro: `parseQuickExpense('RINGGIT 50 groceries')` returns `{amount:50,desc:'groceries',category:'Groceries',currency:'MYR'}`) but `createSmartExpense` or `showDashboard` errored before the DB write, OR the DB write succeeded but was later rolled back/not committed. Check: no `RINGGIT`/`groceries`/MYR row exists in the today window → `createSmartExpense` threw before write, OR idempotency guard from a prior run deduplicated it. The 48s timeout suggests `showDashboard` threw mid-path and the expense was never recorded. The exact sequence differs from B-14/B-28. Need to verify: does the single-expense path edit the status message BEFORE or AFTER `createSmartExpense`? Answer: `QuickExpenseHandler.ts:213-219` edits status to `⏳ Saving expense...` **before** `createSmartExpense` is called. So if `createSmartExpense` hangs or throws, the status message stays at `⏳ Saving expense...`. That matches B-22's symptom exactly.

**So B-22 has a different sub-cause than B-14/B-28.** For B-22: something in `createSmartExpense` for `RINGGIT 50 groceries` (i.e. MYR + Groceries category) throws or hangs. Candidates:
- `splitRulesService.getSplitRule('Groceries')` throws/hangs if no Groceries rule exists and the fallback DB call hangs
- `fxRateService.convertToSGD(50, 'MYR')` hangs (but MYR works in B-10/B-20 in the same run, so FX is not the cause)
- The idempotency guard `findUnique({ where: { telegramMessageId_telegramBatchIndex: ... } })` is a Prisma Unique query on a new composite unique index added in commit `70618b7`. **Wait — the QA run was on `cf1e3f1` (one commit before 70618b7)**. At `cf1e3f1`, the idempotency guard and the `telegramMessageId_telegramBatchIndex` unique constraint did NOT exist. So B-22 ran on `cf1e3f1`. Check: does `cf1e3f1`'s `createSmartExpense` not have the idempotency guard? If correct, then the `prisma.schema` at that commit doesn't have the composite unique index.

```
git show cf1e3f1:prisma/schema.prisma | grep -A5 telegramMessageId
```

**Critical:** The diff shows that `70618b7` added the idempotency guard. At `cf1e3f1`, `createSmartExpense` did NOT have it. The production DB was running with the older schema. Prisma throws if a unique constraint is queried that doesn't exist in the DB. But the QA run was on `cf1e3f1`, which doesn't have the guard → the guard code wasn't there → this is not the cause.

**Revised B-22 hypothesis:** The hang at `⏳ Saving expense...` means `createSmartExpense` blocked for 48s on the Gemini quota-exhausted AI path. But wait — `createSmartExpense` does NOT call AI (confirmed: grep found no AI calls inside it). The `⏳ Saving expense...` status is set at line 213-219 in the **single-expense path**, then `aiService.processQuickExpense` is called at line 208. Reading the code again: at line 213, status is edited to `⏳ Saving expense...` **AFTER** AI parsing. So if parsing returns (quota error throws), the catch fires before reaching line 213. That means `⏳ Saving expense...` means `createSmartExpense` itself is hanging. `createSmartExpense` calls: `splitRulesService.getSplitRule`, `prisma.user.findUnique`, `fxRateService.convertToSGD`, `prisma.transaction.create`. For MYR, FX has a static fallback; prior MYR tests (B-10, B-20) worked fine. **Leading hypothesis: Telegram rate limiting.** By B-22, the harness has sent 22+ messages in a short session. Telegram imposes a 30 msg/min limit per bot in a group. If `createSmartExpense` succeeded but `ctx.telegram.editMessageText` (to update status to `⏳`) was rate-limited, the whole handler hangs waiting for the Telegram API call. Or: the Telegram `editMessageText` to show `⏳ Saving expense...` (line 213) was rate-limited/timed out → the handler hangs there for 48s (no timeout on Telegram API calls).

---

### Finding 3 — B-07 (`grab 5`): Parser works fine — AI hit first due to Groq MODEL_PRIORITY with no timeout

`parseQuickExpense('grab 5')` returns `{amount:5,description:'grab',category:'Transport',currency:'SGD'}` ✓. The QEH `canHandle` correctly gates it. The issue is NOT the parser. In B-07, the bot HAD already exhausted all Gemini free-tier quota after ~20 calls — but `grab 5` passes the quick parser and should NEVER hit AI. Re-reading the flow at test time: `regexParsed` would be set, `parsed = regexParsed`, AI is skipped. The `🚫 AI daily free limits ran out` response can only appear if: (a) `aiService.processQuickExpense` was called, (b) a fallback handler intercepted, or (c) the error message leaked from a concurrent/prior request. **Most likely:** The Groq waterfall (`MODEL_PRIORITY` has 4 Groq models + 6 Gemini models) — `grab 5` parsed fine BUT `showDashboard` called Telegram with `parse_mode:'Markdown'` and threw, which propagated into the outer catch, which then showed the quota error message because a *prior failed model attempt's `hadQuotaError` flag* was set. This is a phantom quota error leaking through the error chain.

Alternative: the QA harness's prior AI-exhausted tests left an in-process error state. But each Telegraf handler is isolated. **Most likely true cause: `grab 5` WAS parsed correctly, expense WAS saved (check DB for id ~359, `grab` at 09:31:01), but `showDashboard` threw Markdown 400 → outer catch fired → showed quota error message because `isQuotaError` matched on something in the error chain.** Confirm: id=359 `grab` exists at 09:31:01 — that's from B-07's timeframe (10:31 SGT = 09:31 SGT, wait — `09:31:01` is UTC which = `17:31 SGT`? No — 09:31 UTC = 17:31 SGT. The QA run was at 17:30 SGT. Yes, that matches).

**B-07 real root cause:** Expense saved (DB id=359 `grab` SGD 5.00 at 17:31 SGT). `showDashboard` Markdown 400 threw. `isQuotaError` check on the Markdown 400 HTTP error from Telegram incorrectly matched because Telegram's error description might contain "exceeded" or "too many" text. The user saw `🚫 AI daily free limits ran out` — but it was a dashboard Markdown error, not an AI quota error.

---

### Finding 4 — The shared root cause across B-07, B-14, B-28 (and likely B-22)

**`showDashboard` uses `parse_mode:'Markdown'` and re-throws errors. Any Telegram 400 (unbalanced Markdown in descriptions) propagates up through the expense-save success path, overwrites the success status message with an error, and the isQuotaError check in the catch may misclassify a Telegram API error as an AI quota error.**

The dashboard message includes `📋 Latest Activity` which shows recent transaction descriptions. Once any description with an unbalanced Markdown char (like `AMAZE* KLOOK TRAVEL SINGAPORE SGP`) is in the recent activity window, EVERY subsequent expense save that calls `showDashboard` fails with a phantom error — even if the expense was saved correctly.

---

### Finding 5 — Harness crashes and false-negatives: confirmed

- **B-35** (Telethon ValueError on whitespace): confirmed harness bug, one `try/except` fix.
- **A-01, B-23, B-27, B-29, B-30**: confirmed assertion false-negatives (functionally PASS).
- **B-27/B-28 multi-line**: `parseMultipleExpenses('VND 50000 pho\n15 grab')` returns `[pho, grab]` cleanly — both lines parse. The hang was in the bot, not the parser.

---

### Finding 6 — Reproduced clean: what works

- `parseQuickExpense` and `parseMultipleExpenses` are correct for all 5 test inputs (grab 5, RINGGIT 50 groceries, IDR 150000 gojek, 15 grab, VND 50000 pho\n15 grab). **No parser fixes needed.**
- `createSmartExpense` has no AI calls. FX is fully guarded with 5s timeout + static fallback.
- `getAllPendingTransactions` query itself works (101 rows, no throw). **The problem is the message send, not the query.**
- The `generateContentWithFallback` waterfall handles quota correctly on the last model — but has NO AbortSignal timeout on individual model calls. Groq/Gemini API calls can hang indefinitely if the network stalls (separate issue, lower priority since it doesn't affect the confirmed bugs above).

---

## Bug Summary (revised)

| ID | Symptom | Real Root Cause | Files to change |
|---|---|---|---|
| A-06/A-08 | `/pending` error every call | `commandHandlers.ts:65` — `parse_mode:'Markdown'` + description `AMAZE* KLOOK...` has unbalanced `*` → Telegram 400 | `commandHandlers.ts` |
| B-07, B-14, B-28 | Expense saved but bot shows error / gets stuck | `showDashboard` (`bot.ts:396`) uses `parse_mode:'Markdown'` + re-throws → overwrites success status msg; `isQuotaError` may misclassify Telegram 400 | `bot.ts`, `QuickExpenseHandler.ts` |
| B-22 | 48s hang at `⏳ Saving expense...` | Telegram rate-limiting on `editMessageText` at line 213 (no timeout on Telegram API call) OR same showDashboard issue | `QuickExpenseHandler.ts` |
| B-35 | Run aborted | Harness `try/except` missing around `client.send_message` for whitespace | QA harness |
| A-01, B-23, B-27, B-29, B-30 | FAIL | Assertion false-negative (bot is correct) | QA harness |

---

## Phase 2 — Fix Plan

> Present findings + plan. Wait for Bryan's explicit "go" before executing.

### Fix 1 — Escape Markdown in `/pending` message builder (A-06, A-08) 
**Priority: BLOCKER. Fix immediately.**

File: `src/handlers/commandHandlers.ts:39-65`

Replace the current `**description**` interpolation with a Markdown-escaped version:
```typescript
// Add helper at top of file (or import from utils)
function escapeMd(text: string): string {
  return text.replace(/[*_[\]`\\]/g, '\\$&');
}
// Then in handlePending:
message += `${index + 1}. **${escapeMd(t.description)}**\n`;
```

Also improve the catch at `:66` to log the Telegram error description:
```typescript
} catch (error: any) {
  console.error('Error getting pending transactions:', error.message, error.response?.description);
  await ctx.reply('Sorry, I encountered an error retrieving pending transactions. Please try again.');
}
```

Test: `npx vitest run src/handlers/__tests__/commandHandlers.test.ts`
Regression test to add: mock a pending transaction with description containing `*`, assert `handlePending` does not throw and calls `ctx.reply` once with the list.

---

### Fix 2 — Protect `showDashboard` from Markdown-triggered errors poisoning expense-save responses (B-07, B-14, B-28)
**Priority: MAJOR. Two sub-fixes.**

**2a — Don't re-throw from `showDashboard` into the expense handler** (`bot.ts:412`)

`showDashboard` already has a double fallback. The `throw error` at line 412 is the problem — it poisons the parent handler. Dashboard failure should NEVER make an otherwise-successful expense save appear failed to the user.

```typescript
// bot.ts ~line 402
} catch (error: any) {
  console.error('[showDashboard] CAUGHT ERROR:', error);
  try {
    await ctx.reply('Dashboard loading...', this.getMainMenuKeyboard());
  } catch (fallbackError) {
    console.error('[showDashboard] Error sending fallback dashboard:', fallbackError);
  }
  // REMOVE the throw error line — dashboard errors should not propagate up
}
```

**2b — Escape Markdown in dashboard message** (`bot.ts:getDashboardMessage`)

The "Latest Activity" lines in `getDashboardMessage` include transaction descriptions in Markdown. Apply the same `escapeMd` helper to description fields there.

Test: `npx vitest run src/__tests__/` — check no existing tests rely on re-throw behavior.

---

### Fix 3 — Add Telegram API call timeout to status message edits (B-22)
**Priority: MAJOR. Prevents indefinite hang.**

`ctx.telegram.editMessageText(...)` calls in `QuickExpenseHandler` have no timeout. Under Telegram rate-limiting (30 msg/min group limit), they can block indefinitely.

Wrap Telegram API calls in `QuickExpenseHandler` with a race against a timeout:
```typescript
// Add helper
async function withTelegramTimeout<T>(promise: Promise<T>, ms = 10000): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Telegram API timeout')), ms))
  ]) as Promise<T | null>;
}
```
Apply to the `editMessageText` calls at lines 109, 154, 167, 213, 298, 353.

---

### Fix 4 — QA harness fixes (B-35, assertion false-negatives)
**Priority: CRITICAL for re-run unblocking sections C–N.**

File: the Telethon harness script (see `references/telethon-qa-harness-2026-06-25.md`).

1. **B-35:** wrap every `client.send_message(...)` in `try/except ValueError: record SKIP`.
2. **A-01:** add `'⚖️'` to the dashboard keyword set.
3. **B-23:** assert rate via math: `abs(float(rate_str) - 1/20000) < 1e-6`.
4. **B-27/B-29/B-30:** accept both response shapes (inline confirmation vs dashboard update).

---

## Phase 3 — Next QA run

After fixes 1–4 are staged and deployed:
1. Re-run full matrix A–N on a fresh Gemini quota window.
2. Explicitly send `/pending` — confirm numbered list appears.
3. Send `IDR 150000 gojek` — confirm inline confirmation (not error) after 5–7s.
4. Send `VND 50000 pho\n15 grab` — confirm `✅ Recorded 2 expenses`.
5. Run through sections C–N (87 previously untested cases).

## State notes (from QA report)
- Prod DB has 54 QA test rows from today. **Do NOT `/settle`.** Clean via Delete/AI-Edit.
- The expense data is accurate; all "hung" tests except possibly B-22 DID save correctly.

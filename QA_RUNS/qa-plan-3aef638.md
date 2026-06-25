# QA Plan — Commit `3aef638` (Markdown escape + showDashboard no-rethrow + Telegram API timeout)

**Branch:** `production` · **Commit:** `3aef638` · **Author date:** 2026-06-25
**Plan author:** Hermes · **Plan date:** 2026-06-25
**Origin:** Root-cause fixes for the 2026-06-25 staging QA run (A-06/A-08 `/pending` blocker; B-07/B-14/B-22/B-28 hangs)

> **Scope of this plan:** verify the 4 fixes do what they claim, prove the original
> defects are gone, AND surface the *adjacent* code paths the fix did **not** touch
> but that share the same root cause. The fix is narrow; the bug class is wide.

---

## 0. Pre-flight (must pass before any functional testing)

| ID | Check | Command / Action | Pass criteria |
|----|-------|------------------|---------------|
| P-1 | Clean tree on `production` | `git status --porcelain` (empty), `git branch --show-current` | clean, on `production`, HEAD = `3aef638` |
| P-2 | Build compiles | `npm run build` (or `tsc --noEmit`) | 0 TS errors |
| P-3 | Full unit suite green | `npm test` | all tests pass incl. 6 new `escapeMd` cases (target: 367) |
| P-4 | Lint clean | `npm run lint` if configured | no new errors |
| P-5 | Staging deployed | Deploy `3aef638` to staging Railway; confirm `/start` responds | bot live on `3aef638` |
| P-6 | Fresh Gemini quota | Start run in a fresh quota window (00:00 UTC reset); budget ~20 AI calls | quota not pre-exhausted |
| P-7 | Session hygiene | `clear_session()` before each Telethon section; `mkdir -p QA_RUNS/` | no `manualAddMode` leak; report dir exists |

> ⚠️ **Safety:** staging dev bot points at **PROD Postgres**. Any edit/delete/settle
> mutates Bryan's real ledger. Run all mutation cases LAST, restore with compensating
> entries, confirm with Bryan before `/settle`.

---

## 1. Fix-by-fix verification

### Fix 1 — `escapeMd()` + `/pending` Markdown escaping
**Files:** `src/utils/markdownUtils.ts` (new), `src/handlers/commandHandlers.ts`
**Root cause:** description `AMAZE* KLOOK TRAVEL SINGAPORE SGP` (id=315) had an unbalanced
`*` → Telegram returned HTTP 400 on every `parse_mode:'Markdown'` send → `/pending` and
`/showAllPendingTransactions` both crashed (they share `handlePending`).

#### 1a. Unit — `escapeMd()` (already in `commandHandlers.test.ts`)
| ID | Input | Expected output |
|----|-------|-----------------|
| U-1 | `AMAZE* KLOOK TRAVEL SINGAPORE SGP` | `AMAZE\* KLOOK TRAVEL SINGAPORE SGP` |
| U-2 | `hello_world` | `hello\_world` |
| U-3 | `` `code` `` | `` \`code\` `` |
| U-4 | `[link](url)` | `\[link](url)` (v1 escapes `[` only, not `]`) |
| U-5 | `cold storage groceries`, `pho`, `20 coffee` | unchanged |
| U-6 | `back\slash` | `back\\slash` |

**Extra unit cases to ADD** (hardening — not yet covered):
| ID | Input | Expected | Why |
|----|-------|----------|-----|
| U-7 | `` (empty string) | `` | guard against empty desc |
| U-8 | `a*b_c` + `` ` `` + `[` combined | all 4 escaped, single pass | ordering / no double-escape |
| U-9 | `\*` (already-escaped input) | `\\\*` | confirms backslash-first ordering doesn't corrupt |
| U-10 | string with `]` `)` `~` `.` `-` | **unchanged** | proves v1 scope — does NOT over-escape like MarkdownV2 |

#### 1b. E2E — `/pending` and `/showAllPendingTransactions`
| ID | Pre-state | Input | Expected | Severity if fail |
|----|-----------|-------|----------|------------------|
| E-1 | id=315 `AMAZE*...` present in pending | `/pending` | renders full list incl. the AMAZE row with literal `*`; no HTTP 400; no "Sorry, I encountered an error" | **blocker** |
| E-2 | same | `/showAllPendingTransactions` | identical clean render (shares handler) | **blocker** |
| E-3 | seed a pending txn with desc `pho_30%_off` | `/pending` | underscore rendered literally, no broken italics | major |
| E-4 | seed desc with `` `backtick` `` and `[bracket` | `/pending` | literal chars, no code-block / link breakage | major |
| E-5 | all-safe descriptions only | `/pending` | unchanged formatting, bold titles intact | minor |
| E-6 | empty pending list | `/pending` | graceful "no pending" message, no crash | minor |

#### 1c. ⭐ Adjacency regression — the fix did NOT touch these (HIGH VALUE)
`escapeMd` is applied **only** in the `/pending` builder. The same `AMAZE*` row flows
unescaped through other `parse_mode:'Markdown'` render sites. Seed/keep id=315 and exercise each:

| ID | Surface | File (render site) | Action | Expected | Severity |
|----|---------|--------------------|--------|----------|----------|
| A-1 | Edit flow | `EditHandler.ts` | open edit on the AMAZE* txn | renders, no 400 | major |
| A-2 | Txn detail | `TransactionDetailHandler.ts` | tap the AMAZE* txn | renders, no 400 | major |
| A-3 | History | `HistoryCallbackHandler.ts` / `historyService.ts` | `/history` incl. AMAZE* | renders (historyService already escapes — confirm) | major |
| A-4 | Settle preview | `SettleCallbackHandler.ts` | `/settle` preview listing AMAZE* | renders, no 400 | major |
| A-5 | Quick confirm | `QuickExpenseHandler.ts` | record `5 a*b_c` expense | confirmation renders, no 400 | major |
| A-6 | Photo summary | `photoHandler.ts` | receipt → summary with `*`/`_` desc | renders; **check NOT over-escaped** (photoHandler uses its own MarkdownV2-style escaper — verify no stray `\` shown to user) | major |

> **Known gap to log regardless of pass/fail:** there are **two divergent escapers** —
> the shared `escapeMd` (Markdown v1: `* _ \` [ \`) and `photoHandler.ts`'s local one
> (MarkdownV2 set: also `. - ] ( ) ~ > # + = | { } !`). If any A-series site shows a raw
> 400 or visible stray backslashes, file as **major** and recommend consolidating on the
> shared helper.

---

### Fix 2 — `showDashboard` no-rethrow
**File:** `src/bot.ts:412` (removed `throw error`)
**Root cause:** a successful expense save was followed by `showDashboard`, which threw a
Markdown 400; the re-throw bubbled into the command handler and overwrote the success
status with ❌ (B-07 phantom quota, B-14/B-28 "saved but shows error", 48s waits).

| ID | Scenario | Input | Expected | Severity |
|----|----------|-------|----------|----------|
| D-1 | Happy path | `20 coffee` | expense confirmed; dashboard refreshes; no error | blocker |
| D-2 | Forced dashboard failure | record an expense while a pending txn contains a char that breaks the dashboard render (or temporarily inject a render error in staging) | expense **still confirmed**; fallback dashboard message OR silent log; **never** ❌ over a successful save | blocker |
| D-3 | Log assertion | tail dev-bot log during D-2 | logs `[showDashboard] Error...` but no re-throw / unhandled rejection upstream | major |
| D-4 | No regression on real failures | cause an actual DB save failure (if feasible in staging) | genuine save failure still surfaces ❌ to user (no-rethrow must NOT mask real save errors) | major |
| D-5 | Latency | D-1 timed | confirmation < ~5s; no 48s freeze (B-07/B-14/B-28 pattern gone) | major |

> **Watch for over-correction:** the no-rethrow is in `showDashboard`'s catch only.
> Confirm a genuinely failed *save* (not dashboard) still reports failure. D-4 is the
> guard against silently swallowing real errors.

---

### Fix 3 — `withTelegramTimeout(10s)` on `editMessageText`
**File:** `src/handlers/messageHandlers/QuickExpenseHandler.ts`
**Root cause:** under Telegram rate-limiting, `editMessageText` could hang indefinitely
at `⏳ Saving expense...` (B-22, RINGGIT 48s freeze). Now wrapped with a 10s race timeout.

| ID | Scenario | Input | Expected | Severity |
|----|----------|-------|----------|----------|
| T-1 | Single expense, normal | `RINGGIT 50 petrol` (MYR) | status edit completes; confirmation with FX line; no hang | blocker |
| T-2 | Batch multi-line | 3-line expense block | per-item `⏳ Saving expense N of 3...` edits all complete; final batch summary | major |
| T-3 | Timeout path (simulated) | force/observe a slow `editMessageText` (rate-limit window or mock in unit) | rejects after ~10s with `Telegram API timeout after 10000ms`; handler degrades gracefully; **expense still saved** | major |
| T-4 | Timer cleanup | repeated rapid sends | no leaked timers / unhandled rejections in log (`finally clearTimeout`) | minor |
| T-5 | Currency coverage | `RINGGIT`, `IDR`, `VND`, `JPY` one-liners | each parses + saves (parser already supports these; report previously misdiagnosed) | major |

#### 3a. Unit cases to ADD for `withTelegramTimeout` (currently untested)
| ID | Setup | Expected |
|----|-------|----------|
| U-11 | promise resolves before timeout | returns the resolved value; timer cleared |
| U-12 | promise rejects before timeout | propagates the original rejection; timer cleared |
| U-13 | promise never resolves | rejects with `Telegram API timeout after 10000ms` (use fake timers) |
| U-14 | resolve exactly at boundary | deterministic with fake timers; no unhandled rejection |

---

### Fix 4 — Harness skill reference update
**File:** `references/telethon-qa-harness-2026-06-25.md` (B-35 `continue`, status table)
| ID | Check | Pass criteria |
|----|-------|---------------|
| H-1 | B-35 whitespace send | runner wraps `send_message("   ")` in `try/except ValueError: continue` (NOT break) → sections C–N reached |
| H-2 | Status table accuracy | `/pending`, showDashboard, B-22 rows marked ✅ FIXED (3aef638) |
| H-3 | Full-run reachability | dry-run the harness to B-35 and confirm it proceeds past it (the 87-case unblock) |

---

## 2. Full E2E matrix (post-fix regression)

Run the standard staging matrix (`staging-qa-matrix.md` A–E) once pre-flight passes,
with these fix-driven priorities:

- **Section A (slash):** `/pending`, `/showAllPendingTransactions` are now the headline
  smoke check — fire them FIRST after deploy (E-1/E-2).
- **Section B (free-text):** FX one-liners (T-1/T-5) + multi-line batch (T-2) + partial-fail.
- **Section C (mutations, LAST):** edit/delete/settle — also doubles as adjacency A-1/A-4.
- **Section D (@mention AI):** budget-limited by Gemini quota; keep to ~5 calls.
- **Section E (edge):** gibberish, whitespace (B-35), very large number, negative.

**Harness mechanics:** reuse the verified runner recipe (clear_session each section,
category-picker auto-dismiss, expense-confirmation emoji formats, assertion
false-negative fixes for A-01/B-23/B-27/B-29/B-30). Recreate `/tmp/ybb_qa_runner.py`
from `telethon-qa-harness-2026-06-25.md` and **add the B-35 `try/except continue`**.

---

## 3. Exit criteria

**Ship-confirmed when:**
1. P-1…P-7 all green.
2. E-1, E-2, D-1, D-2, T-1 (all **blocker** rows) PASS.
3. No new unhandled rejections / stack leaks in dev-bot log across the full run.
4. Adjacency A-1…A-6 either PASS or are logged with severity + repro (a remaining
   unescaped 400 is a **known-issue**, not a release blocker for *this* commit, since
   `/pending` was the reported blocker — but it MUST be filed).
5. D-4 confirms real save failures still surface (no silent swallow).

**Roll back / hold if:** any blocker row fails, OR D-4 shows the no-rethrow masks a real
save failure, OR a fresh `/pending` 400 reappears.

---

## 4. Gaps & follow-ups to file (independent of pass/fail)

1. **Escaper divergence** — consolidate `photoHandler.ts`'s local escaper onto the shared
   `escapeMd`, or document why two are needed. (A-6)
2. **Incomplete escape coverage** — `escapeMd` applied only in `/pending`; Edit, Detail,
   Settle, History, QuickExpense-confirm render sites still interpolate raw descriptions
   into `parse_mode:'Markdown'`. Recommend a follow-up to route all of them through
   `escapeMd` (or switch to HTML parse mode globally). (A-1…A-5)
3. **No unit test for `withTelegramTimeout`** — add U-11…U-14.
4. **No test for showDashboard no-rethrow** — add a unit/integration case asserting a
   thrown dashboard error does not propagate past `showDashboard` (D-2/D-4 in code).

---

## 5. Reporting

Write run results to `QA_RUNS/staging-qa-<YYYY-MM-DD-HHMM>.md`.
Per case: Input / Expected / Actual (verbatim final bot text) / Latency / Notes.
Top summary: total/passed/failed/skipped, branch + commit (`3aef638`), failures by
severity (blocker/major/minor) with one-line repro. **QA reports only — do not auto-patch
during the run.** On a crash, pull the dev-bot log tail for the stack trace.

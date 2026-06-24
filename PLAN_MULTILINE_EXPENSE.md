# Plan: Multi-line / multi-item expense entry

## 1. The Context (the "Why")

**Bug (reproduced):** Wifey sent one Telegram message with two expenses, one per line:

```
Baby store 11.86
Stella dresses 38.38
```

The bot replied `❌ Sorry, I couldn't process that expense.`

**Root cause:** No multi-line support anywhere in the pipeline.
- `parseQuickExpense()` regexes are single-line (`^...$` + `.+` never cross `\n`) → returns `null` for any multi-line input.
- Falls back to `ai.processQuickExpense()`, whose prompt mandates **exactly one** expense object → can't represent two → validation throws → generic error in `QuickExpenseHandler` catch.

Each individual line parses correctly on its own (verified). So the fix is to **split the message into lines and record each line as its own expense**, before the existing single-expense logic runs.

**Goal:** A single message with N expense lines records N transactions and returns one consolidated confirmation.

## 2. File Strategy

| File | Change |
|---|---|
| `src/utils/quickExpenseParser.ts` | NEW exported `parseMultipleExpenses(text): ParsedExpense[]`. Splits on `\n`, trims, drops blank lines, runs existing `parseQuickExpense` per line. Returns all successfully-parsed lines (and a list of unparseable lines for the caller to report). |
| `src/handlers/messageHandlers/QuickExpenseHandler.ts` | In `handle()`: if the message has ≥2 non-empty lines, route through the multi-line path — loop `createSmartExpense` per parsed line, accumulate results, emit ONE summary message. Single-line behavior unchanged. `canHandle()` updated so a multi-line block where the **first** line looks like an expense is accepted. |
| `src/utils/__tests__/quickExpenseParser.multiline.test.ts` | NEW unit tests (TDD-first). |
| `src/handlers/messageHandlers/__tests__/QuickExpenseHandler.*.test.ts` | Add handler-level test: 2-line message → 2 `createSmartExpense` calls + 1 reply. (Use existing handler-mock pattern from `references/secret-masker-workarounds.md`.) |
| `USER_GUIDE.md` | Document multi-line entry — **Phase 4 only**, not staging. |

## 3. Test Strategy (TDD — RED first)

**Unit (`parseMultipleExpenses`):**
- `"Baby store 11.86\nStella dresses 38.38"` → 2 parsed expenses (the exact repro).
- Mixed valid/invalid: `"coffee 5\ngibberish\n10 grab"` → 2 parsed + 1 failed line `"gibberish"`.
- CRLF `\r\n` and blank lines between entries handled.
- Single line → array of length 1 (back-compat with existing single path).
- FX lines mixed with SGD: `"VND 50000 pho\nlunch 12"` → 2 parsed, correct currencies.

**Handler:**
- 2-line message → `createSmartExpense` called twice with correct args → one summary reply listing both + final balance.
- Partial failure → records the good lines, summary notes the skipped line(s); never the all-or-nothing generic error.

**Regression:** full existing `quickExpenseParser` + handler suites stay green (single-line, edit, FX, `@mention` guards untouched).

Run: `npm test src/utils/__tests__/quickExpenseParser.multiline.test.ts` then full `npm test`.

## 4. Design decisions to confirm before coding

1. **Split confirmation UX:** one consolidated message (`✅ Recorded 2 expenses … new balance …`) vs. one reply per line. Recommend **consolidated** (less chat spam, matches current single-confirmation feel).
2. **Partial failure policy:** record valid lines + report skipped ones (recommended) vs. reject the whole message. Recommend **partial-record**.
3. **Undo:** per-line Undo buttons, or one "Undo all (N)" button? Recommend **one Undo-all** for the batch (simpler; can split later).
4. **Out of scope:** the `(Wrong le)` 60/40 split-ratio concern is a separate ticket (split-rules config), not this parsing fix.

## 5. Docs Check

`USER_GUIDE.md` WILL need a short "Log several expenses at once" section — deferred to Phase 4 per `.cursorrules`.

---
**STOP — awaiting "Go" before writing code (per Phase 1 Think-First protocol).**

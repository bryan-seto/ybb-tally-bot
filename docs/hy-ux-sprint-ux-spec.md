# YBB Tally Bot — HY Experience Improvement Sprint
## UX Specification (ARIA — UX Design)

**Version:** 1.0  
**Date:** 2026-06-08  
**Sprint Owner:** ARIA (UX)  
**Status:** Draft for engineering review

---

## Baseline Audit: Current Copy & Tone

Before proposing changes, ARIA reviewed the live codebase. Key findings:

| Location | Current copy | Tone verdict |
|---|---|---|
| `bot.ts:333` | `⚖️ To even out: $X to HweiYeen` | **No subject** — unclear who owes |
| `bot.ts:335` | `⚖️ To even out: $X to Bryan` | **No subject** — unclear who owes |
| `bot.ts:320` | `🎉 All settled! Balance is $0.00` | Generic, lacks butler warmth |
| `SettleCallbackHandler:96` | `{User} owes $X to {Other}. How much would you like to pay?` | Functional but cold; no confirmation gate |
| `SettleCallbackHandler:166–170` | `✅ Payment of $X recorded. 🎉 All settled! Balance cleared.` | Flat; no persona |
| `SettleCallbackHandler:315` | `❌ Settlement cancelled.` | Terse; borderline rude |
| `historyService:210` | `✅ No debt created (Paid for own expense)` | Already correct ✅ |
| `historyService:215` | `` 🔴 👉 Bryan owes Hwei Yeen $X `` | Already correct ✅ |
| `expenseService:319` | `` 👉 HweiYeen owes Bryan: SGD $X `` | Language is correct but lacks butler persona |
| `vibeService` (cold start) | `❤️ Loading Love & Logic...` | Great — establishes warm/playful tone |
| `expenseService:327` | `✅ All settled!` | Fine as inline snippet |

**Bot persona reference (from brief):**  
`'At your service, Sir Bryan!'` / `'Madam Hwei Yeen'` — warm, slightly playful, butler-like. The bot knows both users by name.

---

## Tone Charter (applies to all copy in this sprint)

### Voice
- **Warm, unhurried butler** — thinks of both users' dignity at all times
- **Slightly playful** — allowed one light touch per message; never sarcastic
- **Exact and helpful** — never vague about money amounts or who owes whom
- **Personal** — uses "Sir Bryan" and "Madam Hwei Yeen" (or "Madam HY" in short contexts) rather than generic "User A"

### Tone DON'T list
> These patterns actively break the persona. Flag any future copy that hits these.

| ❌ Avoid | Why |
|---|---|
| `❌ Settlement cancelled.` | Sounds like an ATM error |
| `Outstanding balance: $X` | Clinical accounting language |
| `You owe $X` (bare, no name) | Impersonal; ambiguous in group chat |
| `Invalid amount. Please enter a number:` | Error-machine voice |
| `Sorry, I encountered an error` | Helpdesk-bot cliché |
| Exclamation marks on negative outcomes | Feels sarcastic: `❌ Payment failed!` → `❌ Payment failed.` |
| Generic `All settled!` with no flourish | Missed warmth opportunity on a happy path |
| Any message over 5 lines in a Telegram inline card | Gets clipped; test on mobile |

---

## FEAT-1: Settle-Up Confirmation Step

### Problem
The current `settle_pay_full_` path records the payment **immediately** on button tap. No confirmation gate exists. A fat-finger tap permanently alters the ledger.

### Goal
Insert a single confirmation card between intent (`[💰 Pay $X]`) and execution. Must feel effortless, not bureaucratic.

---

### FEAT-1 — UX Flow State Table

| State | User sees | Available next states |
|---|---|---|
| **S0: Pre-settle** | Dashboard with `⚖️` balance header and `[💸 Settle Up]` button | → S1 (taps Settle Up) |
| **S1: Settle prompt** | Settle card (who owes what, full-pay button) | → S2 (taps Pay $X), → Cancelled (taps ❌ Cancel) |
| **S2: Confirmation card** *(NEW)* | Confirmation card with amount + [✅ Confirm] + [❌ Never mind] | → S3 (taps Confirm), → S4 (taps Never mind) |
| **S3: Success** | Success message, then auto-refreshes to dashboard | → Dashboard |
| **S4: Cancelled** | Soft cancel message, buttons removed | → Dashboard (user re-initiates manually) |
| **S_ERR: Error** | Friendly error, invites retry | → S1 |

---

### FEAT-1 — Approved Copy

---

#### S1: Settle Prompt (existing message, minor copy polish)

```
{PayerName} owes {OtherName} SGD ${amount}.

💡 You only need to pay what you owe.
```

**Button row:**
| Button | callback_data |
|---|---|
| `💰 Pay $X.XX` | `settle_pay_full_{amount}` |
| `❌ Cancel` | `settle_cancel` |

> **Note:** The S1 prompt copy (`{User} owes $X to {Other}. How much would you like to pay?`) already passes the "who owes whom" test but uses `$` before currency name. Polish to `SGD $X.XX` for consistency with the rest of the app. The `💡` tip line is already present and should stay — it's useful first-time context.

---

#### S2: Confirmation Card *(NEW — APPROVED)*

> **Rendering context:** Telegram inline card, replaces S1 message via `editMessageText`. Max ~4 lines on mobile.

```
⚖️ Confirm payment of SGD ${amount.toFixed(2)} to {OtherName}?

This will be logged as a settlement.
```

**Button row:**
| Button | callback_data | Notes |
|---|---|---|
| `✅ Confirm` | `settle_confirm_pay_{amount}` | Primary action — left-aligned |
| `❌ Never mind` | `settle_cancel` | Secondary — avoids "Cancel" (less harsh) |

**Design notes:**
- Buttons must appear on **separate rows** (Telegram renders 2-col rows but the confirm/cancel pair looks cleaner stacked — prevents misclick on mobile)
- Amount shown to 2 decimal places always (never `$5` → always `$5.00`)
- `{OtherName}` is the receiving party's first name only (e.g., `Hwei Yeen`, not `Madam Hwei Yeen` in the dollar line — save the honorific for the success message)

---

#### S3: Success Message — Full Settlement *(APPROVED)*

```
🎉 Done! SGD ${amount.toFixed(2)} paid to {OtherName}.

The slate is clean, Sir Bryan — you're all square!
```

> **Variant for HY paying Bryan:**
```
🎉 Done! SGD ${amount.toFixed(2)} paid to {OtherName}.

The slate is clean, Madam Hwei Yeen — we're all square!
```

**Implementation note:** Detect `payerRole` from `ctx.from.id` to switch between `Sir Bryan` / `Madam Hwei Yeen`. The bot already knows both users by role.

---

#### S3: Success Message — Partial Payment *(APPROVED)*

```
✅ SGD ${amount.toFixed(2)} recorded. Remaining: SGD ${remaining.toFixed(2)} to {OtherName}.
```

> Keep short. No butler salutation on partial pay — it's a checkpoint, not a finish line.

---

#### S4: Cancel Message *(APPROVED)*

```
No rush — the ledger will wait. 📒
```

> Remove all buttons after this message (the current code already passes `{ inline_keyboard: [] }` — preserve that). No `❌` emoji — cancellation is fine, not an error.

---

#### S_ERR: Error Message *(APPROVED)*

```
⚠️ Something went sideways with that payment. Please try Settle Up again — the ledger hasn't changed.
```

> Replace current: `❌ ${errorMessage}`. The current copy leaks raw error strings to users.

---

### FEAT-1 — Rejected Variants

| Rejected copy | Reason |
|---|---|
| `Are you sure you want to pay $X?` | Too legalistic; sounds like a delete confirmation, not a payment |
| `✅ Confirm ✓ / ❌ Cancel ✗` | Double-symbol redundancy; confusing on small screens |
| `Payment confirmed! 🎊` | Exclamation mark + confetti on a money transaction feels frivolous |
| `Settle cancelled.` | Passive, sounds like a system log, not a human response |
| `Great! The debt is cleared!` | "Debt" is a loaded word; prefer "slate is clean" or "all square" |
| `Sir Bryan's payment of SGD $X has been recorded.` | Third-person on success message feels like a receipt, not a chat |

---

## FEAT-2: Dashboard Header Clarity

### Problem
Current header in `bot.ts:333–335`:
```
⚖️ To even out: $X to HweiYeen   ← who is paying? no subject
⚖️ To even out: $X to Bryan      ← same ambiguity
```
Both lines omit the **payer's name**. In a two-person group, the reader has to infer. HY specifically requested `"HY owes Bryan"` phrasing style.

### Goal
One-line header. Subject always explicit. Butler tone. No accounting jargon.

---

### FEAT-2 — Approved Copy (3 variants)

#### Variant A: HY owes Bryan *(APPROVED)*

```
⚖️ Madam HY owes Sir Bryan SGD $X.XX
```

> Short form `Madam HY` (not `Madam Hwei Yeen`) used here because the header is space-constrained. Full name in detail/confirmation flows only.

---

#### Variant B: Bryan owes HY *(APPROVED)*

```
⚖️ Sir Bryan owes Madam HY SGD $X.XX
```

---

#### Variant C: All settled *(APPROVED)*

```
🎉 All square — the ledger is clear.
```

> Replace current `🎉 All settled! Balance is $0.00`. The `$0.00` is redundant when we've just said "all settled." The phrase `all square` is warmer and more butler-appropriate than the accounting framing.

---

### FEAT-2 — Rejected Variants

| Rejected copy | Reason |
|---|---|
| `⚖️ To even out: $X to Bryan` | Current — fails the "subject" test |
| `Outstanding balance: $X` | Clinical; HY explicitly rejected this framing |
| `💰 HY owes Bryan $X (click to settle)` | Parenthetical instruction belongs in the button, not the header |
| `Balance: HY → Bryan $X` | Arrow notation reads like a code comment; not warm |
| `⚖️ Madam Hwei Yeen owes Sir Bryan SGD $X` | Full names make the header too long on mobile (>40 chars) |
| `🎉 Balance is $0.00. All settled!` | Dollar-zero confirmation of nothing is anticlimactic |

---

### FEAT-2 — Implementation Note

The rendering function is `getRandomBalanceHeader()` in `bot.ts:303`. Replace the two template strings at lines 333 and 335, and the settled string at line 320.

**Current (lines 333–336):**
```
if (balance.bryanOwes > 0) {
  return `⚖️ To even out: $${balance.bryanOwes.toFixed(2)} to ${hweiYeenName}`;
} else if (balance.hweiYeenOwes > 0) {
  return `⚖️ To even out: $${balance.hweiYeenOwes.toFixed(2)} to ${bryanName}`;
}
// line 320:
return '🎉 All settled! Balance is $0.00';
```

**Target copy (do not implement — UX spec only):**
```
HY owes Bryan:    ⚖️ Madam HY owes Sir Bryan SGD $X.XX
Bryan owes HY:    ⚖️ Sir Bryan owes Madam HY SGD $X.XX
Settled:          🎉 All square — the ledger is clear.
```

---

## BUG-3 Display Fix: Old Transactions with null Percentages

### Context
Transactions created before the split-percentage migration have `null` for `bryanPercentage` and `hweiYeenPercentage`. The current fallback in `historyService.ts:192–193` applies **70/30** as the default, which is wrong for pre-split-era expenses that should be **50/50**.

### Impact on Balance Impact line
When the fix is applied (null → 50/50 default), the `formatBalanceImpact()` logic in `historyService.ts:181` will recalculate correctly.

### ARIA confirms the two display states below are correct ✅

#### State 1: No debt created (self-paid expense)

```
✅ No debt created (Paid for own expense)
```

**When shown:** `Math.abs(bryanNet) < 0.01 && Math.abs(hyNet) < 0.01`  
i.e. a 100% expense by the person who is also 100% responsible.

**Verdict:** ✅ APPROVED — copy is already correct in `historyService.ts:210`. No change needed.

---

#### State 2: Debt exists

```
🔴 👉 {Payer} owes {Other} $X.XX
```

**Example outputs:**
```
🔴 👉 Bryan owes Hwei Yeen $12.50
🔴 👉 Hwei Yeen owes Bryan $8.00
```

**Verdict:** ✅ APPROVED — copy is already correct in `historyService.ts:215–217`. No change needed.

---

### BUG-3 — UX note on the 70/30 fallback
The bug lives in `historyService.ts:192–193`:
```typescript
const BRYAN_PCT = tx.bryanPercentage ?? 0.7; // Default fallback  ← BUG
const HY_PCT = tx.hweiYeenPercentage ?? 0.3; // Default fallback  ← BUG
```
The correct fix (for engineering, not UX): change `0.7` → `0.5` and `0.3` → `0.5`.  
No copy changes required — the existing display strings are already correct once the math is fixed.

---

## BUG-1 Display Fix: Settlement Rows — Success Message After Confirmation

### Context
After the new FEAT-1 confirmation step executes successfully, the success message replaces the confirmation card via `editMessageText`. This is the same message as FEAT-1 / S3.

### Confirmed copy (already specified above, repeated here for completeness)

#### Full settlement *(APPROVED)*
```
🎉 Done! SGD ${amount.toFixed(2)} paid to {OtherName}.

The slate is clean, Sir Bryan — you're all square!
```
*(or `Madam Hwei Yeen` variant)*

#### Partial settlement *(APPROVED)*
```
✅ SGD ${amount.toFixed(2)} recorded. Remaining: SGD ${remaining.toFixed(2)} to {OtherName}.
```

---

## General: Scoreboard Labels (`getDetailedBalanceMessage`)

### Current copy in `expenseService.ts:304–331`

```
💰 **Balance Summary**

Total Paid by Bryan (Unsettled): SGD $X
Total Paid by Hwei Yeen (Unsettled): SGD $X
Total Group Spending: SGD $X

**Split Calculation (XX/YY):**
Bryan's share (XX%): SGD $X
Hwei Yeen's share (YY%): SGD $X

👉 Hwei Yeen owes Bryan: SGD $X
```
*(or `👉 Bryan owes Hwei Yeen: SGD $X`, or `✅ All settled!`)*

### ARIA assessment

**The English is correct** — `getDetailedBalanceMessage()` already generates `X owes Y: SGD $Z` syntax, which matches HY's request for `"HY owes Bryan"` style over `"Outstanding balance: $X"`.

**However**, the **section headers** still use clinical language. Below are the targeted polishes.

---

### Scoreboard Labels — Approved Replacements

| Current label | Approved replacement | Change type |
|---|---|---|
| `💰 **Balance Summary**` | `📊 **The Tally**` | Header — warmer, shorter |
| `Total Paid by Bryan (Unsettled):` | `Bryan fronted:` | Line label — conversational |
| `Total Paid by Hwei Yeen (Unsettled):` | `Hwei Yeen fronted:` | Line label — conversational |
| `Total Group Spending:` | `Together spent:` | Line label — inclusive phrasing |
| `**Split Calculation (XX/YY):**` | `**Their shares (XX/YY):**` | Section header — removes "Calculation" |
| `Bryan's share (XX%):` | `Bryan's share (XX%):` | ✅ No change needed |
| `Hwei Yeen's share (YY%):` | `Hwei Yeen's share (YY%):` | ✅ No change needed |
| `👉 Hwei Yeen owes Bryan: SGD $X` | `👉 Hwei Yeen owes Bryan SGD $X` | Remove colon — reads more naturally as a sentence |
| `👉 Bryan owes Hwei Yeen: SGD $X` | `👉 Bryan owes Hwei Yeen SGD $X` | Same — remove colon |
| `✅ All settled!` | `✅ All square — nothing owed.` | Warmer close |

---

### Scoreboard — Full Approved Template *(APPROVED)*

```
📊 **The Tally**

Bryan fronted: SGD $X.XX
Hwei Yeen fronted: SGD $X.XX
Together spent: SGD $X.XX

**Their shares (XX/YY):**
Bryan's share (XX%): SGD $X.XX
Hwei Yeen's share (YY%): SGD $X.XX

👉 Hwei Yeen owes Bryan SGD $X.XX
```
*(or `👉 Bryan owes Hwei Yeen SGD $X.XX` / `✅ All square — nothing owed.`)*

---

### Scoreboard — Rejected Variants

| Rejected copy | Reason |
|---|---|
| `Outstanding balance: $X` | Exactly what HY asked to avoid |
| `Net position: $X` | Finance jargon |
| `Bryan has paid more than his share` | Vague — doesn't say how much |
| `📊 Monthly Report` | Misleading — this isn't month-scoped |
| `💰 Balance Summary` (current) | "Summary" is fine but `The Tally` is more on-brand |
| Colon after `owes` (`owes Bryan: $X`) | The colon fragments what should read as one sentence |

---

## Interaction Design Notes (non-copy)

### Button placement rules
- **Confirm/Cancel pairs:** Always stack vertically (separate rows), never side-by-side. Prevents accidental confirmation on mobile.
- **Destructive secondary action** (cancel, undo): Always the bottom button. Never left of the primary.
- **Emoji in button labels:** Use one emoji per button, at the start. Avoid text-only buttons for key actions (less scannable in Telegram).

### Message length guidelines
| Message type | Max lines | Rationale |
|---|---|---|
| Dashboard header | 1 line | Shows above activity feed; must not dominate |
| Confirmation card | 2–3 lines + 2 buttons | Fits above the keyboard on iPhone SE |
| Success/cancel message | 2–3 lines | Read-and-done; no action needed |
| Detailed balance (scoreboard) | 10–12 lines | User explicitly requested it; fine to be longer |
| Error message | 1–2 lines | No one reads error walls; keep it actionable |

### Replace `❌` with plain text for non-error cancellations
- `❌` is a **warning/error** symbol. Using it on a voluntary cancel (`❌ Settlement cancelled.`) trains users to feel they did something wrong.
- Approved: Use `` 📒 ``, `🤝`, or plain text for user-initiated cancellations.

---

## Summary: All New/Changed Copy (Quick Reference)

| ID | Location | Old | New | Status |
|---|---|---|---|---|
| FEAT-2-A | Dashboard header (HY owes Bryan) | `⚖️ To even out: $X to Bryan` | `⚖️ Madam HY owes Sir Bryan SGD $X.XX` | **APPROVED** |
| FEAT-2-B | Dashboard header (Bryan owes HY) | `⚖️ To even out: $X to HweiYeen` | `⚖️ Sir Bryan owes Madam HY SGD $X.XX` | **APPROVED** |
| FEAT-2-C | Dashboard header (settled) | `🎉 All settled! Balance is $0.00` | `🎉 All square — the ledger is clear.` | **APPROVED** |
| FEAT-1-S2 | Confirmation card body (NEW) | *(none — new state)* | `⚖️ Confirm payment of SGD $X.XX to {Name}?\n\nThis will be logged as a settlement.` | **APPROVED** |
| FEAT-1-S2-BTN1 | Confirm button | *(none)* | `✅ Confirm` | **APPROVED** |
| FEAT-1-S2-BTN2 | Never mind button | *(none)* | `❌ Never mind` | **APPROVED** |
| FEAT-1-S3a | Success (full settle, Bryan) | `✅ Payment of $X recorded. 🎉 All settled! Balance cleared.` | `🎉 Done! SGD $X.XX paid to {Name}.\n\nThe slate is clean, Sir Bryan — you're all square!` | **APPROVED** |
| FEAT-1-S3b | Success (full settle, HY) | same | `🎉 Done! SGD $X.XX paid to {Name}.\n\nThe slate is clean, Madam Hwei Yeen — we're all square!` | **APPROVED** |
| FEAT-1-S3c | Success (partial settle) | `✅ Payment of $X recorded.\n\nRemaining balance: $X to {Name}.` | `✅ SGD $X.XX recorded. Remaining: SGD $X.XX to {Name}.` | **APPROVED** |
| FEAT-1-S4 | Cancel message | `❌ Settlement cancelled.` | `No rush — the ledger will wait. 📒` | **APPROVED** |
| FEAT-1-ERR | Error message | `❌ ${errorMessage}` (raw) | `⚠️ Something went sideways with that payment. Please try Settle Up again — the ledger hasn't changed.` | **APPROVED** |
| BUG-3-state1 | Balance impact, no debt | `✅ No debt created (Paid for own expense)` | *(unchanged — already correct)* | **CONFIRMED ✅** |
| BUG-3-state2 | Balance impact, debt exists | `🔴 👉 {Payer} owes {Other} $X` | *(unchanged — already correct)* | **CONFIRMED ✅** |
| SCORE-HDR | Scoreboard header | `💰 **Balance Summary**` | `📊 **The Tally**` | **APPROVED** |
| SCORE-FRONTED-A | Scoreboard line | `Total Paid by Bryan (Unsettled):` | `Bryan fronted:` | **APPROVED** |
| SCORE-FRONTED-B | Scoreboard line | `Total Paid by Hwei Yeen (Unsettled):` | `Hwei Yeen fronted:` | **APPROVED** |
| SCORE-TOGETHER | Scoreboard line | `Total Group Spending:` | `Together spent:` | **APPROVED** |
| SCORE-THEIR | Scoreboard section | `**Split Calculation (XX/YY):**` | `**Their shares (XX/YY):**` | **APPROVED** |
| SCORE-OWES-A | Scoreboard result | `👉 Hwei Yeen owes Bryan: SGD $X` | `👉 Hwei Yeen owes Bryan SGD $X` | **APPROVED** |
| SCORE-OWES-B | Scoreboard result | `👉 Bryan owes Hwei Yeen: SGD $X` | `👉 Bryan owes Hwei Yeen SGD $X` | **APPROVED** |
| SCORE-SETTLED | Scoreboard result | `✅ All settled!` | `✅ All square — nothing owed.` | **APPROVED** |

---

*Spec written by ARIA — UX. Engineering should not alter APPROVED copy without a UX review cycle.*

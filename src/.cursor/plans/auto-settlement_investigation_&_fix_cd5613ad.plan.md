---
name: Auto-Settlement Investigation & Fix
overview: Investigate why transactions are being automatically settled when they shouldn't be. The root cause appears to be the AI service misinterpreting user messages as settlement commands. We need to add logging, confirm the root cause, and implement both short-term and long-term fixes.
todos:
  - id: create-investigation-script
    content: Create scripts/investigate-settlements.ts to query database for settled transactions, timestamps, and system logs
    status: pending
  - id: run-investigation
    content: Run the investigation script to retrieve actual data showing when and how transactions were settled
    status: pending
    dependencies:
      - create-investigation-script
  - id: analyze-data
    content: Analyze retrieved data to confirm root cause (AI, batch command, bug, etc.)
    status: pending
    dependencies:
      - run-investigation
  - id: add-logging
    content: Add comprehensive logging for all settlement actions (AI, manual, command) in messageHandlers.ts, TransactionCallbackHandler.ts, and SettleCallbackHandler.ts
    status: pending
    dependencies:
      - analyze-data
  - id: investigate-recent
    content: Query database to identify recently settled transactions and cross-reference with timestamps to understand when auto-settlement occurred
    status: pending
  - id: add-confirmation-ai
    content: "Add confirmation prompt when AI returns UPDATE_STATUS with isSettled: true in executeCorrectionActions()"
    status: pending
    dependencies:
      - add-logging
  - id: tighten-ai-prompt
    content: Tighten AI prompt in services/ai.ts to require explicit settlement phrases and add negative examples
    status: pending
    dependencies:
      - investigate-recent
  - id: add-safety-checks
    content: Add safety checks in executeCorrectionActions() to prevent settling already-settled transactions and log all actions
    status: pending
    dependencies:
      - add-logging
  - id: test-fixes
    content: Test various user messages to ensure false positives are eliminated while legitimate settlement commands still work
    status: pending
    dependencies:
      - add-confirmation-ai
      - tighten-ai-prompt
      - add-safety-checks
---

# Auto-Settlement Investi

gation & Fix Plan

## Problem Statement

Transactions are being automatically settled without explicit user intent. This is causing financial tracking issues.

## Investigation Findings

### Current Settlement Mechanisms

1. **Manual Settlement** (`SettleCallbackHandler.ts`):

- `settle_up` / `menu_settle` → Shows balance → `settle_confirm` → Settles all
- Requires explicit confirmation button press

2. **Individual Transaction Settlement** (`TransactionCallbackHandler.ts`):

- `tx_settle_{id}` → Settles single transaction
- No confirmation required (immediate action)

3. **AI Correction Service** (`services/ai.ts` + `handlers/messageHandlers.ts`):

- Processes natural language commands via `processCorrection()`
- Can interpret "settle this", "mark as settled" as `UPDATE_STATUS` with `isSettled: true`
- **This is the most likely culprit** - AI may be misinterpreting user messages

4. **Command Handler** (`handlers/commandHandlers.ts`):

- `/settle` command → Settles all transactions immediately
- Requires explicit command

### Database Schema

- `isSettled` field defaults to `false` in `prisma/schema.prisma` (line 31)
- Transactions should be created as unsettled by default

### Key Code Locations

- AI prompt for settlement: `services/ai.ts` lines 372-373, 390-391
- AI action execution: `handlers/messageHandlers.ts` lines 495-505
- Transaction creation: `services/expenseService.ts` lines 518-532 (no `isSettled` set, uses default `false`)

## Root Cause Hypothesis

**PRIMARY SUSPECT: AI Service Over-Interpretation**The AI service (`processCorrection`) is likely misinterpreting user messages as settlement commands. Possible triggers:

1. Users mentioning words like "settled", "paid", "done" in context of transactions
2. AI prompt being too permissive in detecting settlement intent
3. No confirmation required when AI decides to settle via `UPDATE_STATUS` action
4. AI may be settling transactions when users are just viewing/asking about them

## Investigation Steps - DATA RETRIEVAL FIRST

### Step 1: Create Investigation Script (IMMEDIATE)

**File**: `scripts/investigate-settlements.ts`

- Query all settled transactions with their `updatedAt` timestamps
- Show transaction ID, description, amount, date created, date last updated
- Identify transactions that were settled recently (last 7 days)
- Query system logs for any settlement-related events
- Check if there's a pattern (all at once, individual, specific time)
- Output results to console and optionally save to file

### Step 2: Run Investigation Script

- Execute the script to retrieve actual data
- Analyze results to identify:
- When transactions were settled (timestamps)
- If they were settled in batches or individually
- If there are system log entries related to settlements
- Which transactions are affected

### Step 3: Analyze Root Cause from Data

- Based on retrieved data, determine:
- Was it a batch settlement (all at once)?
- Was it individual transactions over time?
- Are there corresponding system logs?
- What was the trigger (command, callback, AI)?

### Step 4: Add Logging (After Root Cause Confirmed)

- Add detailed logging in `handlers/messageHandlers.ts` `executeCorrectionActions()` when `UPDATE_STATUS` action is executed
- Log: user message, AI interpretation, transaction IDs affected, timestamp
- Add logging in `TransactionCallbackHandler.ts` for individual settlements
- Log to both console and database (`SystemLog` table)

### Step 5: Test AI Interpretation (If AI is culprit)

- Test various user messages that might trigger false positives
- Check if AI is being too aggressive in settlement detection

## Short-Term Fixes

### Fix 1: Add Confirmation for AI Settlement Actions

**File**: `handlers/messageHandlers.ts`

- When AI returns `UPDATE_STATUS` with `isSettled: true`, require user confirmation
- Show a confirmation prompt before executing settlement
- Only auto-execute if confidence is "high" AND explicit settlement keywords detected

### Fix 2: Tighten AI Prompt

**File**: `services/ai.ts` (lines 372-373, 390-391)

- Make settlement detection more strict
- Require explicit phrases: "settle this transaction", "mark as paid", "mark as settled"
- Ignore ambiguous phrases like "this is settled", "already settled", "settled up"
- Add negative examples to prompt

### Fix 3: Add Safety Check

**File**: `handlers/messageHandlers.ts` `executeCorrectionActions()`

- Before executing `UPDATE_STATUS` with `isSettled: true`, check:
- If transaction is already settled, skip
- If user didn't explicitly request settlement, require confirmation
- Log all settlement actions for audit trail

## Long-Term Fixes

### Fix 1: Settlement Confirmation Flow

- Create a dedicated confirmation handler for AI-initiated settlements
- Show transaction details before confirming
- Allow batch confirmation if multiple transactions affected

### Fix 2: Improve AI Prompt Engineering

- Add more context about when NOT to settle
- Include examples of false positives to avoid
- Add confidence scoring for settlement actions
- Consider requiring explicit transaction ID for settlement

### Fix 3: Audit Trail

- Create a `SettlementLog` table to track all settlements
- Record: transaction ID, user ID, method (manual/AI/command), timestamp, original message (if AI)
- Add query endpoint to review settlement history

### Fix 4: User Feedback Loop

- After AI settlement, ask user to confirm if it was correct
- Use feedback to improve AI prompt
- Track false positive rate

## Implementation Priority

1. **IMMEDIATE**: Create and run investigation script to retrieve actual data from database

- This will show us exactly what happened and when
- Will identify the root cause before making any fixes

2. **AFTER DATA RETRIEVAL**: Based on findings, implement appropriate fixes

- If AI: Add confirmation + tighten prompt
- If batch command: Add confirmation
- If bug: Fix the bug

3. **SHORT-TERM**: Add logging to prevent future issues
4. **MEDIUM-TERM**: Implement audit trail
5. **LONG-TERM**: Improve AI with feedback loop

## Testing Plan

1. Test various user messages that might trigger false settlement
2. Verify confirmation flow works correctly
3. Test that legitimate settlement commands still work
4. Verify logging captures all settlement events
5. Test edge cases (already settled transactions, multiple transactions)

## Risk Assessment

- **Low Risk**: Adding logging (read-only)
- **Medium Risk**: Adding confirmation (may break existing flows if not careful)
- **Low Risk**: Tightening AI prompt (should reduce false positives)

## Rollback Plan

- Keep original AI prompt as backup
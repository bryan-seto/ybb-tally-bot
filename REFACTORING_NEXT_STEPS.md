# Next Steps: Handler Refactoring (Post-Prod Deployment)

## Current Status ✅

**Successfully Extracted (Ready for Prod):**
- ✅ `AICorrectionHandler` - Handles `@bot ...` tagged messages
- ✅ `EditHandler` - Handles edit commands, AI edit mode, transaction edit mode
- ✅ `TransactionDetailHandler` - Handles transaction ID commands (`/77`)
- ✅ `QuickExpenseHandler` - Handles quick expense parsing (`130 groceries`)
- ✅ `CorrectionActionExecutor` - Shared utility for executing AI correction actions
- ✅ `SessionManager` - Centralized session state management
- ✅ `MessageRouter` - Routes messages to appropriate handlers

**Tests Status:**
- ✅ 21/24 test files passing
- ✅ 234/240 tests passing
- ✅ All critical flows passing (E2E tests)
- ⚠️ 6 test failures are unrelated to refactor (Prisma mocking issues)

---

## Remaining Handlers to Extract

### Priority Order (Recommended Extraction Sequence)

#### 1. **ManualAddHandler** ⭐ (Next)
**Location**: `handlers/messageHandlers.ts` line ~129-155  
**Complexity**: Low (~27 lines)  
**State Management**: Multi-step flow with session flags

**What it handles:**
- Manual expense entry flow
- Session state: `session.manualAddMode`, `session.manualAddStep`
- Steps: `description` → `amount` → `category` (via callback)

**Extraction Notes:**
- Depends on session state: `session.manualAddMode`, `session.manualAddStep`
- Uses `session.manualDescription`, `session.manualAmount`
- Category selection is done via callback (not in this handler)
- Simple state machine pattern

**Priority Justification:**
- Commonly used feature
- Simpler than RecurringHandler
- Good practice for multi-step flow extraction

---

#### 2. **RecurringHandler** ⭐⭐
**Location**: `handlers/messageHandlers.ts` line ~157-193  
**Complexity**: Medium (~37 lines)  
**State Management**: Multi-step flow with nested data object

**What it handles:**
- Recurring expense setup flow
- Session state: `session.recurringMode`, `session.recurringStep`
- Data: `session.recurringData` (object with description, amount, day)
- Steps: `description` → `amount` → `day` → `payer` (via callback)

**Extraction Notes:**
- Depends on session state: `session.recurringMode`, `session.recurringStep`
- Uses `session.recurringData` (object structure)
- Payer selection is done via callback (not in this handler)
- Similar pattern to ManualAddHandler but with nested data

**Priority Justification:**
- Similar complexity to ManualAddHandler
- Can follow same pattern established in ManualAddHandler
- Less commonly used than manual add

---

#### 3. **SplitSettingsHandler** ⚠️ (Optional - Consider as Helper)
**Location**: `handlers/messageHandlers.ts` line ~199-240  
**Complexity**: Low (~42 lines)  
**State Management**: Single input mode

**What it handles:**
- Custom split percentage input
- Session state: `session.waitingForSplitInput`, `session.splitSettingsCategory`
- Validates 0-100 integer input
- Updates split rules via `SplitRulesService`

**Extraction Notes:**
- Very specific use case (split settings configuration)
- Could be kept as a helper method in `MessageHandlers`
- OR extracted as a handler if we want consistency
- Depends on `SplitRulesService`

**Recommendation:**
- Extract if we want 100% consistency (all handlers follow same pattern)
- OR keep as helper method in `MessageHandlers` (less critical)

**Priority Justification:**
- Less critical than user-facing flows
- Could be considered a utility/helper function
- Decision depends on desired architecture consistency

---

#### 4. **SearchHandler** ⭐⭐⭐ (Most Complex)
**Location**: `handlers/messageHandlers.ts` line ~242-313  
**Complexity**: High (~72 lines)  
**State Management**: Single search mode

**What it handles:**
- Transaction search functionality
- Session state: `session.searchMode`
- Searches by description and category (case-insensitive)
- Formats and displays search results

**Extraction Notes:**
- Depends on `session.searchMode`
- Uses Prisma queries with OR conditions
- Formats results with transaction cards
- More complex logic than other handlers

**Priority Justification:**
- Most complex remaining handler
- More logic to extract and test
- Save for last to build experience with simpler handlers first

---

## Recommended Extraction Sequence

### Phase 1: Simple Multi-Step Flows
1. **ManualAddHandler** (estimated: 30 min)
   - Extract `handleManualAddFlow` → `ManualAddHandler`
   - Add to `MessageRouter` (Priority 4)
   - Test manual add flow
   - Remove from `messageHandlers.ts`

2. **RecurringHandler** (estimated: 30 min)
   - Extract `handleRecurringAddFlow` → `RecurringHandler`
   - Add to `MessageRouter` (Priority 4.5)
   - Test recurring expense flow
   - Remove from `messageHandlers.ts`

### Phase 2: Specialized Handlers
3. **SplitSettingsHandler** (estimated: 20 min - optional)
   - Extract `handleSplitSettingsInput` → `SplitSettingsHandler`
   - OR keep as helper method (decision needed)
   - Add to `MessageRouter` (Priority 4.6) if extracted
   - Test split settings input

4. **SearchHandler** (estimated: 45 min)
   - Extract `handleSearchFlow` → `SearchHandler`
   - Add to `MessageRouter` (Priority 5)
   - Test search functionality
   - Remove from `messageHandlers.ts`

---

## Extraction Template

For each handler, follow this pattern:

```typescript
// 1. Create handler file: handlers/messageHandlers/[HandlerName]Handler.ts
import { BaseMessageHandler } from './BaseMessageHandler';
// ... other imports

export class [HandlerName]Handler extends BaseMessageHandler {
  constructor(
    expenseService: ExpenseService,
    aiService: AIService,
    historyService: HistoryService,
    sessionManager: SessionManager,
    // ... other dependencies
  ) {
    super(expenseService, aiService, historyService, sessionManager, /* ... */);
  }

  canHandle(text: string, session: any): boolean {
    // Check session state or text pattern
    // Return true if this handler should process
  }

  async handle(ctx: any, text: string): Promise<void> {
    // Handler logic (extracted from messageHandlers.ts)
  }
}
```

---

## Post-Extraction Cleanup

After all handlers are extracted:

1. **Remove duplicate methods from `messageHandlers.ts`**
   - Remove `handleManualAddFlow`
   - Remove `handleRecurringAddFlow`
   - Remove `handleSplitSettingsInput` (if extracted)
   - Remove `handleSearchFlow`
   - Remove `handleQuickExpense` (already extracted)

2. **Update `MessageRouter` priorities**
   - Ensure all handlers are in correct priority order
   - Remove placeholder comments

3. **Final cleanup**
   - Remove unused imports from `messageHandlers.ts`
   - Remove old comments
   - Verify `messageHandlers.ts` is minimal wrapper around router

---

## Testing Strategy

For each extracted handler:

1. **Unit Tests**
   - Test `canHandle()` logic
   - Test `handle()` with various inputs
   - Test error handling

2. **Integration Tests**
   - Test full flow end-to-end
   - Test session state management
   - Test interaction with services

3. **E2E Tests**
   - Add to `critical-flows.test.ts` if critical
   - Test in realistic scenarios

---

## Success Criteria

✅ All handlers extracted into separate files  
✅ All handlers follow `IMessageHandler` interface  
✅ `MessageRouter` handles all message types  
✅ `messageHandlers.ts` is minimal wrapper (~50 lines)  
✅ All tests passing  
✅ No duplicate code  
✅ Clear separation of concerns  

---

## Notes

- **Keep backward compatibility**: `MessageHandlers.handleText()` should still work
- **Session state**: All handlers use `SessionManager` for consistency
- **No circular dependencies**: Handlers never call each other directly
- **Priority matters**: Router checks handlers in order (first match wins)
- **Error handling**: Each handler should handle its own errors gracefully

---

## Files Modified (This Deployment)

**New Files:**
- `handlers/messageHandlers/IMessageHandler.ts`
- `handlers/messageHandlers/BaseMessageHandler.ts`
- `handlers/messageHandlers/SessionManager.ts`
- `handlers/messageHandlers/MessageRouter.ts`
- `handlers/messageHandlers/TransactionDetailHandler.ts`
- `handlers/messageHandlers/QuickExpenseHandler.ts`
- `handlers/messageHandlers/EditHandler.ts`
- `handlers/messageHandlers/AICorrectionHandler.ts`
- `handlers/messageHandlers/CorrectionActionExecutor.ts`

**Modified Files:**
- `handlers/messageHandlers.ts` (refactored to use router)
- `services/expenseService.ts` (removed debug logging)
- `bot.ts` (exported BotSession interface)

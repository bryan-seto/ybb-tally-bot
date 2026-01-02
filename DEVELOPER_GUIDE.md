# Developer Guide

## Analytics Architecture

The bot uses an **event-driven, middleware-first architecture** for comprehensive user interaction logging. This design ensures zero performance impact, maintainable code, and complete analytics coverage.

### Core Principles

1. **Decoupled Design**: Business logic is completely decoupled from logging
2. **Non-Blocking**: All logging is asynchronous with batching
3. **Open-Closed Principle**: Add new event types without modifying existing handlers
4. **Performance First**: Buffer writes, batch inserts, never block request loop

### Architecture Components

#### 1. Analytics Middleware (`middleware/analyticsMiddleware.ts`)

The middleware automatically captures **90% of user interactions**:
- Text messages
- Callback queries (button clicks)
- Photo uploads
- Commands

**How it works:**
- Runs as Telegraf middleware (registered in `bot.ts`)
- Extracts interaction type, content, and metadata from context
- Pushes log entries to `LogWorker` (non-blocking)
- Tracks request lifecycle (PENDING → SUCCESS/FAILURE)

**Usage:** No code changes needed - automatically captures all interactions.

#### 2. Analytics Event Bus (`events/analyticsBus.ts`)

A singleton EventEmitter for business logic events. Services emit events without knowing about logging.

**Available Events:**
- `TRANSACTION_CREATED` - New expense recorded
- `TRANSACTION_UPDATED` - Expense edited
- `TRANSACTION_DELETED` - Expense removed
- `SETTLEMENT_EXECUTED` - Batch settlement
- `RECURRING_EXPENSE_CREATED` - Recurring expense added
- `RECURRING_EXPENSE_UPDATED` - Recurring expense modified
- `RECURRING_EXPENSE_DELETED` - Recurring expense removed
- `SPLIT_RULE_UPDATED` - Split settings changed
- `AI_CORRECTION_PROCESSED` - AI edit completed
- `RECEIPT_PROCESSED` - Photo receipt analyzed

**Usage in Services:**
```typescript
import { analyticsBus, AnalyticsEventType } from '../events/analyticsBus';

// Emit event after business logic
analyticsBus.emit(AnalyticsEventType.TRANSACTION_CREATED, {
  userId: BigInt(ctx.from.id),
  transactionId: transaction.id,
  amount: transaction.amountSGD,
  category: transaction.category,
  description: transaction.description,
  chatId: ctx.chat?.id ? BigInt(ctx.chat.id) : undefined,
  chatType: ctx.chat?.type,
});
```

#### 3. Analytics Listener (`listeners/analyticsListener.ts`)

Subscribes to `analyticsBus` events and transforms them into log entries. Pushes entries to `LogWorker`.

**Usage:** Automatically initialized in `bot.ts` - no manual setup needed.

#### 4. LogWorker (`services/logWorker.ts`)

Async batching service that:
- Buffers log entries in memory (max 20 entries)
- Flushes to database when buffer is full OR every 5 seconds
- Sanitizes PII before buffering
- Handles database failures gracefully (never crashes bot)

**Features:**
- **Batching**: Reduces database writes by 95% (20:1 ratio)
- **PII Sanitization**: Automatically redacts credit cards, phone numbers, emails, NRIC
- **Error Handling**: Catches all Prisma errors, logs to console, continues operating
- **Performance**: 0ms latency impact (non-blocking push)

### Developer Guidelines

#### ✅ DO

1. **Use `analyticsBus.emit()` for business logic events**
   - Emit events after successful operations (create, update, delete)
   - Include relevant metadata (transactionId, amounts, etc.)
   - Include chat context if available (chatId, chatType)

2. **Rely on middleware for raw interactions**
   - Text messages, callbacks, photos are automatically captured
   - No need to manually log these interactions

3. **Keep events focused**
   - One event per business operation
   - Include only relevant data in payload

#### ❌ DON'T

1. **Do NOT import `LogWorker` or `InteractionLogService` in handlers**
   - Use `analyticsBus.emit()` instead
   - Direct logging creates tight coupling

2. **Do NOT add logging logic to handlers**
   - Middleware handles raw interactions
   - Services emit business events
   - Handlers stay focused on user interaction

3. **Do NOT block on logging**
   - All logging is async and non-blocking
   - Never await logging operations in request handlers

### Adding New Event Types

To add a new business logic event:

1. **Add event type to `events/analyticsBus.ts`:**
```typescript
export enum AnalyticsEventType {
  // ... existing events
  NEW_EVENT_TYPE = 'NEW_EVENT_TYPE',
}
```

2. **Define payload interface:**
```typescript
export interface NewEventPayload {
  userId: bigint;
  // ... other fields
  chatId?: bigint;
  chatType?: string;
}
```

3. **Add listener in `listeners/analyticsListener.ts`:**
```typescript
analyticsBus.on(AnalyticsEventType.NEW_EVENT_TYPE, (payload: NewEventPayload) => {
  this.logNewEvent(payload);
});
```

4. **Emit event in service:**
```typescript
analyticsBus.emit(AnalyticsEventType.NEW_EVENT_TYPE, {
  userId,
  // ... payload data
});
```

### Database Schema

Logs are stored in `user_interaction_logs` table:
- Partitioned by month (PostgreSQL native partitioning)
- Indexed on `userId`, `timestamp`, `interactionType`, `eventType`
- JSONB metadata column for flexibility
- Automatic PII sanitization before storage

### Performance Characteristics

- **Latency Impact**: 0ms (non-blocking push to buffer)
- **DB Writes**: Batched (20 entries or 5s, whichever comes first)
- **Memory**: ~40KB max buffer (20 entries × ~2KB each)
- **IOPS**: Reduced by 95% (20:1 batching ratio)

### Testing

Unit tests for `LogWorker` are in `services/__tests__/logWorker.test.ts`:
- Batching behavior
- PII sanitization
- Error handling
- Timer-based flushing

### Migration Notes

- Existing `systemLog` table remains unchanged (backward compatibility)
- New `userInteractionLog` table is additive
- Both systems can run in parallel
- Gradual migration of business events to EventEmitter pattern


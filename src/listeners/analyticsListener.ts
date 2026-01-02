import { analyticsBus, AnalyticsEventType } from '../events/analyticsBus';
import { logWorker, LogEntry } from '../services/logWorker';
import type {
  TransactionCreatedPayload,
  TransactionUpdatedPayload,
  TransactionDeletedPayload,
  SettlementExecutedPayload,
  RecurringExpenseCreatedPayload,
  RecurringExpenseUpdatedPayload,
  RecurringExpenseDeletedPayload,
  SplitRuleUpdatedPayload,
  AICorrectionProcessedPayload,
  ReceiptProcessedPayload,
} from '../events/analyticsBus';

/**
 * Analytics Listener
 * Subscribes to analyticsBus events and transforms them into log entries
 * Pushes entries to LogWorker for async batching
 */
export class AnalyticsListener {
  private static instance: AnalyticsListener;
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): AnalyticsListener {
    if (!AnalyticsListener.instance) {
      AnalyticsListener.instance = new AnalyticsListener();
    }
    return AnalyticsListener.instance;
  }

  /**
   * Initialize listeners for all event types
   * Should be called once during bot startup
   */
  public initialize(): void {
    if (this.isInitialized) {
      return;
    }

    // Transaction events
    analyticsBus.on(AnalyticsEventType.TRANSACTION_CREATED, (payload: TransactionCreatedPayload) => {
      this.logTransactionCreated(payload);
    });

    analyticsBus.on(AnalyticsEventType.TRANSACTION_UPDATED, (payload: TransactionUpdatedPayload) => {
      this.logTransactionUpdated(payload);
    });

    analyticsBus.on(AnalyticsEventType.TRANSACTION_DELETED, (payload: TransactionDeletedPayload) => {
      this.logTransactionDeleted(payload);
    });

    // Settlement events
    analyticsBus.on(AnalyticsEventType.SETTLEMENT_EXECUTED, (payload: SettlementExecutedPayload) => {
      this.logSettlementExecuted(payload);
    });

    // Recurring expense events
    analyticsBus.on(AnalyticsEventType.RECURRING_EXPENSE_CREATED, (payload: RecurringExpenseCreatedPayload) => {
      this.logRecurringExpenseCreated(payload);
    });

    analyticsBus.on(AnalyticsEventType.RECURRING_EXPENSE_UPDATED, (payload: RecurringExpenseUpdatedPayload) => {
      this.logRecurringExpenseUpdated(payload);
    });

    analyticsBus.on(AnalyticsEventType.RECURRING_EXPENSE_DELETED, (payload: RecurringExpenseDeletedPayload) => {
      this.logRecurringExpenseDeleted(payload);
    });

    // Split rule events
    analyticsBus.on(AnalyticsEventType.SPLIT_RULE_UPDATED, (payload: SplitRuleUpdatedPayload) => {
      this.logSplitRuleUpdated(payload);
    });

    // AI events
    analyticsBus.on(AnalyticsEventType.AI_CORRECTION_PROCESSED, (payload: AICorrectionProcessedPayload) => {
      this.logAICorrectionProcessed(payload);
    });

    analyticsBus.on(AnalyticsEventType.RECEIPT_PROCESSED, (payload: ReceiptProcessedPayload) => {
      this.logReceiptProcessed(payload);
    });

    this.isInitialized = true;
    console.log('[AnalyticsListener] Initialized and listening to analytics events');
  }

  private logTransactionCreated(payload: TransactionCreatedPayload): void {
    const entry: LogEntry = {
      userId: payload.userId,
      timestamp: new Date(),
      interactionType: 'ACTION',
      eventType: 'transaction_create',
      content: `Transaction created: ${payload.description || 'N/A'}`,
      metadata: {
        transactionId: payload.transactionId.toString(),
        amount: payload.amount,
        category: payload.category,
        description: payload.description,
      },
      status: 'SUCCESS',
      chatId: payload.chatId,
      chatType: payload.chatType,
    };
    logWorker.push(entry);
  }

  private logTransactionUpdated(payload: TransactionUpdatedPayload): void {
    const entry: LogEntry = {
      userId: payload.userId,
      timestamp: new Date(),
      interactionType: 'ACTION',
      eventType: 'transaction_update',
      content: `Transaction updated: ${payload.transactionId}`,
      metadata: {
        transactionId: payload.transactionId.toString(),
        changes: payload.changes,
      },
      status: 'SUCCESS',
      chatId: payload.chatId,
      chatType: payload.chatType,
    };
    logWorker.push(entry);
  }

  private logTransactionDeleted(payload: TransactionDeletedPayload): void {
    const entry: LogEntry = {
      userId: payload.userId,
      timestamp: new Date(),
      interactionType: 'ACTION',
      eventType: 'transaction_delete',
      content: `Transaction deleted: ${payload.transactionId}`,
      metadata: {
        transactionId: payload.transactionId.toString(),
      },
      status: 'SUCCESS',
      chatId: payload.chatId,
      chatType: payload.chatType,
    };
    logWorker.push(entry);
  }

  private logSettlementExecuted(payload: SettlementExecutedPayload): void {
    const entry: LogEntry = {
      userId: payload.userId,
      timestamp: new Date(),
      interactionType: 'ACTION',
      eventType: 'settlement_executed',
      content: `Settlement executed: ${payload.transactionCount} transactions, $${payload.totalAmount.toFixed(2)}`,
      metadata: {
        transactionCount: payload.transactionCount,
        totalAmount: payload.totalAmount,
        watermarkId: payload.watermarkId,
        transactionIds: payload.transactionIds.map(id => id.toString()).slice(0, 100), // Limit to first 100
      },
      status: 'SUCCESS',
      chatId: payload.chatId,
      chatType: payload.chatType,
    };
    logWorker.push(entry);
  }

  private logRecurringExpenseCreated(payload: RecurringExpenseCreatedPayload): void {
    const entry: LogEntry = {
      userId: payload.userId,
      timestamp: new Date(),
      interactionType: 'ACTION',
      eventType: 'recurring_expense_create',
      content: `Recurring expense created: ${payload.description}`,
      metadata: {
        recurringExpenseId: payload.recurringExpenseId.toString(),
        description: payload.description,
        amount: payload.amount,
        dayOfMonth: payload.dayOfMonth,
      },
      status: 'SUCCESS',
      chatId: payload.chatId,
      chatType: payload.chatType,
    };
    logWorker.push(entry);
  }

  private logRecurringExpenseUpdated(payload: RecurringExpenseUpdatedPayload): void {
    const entry: LogEntry = {
      userId: payload.userId,
      timestamp: new Date(),
      interactionType: 'ACTION',
      eventType: 'recurring_expense_update',
      content: `Recurring expense updated: ${payload.recurringExpenseId}`,
      metadata: {
        recurringExpenseId: payload.recurringExpenseId.toString(),
        changes: payload.changes,
      },
      status: 'SUCCESS',
      chatId: payload.chatId,
      chatType: payload.chatType,
    };
    logWorker.push(entry);
  }

  private logRecurringExpenseDeleted(payload: RecurringExpenseDeletedPayload): void {
    const entry: LogEntry = {
      userId: payload.userId,
      timestamp: new Date(),
      interactionType: 'ACTION',
      eventType: 'recurring_expense_delete',
      content: `Recurring expense deleted: ${payload.recurringExpenseId}`,
      metadata: {
        recurringExpenseId: payload.recurringExpenseId.toString(),
      },
      status: 'SUCCESS',
      chatId: payload.chatId,
      chatType: payload.chatType,
    };
    logWorker.push(entry);
  }

  private logSplitRuleUpdated(payload: SplitRuleUpdatedPayload): void {
    const entry: LogEntry = {
      userId: payload.userId,
      timestamp: new Date(),
      interactionType: 'ACTION',
      eventType: 'split_rule_update',
      content: `Split rule updated for ${payload.category}: ${Math.round(payload.bryanPercentage * 100)}% / ${Math.round(payload.hweiYeenPercentage * 100)}%`,
      metadata: {
        category: payload.category,
        bryanPercentage: payload.bryanPercentage,
        hweiYeenPercentage: payload.hweiYeenPercentage,
      },
      status: 'SUCCESS',
      chatId: payload.chatId,
      chatType: payload.chatType,
    };
    logWorker.push(entry);
  }

  private logAICorrectionProcessed(payload: AICorrectionProcessedPayload): void {
    const entry: LogEntry = {
      userId: payload.userId,
      timestamp: new Date(),
      interactionType: 'ACTION',
      eventType: 'ai_correction_processed',
      content: `AI correction processed: ${payload.actions.join(', ')}`,
      metadata: {
        actions: payload.actions,
        transactionIds: payload.transactionIds?.map(id => id.toString()),
      },
      status: 'SUCCESS',
      chatId: payload.chatId,
      chatType: payload.chatType,
    };
    logWorker.push(entry);
  }

  private logReceiptProcessed(payload: ReceiptProcessedPayload): void {
    const entry: LogEntry = {
      userId: payload.userId,
      timestamp: new Date(),
      interactionType: 'ACTION',
      eventType: 'receipt_processed',
      content: `Receipt processed: ${payload.transactionCount} transaction(s), valid: ${payload.isValid}`,
      metadata: {
        transactionCount: payload.transactionCount,
        isValid: payload.isValid,
        latencyMs: payload.latencyMs,
        usedModel: payload.usedModel,
      },
      status: payload.isValid ? 'SUCCESS' : 'FAILURE',
      chatId: payload.chatId,
      chatType: payload.chatType,
    };
    logWorker.push(entry);
  }
}

// Export singleton instance
export const analyticsListener = AnalyticsListener.getInstance();


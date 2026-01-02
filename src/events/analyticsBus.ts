import { EventEmitter } from 'events';

/**
 * Analytics Event Types
 * Type-safe event names for business logic events
 */
export enum AnalyticsEventType {
  // Transaction events
  TRANSACTION_CREATED = 'TRANSACTION_CREATED',
  TRANSACTION_UPDATED = 'TRANSACTION_UPDATED',
  TRANSACTION_DELETED = 'TRANSACTION_DELETED',
  
  // Settlement events
  SETTLEMENT_EXECUTED = 'SETTLEMENT_EXECUTED',
  
  // Recurring expense events
  RECURRING_EXPENSE_CREATED = 'RECURRING_EXPENSE_CREATED',
  RECURRING_EXPENSE_UPDATED = 'RECURRING_EXPENSE_UPDATED',
  RECURRING_EXPENSE_DELETED = 'RECURRING_EXPENSE_DELETED',
  
  // Split rule events
  SPLIT_RULE_UPDATED = 'SPLIT_RULE_UPDATED',
  
  // AI events
  AI_CORRECTION_PROCESSED = 'AI_CORRECTION_PROCESSED',
  RECEIPT_PROCESSED = 'RECEIPT_PROCESSED',
}

/**
 * Analytics Event Payloads
 */
export interface TransactionCreatedPayload {
  userId: bigint;
  transactionId: bigint;
  amount: number;
  category: string;
  description?: string;
  chatId?: bigint;
  chatType?: string;
}

export interface TransactionUpdatedPayload {
  userId: bigint;
  transactionId: bigint;
  changes: Record<string, any>;
  chatId?: bigint;
  chatType?: string;
}

export interface TransactionDeletedPayload {
  userId: bigint;
  transactionId: bigint;
  chatId?: bigint;
  chatType?: string;
}

export interface SettlementExecutedPayload {
  userId: bigint;
  transactionCount: number;
  totalAmount: number;
  watermarkId: string;
  transactionIds: bigint[];
  chatId?: bigint;
  chatType?: string;
}

export interface RecurringExpenseCreatedPayload {
  userId: bigint;
  recurringExpenseId: bigint;
  description: string;
  amount: number;
  dayOfMonth: number;
  chatId?: bigint;
  chatType?: string;
}

export interface RecurringExpenseUpdatedPayload {
  userId: bigint;
  recurringExpenseId: bigint;
  changes: Record<string, any>;
  chatId?: bigint;
  chatType?: string;
}

export interface RecurringExpenseDeletedPayload {
  userId: bigint;
  recurringExpenseId: bigint;
  chatId?: bigint;
  chatType?: string;
}

export interface SplitRuleUpdatedPayload {
  userId: bigint;
  category: string;
  bryanPercentage: number;
  hweiYeenPercentage: number;
  chatId?: bigint;
  chatType?: string;
}

export interface AICorrectionProcessedPayload {
  userId: bigint;
  actions: string[];
  transactionIds?: bigint[];
  chatId?: bigint;
  chatType?: string;
}

export interface ReceiptProcessedPayload {
  userId: bigint;
  transactionCount: number;
  isValid: boolean;
  latencyMs?: number;
  usedModel?: string;
  chatId?: bigint;
  chatType?: string;
}

/**
 * Analytics Event Bus
 * Singleton EventEmitter for decoupled business logic event emission
 */
class AnalyticsBus extends EventEmitter {
  private static instance: AnalyticsBus;

  private constructor() {
    super();
    // Set max listeners to prevent memory leaks
    this.setMaxListeners(50);
  }

  public static getInstance(): AnalyticsBus {
    if (!AnalyticsBus.instance) {
      AnalyticsBus.instance = new AnalyticsBus();
    }
    return AnalyticsBus.instance;
  }
}

// Export singleton instance
export const analyticsBus = AnalyticsBus.getInstance();


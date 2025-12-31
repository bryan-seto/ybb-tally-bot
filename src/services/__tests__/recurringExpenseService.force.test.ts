import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecurringExpenseService } from '../recurringExpenseService';
import { ExpenseService } from '../expenseService';
import { prisma } from '../../lib/prisma';
import * as dateHelpers from '../../utils/dateHelpers';

// Mock dependencies
vi.mock('../../lib/prisma', () => ({
  prisma: {
    transaction: {
      create: vi.fn(),
    },
    recurringExpense: {
      update: vi.fn(),
    },
  },
}));

vi.mock('../../utils/dateHelpers', () => ({
  getDayOfMonth: vi.fn(),
  getNow: vi.fn(() => new Date('2025-01-31T10:00:00Z')),
  getStartOfDay: vi.fn((date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }),
}));

describe('RecurringExpenseService - Force Processing', () => {
  let recurringExpenseService: RecurringExpenseService;
  let mockExpenseService: ExpenseService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExpenseService = {
      getOutstandingBalanceMessage: vi.fn().mockResolvedValue('Balance: $0.00'),
    } as any;
    recurringExpenseService = new RecurringExpenseService(mockExpenseService);
  });

  it('Test Case 1: Should return null when force=false and dayOfMonth does not match today', async () => {
    // Arrange
    const mockExpense = {
      id: BigInt(1),
      dayOfMonth: 12, // Not today (31st)
      amountOriginal: 100,
      description: 'Test Expense',
      payerId: BigInt(1),
      lastProcessedDate: null,
    };

    vi.mocked(dateHelpers.getDayOfMonth).mockReturnValue(31); // Today is 31st

    // Act
    const result = await recurringExpenseService.processSingleRecurringExpense(mockExpense, false);

    // Assert
    expect(result).toBeNull();
  });

  it('Test Case 2: Should process successfully when force=true even if dayOfMonth does not match today', async () => {
    // Arrange
    const mockExpense = {
      id: BigInt(1),
      dayOfMonth: 12, // Not today (31st)
      amountOriginal: 100,
      description: 'Test Expense',
      payerId: BigInt(1),
      lastProcessedDate: null,
    };

    const mockTransaction = {
      id: BigInt(1),
      amountSGD: 100,
      description: 'Test Expense',
    };

    vi.mocked(dateHelpers.getDayOfMonth).mockReturnValue(31); // Today is 31st
    vi.mocked(prisma.transaction.create).mockResolvedValue(mockTransaction as any);
    vi.mocked(prisma.recurringExpense.update).mockResolvedValue({} as any);

    // Act
    const result = await recurringExpenseService.processSingleRecurringExpense(mockExpense, true);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.transaction).toEqual(mockTransaction);
    expect(prisma.transaction.create).toHaveBeenCalled();
    expect(prisma.recurringExpense.update).toHaveBeenCalled();
  });

  it('Test Case 3: Should process successfully when force=true even if already processed today', async () => {
    // Arrange
    const today = new Date('2025-01-31T10:00:00Z');
    const mockExpense = {
      id: BigInt(1),
      dayOfMonth: 31, // Matches today
      amountOriginal: 100,
      description: 'Test Expense',
      payerId: BigInt(1),
      lastProcessedDate: today, // Already processed today
    };

    const mockTransaction = {
      id: BigInt(1),
      amountSGD: 100,
      description: 'Test Expense',
    };

    vi.mocked(dateHelpers.getDayOfMonth).mockReturnValue(31);
    vi.mocked(prisma.transaction.create).mockResolvedValue(mockTransaction as any);
    vi.mocked(prisma.recurringExpense.update).mockResolvedValue({} as any);

    // Act
    const result = await recurringExpenseService.processSingleRecurringExpense(mockExpense, true);

    // Assert
    expect(result).not.toBeNull();
    expect(result?.transaction).toEqual(mockTransaction);
    expect(prisma.transaction.create).toHaveBeenCalled();
    expect(prisma.recurringExpense.update).toHaveBeenCalled();
  });
});


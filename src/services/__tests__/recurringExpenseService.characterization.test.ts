import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecurringExpenseService } from '../recurringExpenseService';
import { ExpenseService } from '../expenseService';
import { prisma } from '../../lib/prisma';

// Mock Prisma client
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

// Mock date helpers to use fixed dates for consistent snapshots
vi.mock('../../utils/dateHelpers', () => {
  // Use a fixed date: 2024-01-15 (day 15 of the month)
  const fixedDate = new Date('2024-01-15T12:00:00.000Z');
  
  return {
    getNow: vi.fn(() => {
      return new Date(fixedDate);
    }),
    getDayOfMonth: vi.fn(() => {
      return 15; // Day 15 of the month
    }),
    getStartOfDay: vi.fn((date?: Date) => {
      const base = date || fixedDate;
      const result = new Date(base);
      result.setHours(0, 0, 0, 0);
      return result;
    }),
    getDaysAgo: vi.fn((days: number, date?: Date) => {
      const base = date || fixedDate;
      const result = new Date(base);
      result.setDate(result.getDate() - days);
      return result;
    }),
    formatDate: vi.fn((date: Date, format?: string) => {
      return date.toISOString();
    }),
  };
});

describe('RecurringExpenseService - Characterization Tests', () => {
  let recurringExpenseService: RecurringExpenseService;
  let mockExpenseService: any;

  // Test user data
  const mockBryan = {
    id: BigInt('109284773'),
    name: 'Bryan',
    role: 'Bryan' as const,
  };

  const mockHweiYeen = {
    id: BigInt('424894363'),
    name: 'Hwei Yeen',
    role: 'HweiYeen' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create mock ExpenseService
    mockExpenseService = {
      getOutstandingBalanceMessage: vi.fn().mockResolvedValue('👉 Hwei Yeen owes Bryan: SGD $30.00'),
    };
    
    recurringExpenseService = new RecurringExpenseService(mockExpenseService);
  });

  describe('processSingleRecurringExpense', () => {
    it('should process recurring expense that is due today', async () => {
      const mockRecurringExpense = {
        id: BigInt('1'),
        description: 'Internet Bill',
        amountOriginal: 50.00,
        payerId: mockBryan.id,
        payer: mockBryan,
        dayOfMonth: 15, // Matches today (15th)
        isActive: true,
        lastProcessedDate: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      };

      const mockTransaction = {
        id: BigInt('100'),
        amountSGD: 50.00,
        currency: 'SGD',
        category: 'Bills',
        description: 'Internet Bill',
        payerId: mockBryan.id,
        date: new Date('2024-01-15T12:00:00.000Z'),
        splitType: 'FULL',
        isSettled: false,
        bryanPercentage: null,
        hweiYeenPercentage: null,
      };

      vi.mocked(prisma.transaction.create).mockResolvedValue(mockTransaction as any);
      vi.mocked(prisma.recurringExpense.update).mockResolvedValue({
        ...mockRecurringExpense,
        lastProcessedDate: new Date('2024-01-15T12:00:00.000Z'),
      } as any);

      const result = await recurringExpenseService.processSingleRecurringExpense(mockRecurringExpense as any);

      expect(result).toMatchSnapshot();
      expect(mockExpenseService.getOutstandingBalanceMessage).toHaveBeenCalled();
    });

    it('should skip recurring expense that is NOT due yet', async () => {
      const mockRecurringExpense = {
        id: BigInt('2'),
        description: 'Netflix Subscription',
        amountOriginal: 15.99,
        payerId: mockHweiYeen.id,
        payer: mockHweiYeen,
        dayOfMonth: 20, // Not due yet (today is 15th)
        isActive: true,
        lastProcessedDate: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      };

      const result = await recurringExpenseService.processSingleRecurringExpense(mockRecurringExpense as any);

      expect(result).toMatchSnapshot();
      expect(prisma.transaction.create).not.toHaveBeenCalled();
      expect(prisma.recurringExpense.update).not.toHaveBeenCalled();
    });

    it('should skip expense that has already been processed', async () => {
      const mockRecurringExpense = {
        id: BigInt('3'),
        description: 'Gym Membership',
        amountOriginal: 100.00,
        payerId: mockBryan.id,
        payer: mockBryan,
        dayOfMonth: 15, // Matches today (15th)
        isActive: true,
        lastProcessedDate: new Date('2024-01-15T00:00:00.000Z'), // Already processed today
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-15T00:00:00.000Z'),
      };

      const result = await recurringExpenseService.processSingleRecurringExpense(mockRecurringExpense as any);

      expect(result).toMatchSnapshot();
      expect(prisma.transaction.create).not.toHaveBeenCalled();
      expect(prisma.recurringExpense.update).not.toHaveBeenCalled();
    });
  });
});


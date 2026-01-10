import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExpenseService } from '../expenseService';
import { prisma } from '../../lib/prisma';

// Mock Prisma client
vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
  },
}));

// Mock date helpers to use fixed dates for consistent snapshots
vi.mock('../../utils/dateHelpers', () => {
  // Use a fixed date: 2024-01-15 (mid-month for consistent behavior)
  const fixedDate = new Date('2024-01-15T12:00:00.000Z');
  
  return {
    getStartOfMonth: vi.fn((date?: Date) => {
      const base = date || fixedDate;
      return new Date(base.getFullYear(), base.getMonth(), 1);
    }),
    getEndOfMonth: vi.fn((date?: Date) => {
      const base = date || fixedDate;
      return new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
    }),
    getMonthsAgo: vi.fn((months: number) => {
      const result = new Date(fixedDate);
      result.setMonth(result.getMonth() - months);
      return result;
    }),
    formatDate: vi.fn((date: Date, format?: string) => {
      // Simple mock that returns ISO string for snapshots
      return date.toISOString();
    }),
  };
});

describe('ExpenseService - Characterization Tests', () => {
  let expenseService: ExpenseService;

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
    expenseService = new ExpenseService();
  });

  describe('calculateOutstandingBalance', () => {
    it('should return zero balance when no users found', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

      const result = await expenseService.calculateOutstandingBalance();

      expect(result).toMatchSnapshot();
    });

    it('should return zero balance when no unsettled transactions', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan)
        .mockResolvedValueOnce(mockHweiYeen);
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      const result = await expenseService.calculateOutstandingBalance();

      expect(result).toMatchSnapshot();
    });

    it('should calculate balance with default 70/30 split when Bryan paid', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan)
        .mockResolvedValueOnce(mockHweiYeen);
      
      const mockTransactions = [
        {
          id: BigInt('1'),
          payerId: mockBryan.id,
          amountSGD: 100.00,
          currency: 'SGD',
          bryanPercentage: null,
          hweiYeenPercentage: null,
          isSettled: false,
        },
      ];
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await expenseService.calculateOutstandingBalance();

      expect(result).toMatchSnapshot();
    });

    it('should calculate balance with default 70/30 split when HweiYeen paid', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan)
        .mockResolvedValueOnce(mockHweiYeen);
      
      const mockTransactions = [
        {
          id: BigInt('1'),
          payerId: mockHweiYeen.id,
          amountSGD: 100.00,
          currency: 'SGD',
          bryanPercentage: null,
          hweiYeenPercentage: null,
          isSettled: false,
        },
      ];
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await expenseService.calculateOutstandingBalance();

      expect(result).toMatchSnapshot();
    });

    it('should calculate balance with custom split percentages', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan)
        .mockResolvedValueOnce(mockHweiYeen);
      
      const mockTransactions = [
        {
          id: BigInt('1'),
          payerId: mockBryan.id,
          amountSGD: 100.00,
          currency: 'SGD',
          bryanPercentage: 0.5,
          hweiYeenPercentage: 0.5,
          isSettled: false,
        },
      ];
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await expenseService.calculateOutstandingBalance();

      expect(result).toMatchSnapshot();
    });

    it('should calculate balance with multiple mixed transactions', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan)
        .mockResolvedValueOnce(mockHweiYeen);
      
      const mockTransactions = [
        {
          id: BigInt('1'),
          payerId: mockBryan.id,
          amountSGD: 100.00,
          currency: 'SGD',
          bryanPercentage: null,
          hweiYeenPercentage: null,
          isSettled: false,
        },
        {
          id: BigInt('2'),
          payerId: mockHweiYeen.id,
          amountSGD: 50.00,
          currency: 'SGD',
          bryanPercentage: 0.6,
          hweiYeenPercentage: 0.4,
          isSettled: false,
        },
        {
          id: BigInt('3'),
          payerId: mockBryan.id,
          amountSGD: 200.00,
          currency: 'SGD',
          bryanPercentage: 0.8,
          hweiYeenPercentage: 0.2,
          isSettled: false,
        },
      ];
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await expenseService.calculateOutstandingBalance();

      expect(result).toMatchSnapshot();
    });
  });

  describe('calculateTransactionOwed', () => {
    it('should calculate owed amounts with default 70/30 split when Bryan paid', () => {
      const result = expenseService.calculateTransactionOwed(
        100.00,
        'Bryan'
      );

      expect(result).toMatchSnapshot();
    });

    it('should calculate owed amounts with default 70/30 split when HweiYeen paid', () => {
      const result = expenseService.calculateTransactionOwed(
        100.00,
        'HweiYeen'
      );

      expect(result).toMatchSnapshot();
    });

    it('should calculate owed amounts with custom 50/50 split when Bryan paid', () => {
      const result = expenseService.calculateTransactionOwed(
        100.00,
        'Bryan',
        0.5,
        0.5
      );

      expect(result).toMatchSnapshot();
    });

    it('should calculate owed amounts with custom 80/20 split when HweiYeen paid', () => {
      const result = expenseService.calculateTransactionOwed(
        150.50,
        'HweiYeen',
        0.8,
        0.2
      );

      expect(result).toMatchSnapshot();
    });

    it('should handle zero amount', () => {
      const result = expenseService.calculateTransactionOwed(
        0,
        'Bryan'
      );

      expect(result).toMatchSnapshot();
    });

    it('should handle decimal amounts', () => {
      const result = expenseService.calculateTransactionOwed(
        123.45,
        'HweiYeen',
        0.7,
        0.3
      );

      expect(result).toMatchSnapshot();
    });
  });

  describe('getOutstandingBalanceMessage', () => {
    it('should return settled message when balance is zero', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan)
        .mockResolvedValueOnce(mockHweiYeen);
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      const result = await expenseService.getOutstandingBalanceMessage();

      expect(result).toMatchSnapshot();
    });

    it('should return message when Bryan owes HweiYeen', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan)
        .mockResolvedValueOnce(mockHweiYeen);
      
      const mockTransactions = [
        {
          id: BigInt('1'),
          payerId: mockHweiYeen.id,
          amountSGD: 100.00,
          currency: 'SGD',
          bryanPercentage: null,
          hweiYeenPercentage: null,
          isSettled: false,
        },
      ];
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await expenseService.getOutstandingBalanceMessage();

      expect(result).toMatchSnapshot();
    });

    it('should return message when HweiYeen owes Bryan', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan)
        .mockResolvedValueOnce(mockHweiYeen);
      
      const mockTransactions = [
        {
          id: BigInt('1'),
          payerId: mockBryan.id,
          amountSGD: 100.00,
          currency: 'SGD',
          bryanPercentage: null,
          hweiYeenPercentage: null,
          isSettled: false,
        },
      ];
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await expenseService.getOutstandingBalanceMessage();

      expect(result).toMatchSnapshot();
    });

    it('should return message when both owe each other', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan)
        .mockResolvedValueOnce(mockHweiYeen);
      
      // Create a scenario where both owe each other (edge case with custom splits)
      const mockTransactions = [
        {
          id: BigInt('1'),
          payerId: mockBryan.id,
          amountSGD: 100.00,
          currency: 'SGD',
          bryanPercentage: 0.4, // Bryan pays but only owes 40%
          hweiYeenPercentage: 0.6,
          isSettled: false,
        },
        {
          id: BigInt('2'),
          payerId: mockHweiYeen.id,
          amountSGD: 100.00,
          currency: 'SGD',
          bryanPercentage: 0.7,
          hweiYeenPercentage: 0.3, // HweiYeen pays but only owes 30%
          isSettled: false,
        },
      ];
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await expenseService.getOutstandingBalanceMessage();

      expect(result).toMatchSnapshot();
    });

    it('should format decimal amounts correctly', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan)
        .mockResolvedValueOnce(mockHweiYeen);
      
      const mockTransactions = [
        {
          id: BigInt('1'),
          payerId: mockHweiYeen.id,
          amountSGD: 123.456,
          currency: 'SGD',
          bryanPercentage: null,
          hweiYeenPercentage: null,
          isSettled: false,
        },
      ];
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await expenseService.getOutstandingBalanceMessage();

      expect(result).toMatchSnapshot();
    });
  });
});



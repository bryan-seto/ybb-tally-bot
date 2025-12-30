import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryService } from '../historyService';
import { prisma } from '../../lib/prisma';

// Mock Prisma client
vi.mock('../../lib/prisma', () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// Mock date helpers to use fixed dates for consistent snapshots
vi.mock('../../utils/dateHelpers', () => {
  return {
    formatDate: vi.fn((date: Date, format?: string) => {
      // Return a consistent format for snapshots
      return '15 Jan 2024, 12:00 PM';
    }),
  };
});

describe('HistoryService - Characterization Tests', () => {
  let historyService: HistoryService;

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
    historyService = new HistoryService();
  });

  describe('getRecentTransactions', () => {
    it('should return formatted transactions (happy path)', async () => {
      const mockDate = new Date('2024-01-15T12:00:00.000Z');
      
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
        {
          id: BigInt('1'),
          date: mockDate,
          amountSGD: 50.5,
          currency: 'SGD',
          isSettled: false,
          category: 'Food',
          description: 'Lunch at Restaurant',
          payerId: mockBryan.id,
          payer: mockBryan,
        },
        {
          id: BigInt('2'),
          date: mockDate,
          amountSGD: 25.75,
          currency: 'SGD',
          isSettled: true,
          category: 'Transport',
          description: 'Grab ride',
          payerId: mockHweiYeen.id,
          payer: mockHweiYeen,
        },
      ] as any);

      const result = await historyService.getRecentTransactions(20, 0);

      expect(result).toMatchSnapshot();
    });

    it('should return empty array when no transactions (empty state)', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([]);

      const result = await historyService.getRecentTransactions(20, 0);

      expect(result).toMatchSnapshot();
    });

    it('should handle transactions with null description and category', async () => {
      const mockDate = new Date('2024-01-15T12:00:00.000Z');
      
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
        {
          id: BigInt('3'),
          date: mockDate,
          amountSGD: 100.0,
          currency: 'SGD',
          isSettled: false,
          category: null,
          description: null,
          payerId: mockBryan.id,
          payer: mockBryan,
        },
      ] as any);

      const result = await historyService.getRecentTransactions(20, 0);

      expect(result).toMatchSnapshot();
    });
  });

  describe('getTransactionById', () => {
    it('should return formatted transaction when found', async () => {
      const mockDate = new Date('2024-01-15T12:00:00.000Z');
      
      vi.mocked(prisma.transaction.findUnique).mockResolvedValueOnce({
        id: BigInt('1'),
        date: mockDate,
        amountSGD: 50.5,
        currency: 'SGD',
        isSettled: true,
        category: 'Food',
        description: 'Lunch',
        payerId: mockBryan.id,
        payer: mockBryan,
        splitType: 'FIFTY_FIFTY',
        bryanPercentage: 0.5,
        hweiYeenPercentage: 0.5,
      } as any);

      const result = await historyService.getTransactionById(BigInt('1'));

      expect(result).toMatchSnapshot();
    });

    it('should return null when transaction not found', async () => {
      vi.mocked(prisma.transaction.findUnique).mockResolvedValueOnce(null);

      const result = await historyService.getTransactionById(BigInt('999'));

      expect(result).toMatchSnapshot();
    });

    it('should handle transaction with custom split percentages', async () => {
      const mockDate = new Date('2024-01-15T12:00:00.000Z');
      
      vi.mocked(prisma.transaction.findUnique).mockResolvedValueOnce({
        id: BigInt('2'),
        date: mockDate,
        amountSGD: 100.0,
        currency: 'SGD',
        isSettled: false,
        category: 'Shopping',
        description: 'Grocery shopping',
        payerId: mockHweiYeen.id,
        payer: mockHweiYeen,
        splitType: 'CUSTOM',
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
      } as any);

      const result = await historyService.getTransactionById(BigInt('2'));

      expect(result).toMatchSnapshot();
    });
  });

  describe('formatTransactionDetail', () => {
    const mockDate = new Date('2024-01-15T12:00:00.000Z');

    it('should format settled transaction', () => {
      const tx = {
        id: BigInt('1'),
        date: mockDate,
        merchant: 'Restaurant',
        amount: 50.5,
        currency: 'SGD',
        status: 'settled' as const,
        category: 'Food',
        description: 'Lunch',
        paidBy: 'Bryan',
        payerId: mockBryan.id,
        payerRole: 'Bryan',
      };

      const result = historyService.formatTransactionDetail(tx);

      expect(result).toMatchSnapshot();
    });

    it('should format unsettled transaction', () => {
      const tx = {
        id: BigInt('2'),
        date: mockDate,
        merchant: 'Grab',
        amount: 25.75,
        currency: 'SGD',
        status: 'unsettled' as const,
        category: 'Transport',
        description: 'Taxi ride',
        paidBy: 'Hwei Yeen',
        payerId: mockHweiYeen.id,
        payerRole: 'HweiYeen',
      };

      const result = historyService.formatTransactionDetail(tx);

      expect(result).toMatchSnapshot();
    });

    it('should format transaction with FIFTY_FIFTY split', () => {
      const tx = {
        id: BigInt('3'),
        date: mockDate,
        merchant: 'Grocery Store',
        amount: 100.0,
        currency: 'SGD',
        status: 'unsettled' as const,
        category: 'Groceries',
        description: 'Weekly groceries',
        paidBy: 'Bryan',
        payerId: mockBryan.id,
        payerRole: 'Bryan',
        splitType: 'FIFTY_FIFTY',
        bryanPercentage: 0.5,
        hweiYeenPercentage: 0.5,
      };

      const result = historyService.formatTransactionDetail(tx);

      expect(result).toMatchSnapshot();
    });

    it('should format transaction with custom split percentages', () => {
      const tx = {
        id: BigInt('4'),
        date: mockDate,
        merchant: 'Shopping Mall',
        amount: 200.0,
        currency: 'SGD',
        status: 'unsettled' as const,
        category: 'Shopping',
        description: 'Clothes shopping',
        paidBy: 'Hwei Yeen',
        payerId: mockHweiYeen.id,
        payerRole: 'HweiYeen',
        splitType: 'CUSTOM',
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
      };

      const result = historyService.formatTransactionDetail(tx);

      expect(result).toMatchSnapshot();
    });

    it('should format transaction with FULL split (no split details shown)', () => {
      const tx = {
        id: BigInt('5'),
        date: mockDate,
        merchant: 'Bills Payment',
        amount: 150.0,
        currency: 'SGD',
        status: 'settled' as const,
        category: 'Bills',
        description: 'Utility bill',
        paidBy: 'Bryan',
        payerId: mockBryan.id,
        payerRole: 'Bryan',
        splitType: 'FULL',
        bryanPercentage: 1.0,
        hweiYeenPercentage: 0.0,
      };

      const result = historyService.formatTransactionDetail(tx);

      expect(result).toMatchSnapshot();
    });

    it('should format transaction with no split', () => {
      const tx = {
        id: BigInt('6'),
        date: mockDate,
        merchant: 'Coffee Shop',
        amount: 5.5,
        currency: 'SGD',
        status: 'settled' as const,
        category: 'Food',
        description: 'Coffee',
        paidBy: 'Bryan',
        payerId: mockBryan.id,
        payerRole: 'Bryan',
      };

      const result = historyService.formatTransactionDetail(tx);

      expect(result).toMatchSnapshot();
    });

    it('should format transaction with non-SGD currency', () => {
      const tx = {
        id: BigInt('7'),
        date: mockDate,
        merchant: 'International Store',
        amount: 50.0,
        currency: 'USD',
        status: 'unsettled' as const,
        category: 'Shopping',
        description: 'Online purchase',
        paidBy: 'Bryan',
        payerId: mockBryan.id,
        payerRole: 'Bryan',
        splitType: 'CUSTOM',
        bryanPercentage: 0.6,
        hweiYeenPercentage: 0.4,
      };

      const result = historyService.formatTransactionDetail(tx);

      expect(result).toMatchSnapshot();
    });
  });

  describe('formatTransactionListItem', () => {
    const mockDate = new Date('2024-01-15T12:00:00.000Z');

    it('should format SGD currency transaction', () => {
      const tx = {
        id: BigInt('1'),
        date: mockDate,
        merchant: 'Restaurant',
        amount: 50.5,
        currency: 'SGD',
        status: 'settled' as const,
        category: 'Food',
        description: 'Lunch',
        paidBy: 'Bryan',
      };

      const result = historyService.formatTransactionListItem(tx);

      expect(result).toMatchSnapshot();
    });

    it('should format non-SGD currency transaction', () => {
      const tx = {
        id: BigInt('2'),
        date: mockDate,
        merchant: 'International Store',
        amount: 25.75,
        currency: 'USD',
        status: 'unsettled' as const,
        category: 'Shopping',
        description: 'Online purchase',
        paidBy: 'Hwei Yeen',
      };

      const result = historyService.formatTransactionListItem(tx);

      expect(result).toMatchSnapshot();
    });

    it('should format settled transaction', () => {
      const tx = {
        id: BigInt('3'),
        date: mockDate,
        merchant: 'Grab',
        amount: 15.0,
        currency: 'SGD',
        status: 'settled' as const,
        category: 'Transport',
        description: 'Taxi',
        paidBy: 'Bryan',
      };

      const result = historyService.formatTransactionListItem(tx);

      expect(result).toMatchSnapshot();
    });

    it('should format unsettled transaction', () => {
      const tx = {
        id: BigInt('4'),
        date: mockDate,
        merchant: 'Coffee Shop',
        amount: 5.5,
        currency: 'SGD',
        status: 'unsettled' as const,
        category: 'Food',
        description: 'Coffee',
        paidBy: 'Hwei Yeen',
      };

      const result = historyService.formatTransactionListItem(tx);

      expect(result).toMatchSnapshot();
    });

    it('should escape markdown special characters in merchant name', () => {
      const tx = {
        id: BigInt('5'),
        date: mockDate,
        merchant: 'Store_with_underscores*and*special[chars]',
        amount: 100.0,
        currency: 'SGD',
        status: 'settled' as const,
        category: 'Shopping',
        description: 'Test',
        paidBy: 'Bryan',
      };

      const result = historyService.formatTransactionListItem(tx);

      expect(result).toMatchSnapshot();
    });
  });
});


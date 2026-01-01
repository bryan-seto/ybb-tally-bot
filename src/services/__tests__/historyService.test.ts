import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryService } from '../historyService';
import { prisma } from '../../lib/prisma';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe('HistoryService', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
    vi.clearAllMocks();
  });

  describe('getRecentTransactions', () => {
    it('should fetch and format recent transactions', async () => {
      const mockDate = new Date();
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
        {
          id: BigInt(1),
          date: mockDate,
          amountSGD: 50.5,
          currency: 'SGD',
          isSettled: false,
          category: 'Food',
          description: 'Lunch',
          payer: { name: 'Bryan' },
        },
      ] as any);

      const result = await historyService.getRecentTransactions(20, 0);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: BigInt(1),
        date: mockDate,
        merchant: 'Lunch',
        amount: 50.5,
        currency: 'SGD',
        status: 'unsettled',
        category: 'Food',
        description: 'Lunch',
        paidBy: 'Bryan',
      });
    });
  });

  describe('getTransactionById', () => {
    it('should fetch and format a transaction by ID', async () => {
      const mockDate = new Date();
      vi.mocked(prisma.transaction.findUnique).mockResolvedValueOnce({
        id: BigInt(1),
        date: mockDate,
        amountSGD: 50.5,
        currency: 'SGD',
        isSettled: true,
        category: 'Food',
        description: 'Lunch',
        payerId: BigInt(10),
        payer: { name: 'Bryan', role: 'Bryan', id: BigInt(10) },
      } as any);

      const result = await historyService.getTransactionById(BigInt(1));

      expect(result).toEqual({
        id: BigInt(1),
        date: mockDate,
        merchant: 'Lunch',
        amount: 50.5,
        currency: 'SGD',
        status: 'settled',
        category: 'Food',
        description: 'Lunch',
        paidBy: 'Bryan',
        payerId: BigInt(10),
        payerRole: 'Bryan',
      });
    });

    it('should return null if transaction not found', async () => {
      vi.mocked(prisma.transaction.findUnique).mockResolvedValueOnce(null);
      const result = await historyService.getTransactionById(BigInt(1));
      expect(result).toBeNull();
    });
  });

  describe('formatters', () => {
    it('should format status emoji correctly', () => {
      expect(historyService.getStatusEmoji('settled')).toBe('✅');
      expect(historyService.getStatusEmoji('unsettled')).toBe('🔴');
    });

    it('should format list item correctly', () => {
      const mockTx = {
        id: BigInt(123),
        status: 'unsettled' as const,
        merchant: 'Grab',
        amount: 15.5,
        currency: 'SGD',
      };
      const line = historyService.formatTransactionListItem(mockTx as any);
      expect(line).toBe('/123 🔴 *Grab* - $15.50');
    });
  });
});



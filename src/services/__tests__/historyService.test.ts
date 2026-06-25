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
        originalAmount: null,
        fxRate: null,
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
        splitType: undefined,
        bryanPercentage: undefined,
        hweiYeenPercentage: undefined,
        originalAmount: null,
        fxRate: null,
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
      expect(line).toBe('/123 🔴 *Grab* - S$15.50');
    });

    it('escapes * in merchant name with backslash (Telegram Markdown V1 supports \\*)', () => {
      // Real-world crash: "AMAZE* KLOOK TRAVEL SINGAPORE SGP" caused a 400 error
      // with the old strip approach. Now we use backslash-escape (\*) which V1 supports.
      const mockTx = {
        id: BigInt(315),
        status: 'unsettled' as const,
        merchant: 'AMAZE* KLOOK TRAVEL SINGAPORE SGP',
        amount: 109.79,
        currency: 'SGD',
      };
      const line = historyService.formatTransactionListItem(mockTx as any);
      // The * in "AMAZE*" must be escaped as \*
      expect(line).toBe('/315 🔴 *AMAZE\\* KLOOK TRAVEL SINGAPORE SGP* - S$109.79');
      // Only the surrounding bold markers are unescaped *; the merchant's * is escaped
      expect(line).toContain('AMAZE\\*');
    });

    it('escapes _ in merchant name with backslash (prevents accidental italic)', () => {
      const mockTx = {
        id: BigInt(1),
        status: 'settled' as const,
        merchant: 'Shop_Name',
        amount: 20.0,
        currency: 'SGD',
      };
      const line = historyService.formatTransactionListItem(mockTx as any);
      expect(line).toBe('/1 ✅ *Shop\\_Name* - S$20.00');
      expect(line).toContain('Shop\\_Name');
    });
  });
});



import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallbackHandlers } from '../callbackHandlers';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { AnalyticsService } from '../../services/analyticsService';
import { prisma } from '../../lib/prisma';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    settings: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('quickchart-js', () => {
  class MockQuickChart {
    setConfig = vi.fn();
    setWidth = vi.fn();
    setHeight = vi.fn();
    getUrl = vi.fn().mockReturnValue('https://mock-chart.url');
  }
  return {
    default: MockQuickChart,
  };
});

describe('CallbackHandlers - Regression Tests', () => {
  let callbackHandlers: CallbackHandlers;
  let expenseService: ExpenseService;
  let historyService: HistoryService;
  let analyticsService: AnalyticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    expenseService = new ExpenseService();
    historyService = new HistoryService();
    analyticsService = new AnalyticsService();
    callbackHandlers = new CallbackHandlers(
      expenseService,
      historyService,
      analyticsService
    );
  });

  describe('menu_balance callback', () => {
    it('should use new detailed balance method from ExpenseService', async () => {
      const mockCtx = {
        session: {},
        callbackQuery: { data: 'menu_balance' },
        answerCbQuery: vi.fn().mockResolvedValue({}),
        reply: vi.fn().mockResolvedValue({}),
      };

      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };

      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan as any)
        .mockResolvedValueOnce(mockHweiYeen as any);

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        {
          payerId: BigInt(1),
          amountSGD: 100,
          bryanPercentage: 0.7,
          hweiYeenPercentage: 0.3,
          payer: mockBryan,
        },
      ] as any);

      await callbackHandlers.handleCallback(mockCtx as any);

      expect(mockCtx.answerCbQuery).toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('💰 **Balance Summary**'),
        { parse_mode: 'Markdown' }
      );
    });
  });

  describe('menu_reports callback', () => {
    it('should use new formatMonthlyReportMessage method', async () => {
      const mockCtx = {
        session: {},
        callbackQuery: { data: 'menu_reports' },
        answerCbQuery: vi.fn().mockResolvedValue({}),
        reply: vi.fn().mockResolvedValue({}),
      };

      const mockBryan = { id: BigInt(1), role: 'Bryan', name: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen', name: 'Hwei Yeen' };

      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan as any)
        .mockResolvedValueOnce(mockHweiYeen as any);

      vi.mocked(prisma.transaction.findMany)
        .mockResolvedValueOnce([]) // For sample transactions log
        .mockResolvedValueOnce([    // For actual report query
          {
            id: BigInt(1),
            amountSGD: 100,
            category: 'Food',
            payerId: BigInt(1),
            date: new Date('2025-12-29'),
            payer: mockBryan,
          },
        ] as any);

      await callbackHandlers.handleCallback(mockCtx as any);

      expect(mockCtx.answerCbQuery).toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('📊 **Monthly Report'),
        { parse_mode: 'Markdown' }
      );
    });
  });

  describe('menu_unsettled callback', () => {
    it('should show unsettled transactions', async () => {
      const mockCtx = {
        session: {},
        callbackQuery: { data: 'menu_unsettled' },
        answerCbQuery: vi.fn().mockResolvedValue({}),
        reply: vi.fn().mockResolvedValue({}),
      };

      const mockBryan = { id: BigInt(1), role: 'Bryan', name: 'Bryan' };

      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan as any)
        .mockResolvedValueOnce({ id: BigInt(2), role: 'HweiYeen' } as any);

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        {
          id: BigInt(1),
          amountSGD: 50,
          description: 'Test',
          date: new Date(),
          payerId: BigInt(1),
          payer: mockBryan,
          bryanPercentage: 0.7,
          hweiYeenPercentage: 0.3,
        },
      ] as any);

      await callbackHandlers.handleCallback(mockCtx as any);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('🧾 **Unsettled Transactions**'),
        { parse_mode: 'Markdown' }
      );
    });
  });

  describe('settle_confirm callback', () => {
    it('should mark all transactions as settled', async () => {
      const mockCtx = {
        session: {},
        callbackQuery: { data: 'settle_confirm' },
        answerCbQuery: vi.fn().mockResolvedValue({}),
        reply: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(prisma.transaction.updateMany).mockResolvedValue({ count: 5 } as any);

      await callbackHandlers.handleCallback(mockCtx as any);

      expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
        where: { isSettled: false },
        data: { isSettled: true },
      });

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('All Settled')
      );
    });
  });

  describe('menu_history callback', () => {
    it('should display transaction history', async () => {
      const mockCtx = {
        session: {},
        callbackQuery: { data: 'menu_history' },
        answerCbQuery: vi.fn().mockResolvedValue({}),
        reply: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        {
          id: BigInt(1),
          date: new Date(),
          description: 'Test Transaction',
          amountSGD: 50,
          currency: 'SGD',
          isSettled: false,
          category: 'Food',
          payer: { name: 'Bryan' },
        },
      ] as any);

      vi.mocked(prisma.transaction.count).mockResolvedValue(1);

      await callbackHandlers.handleCallback(mockCtx as any);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('📜 **Transaction History**'),
        expect.any(Object)
      );
    });
  });

  describe('edit_last_delete callback', () => {
    it('should delete transaction when confirmed', async () => {
      const mockCtx = {
        session: {},
        callbackQuery: { data: 'edit_last_delete_123' },
        answerCbQuery: vi.fn().mockResolvedValue({}),
        reply: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(prisma.transaction.delete).mockResolvedValue({} as any);

      await callbackHandlers.handleCallback(mockCtx as any);

      expect(prisma.transaction.delete).toHaveBeenCalledWith({
        where: { id: BigInt(123) },
      });

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('🗑️ Transaction deleted')
      );
    });
  });
});


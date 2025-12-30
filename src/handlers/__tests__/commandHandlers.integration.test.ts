import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandHandlers } from '../commandHandlers';
import { ExpenseService } from '../../services/expenseService';
import { AnalyticsService } from '../../services/analyticsService';
import { prisma } from '../../lib/prisma';
import { USER_IDS } from '../../config';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    recurringExpense: {
      create: vi.fn(),
    },
    settings: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('CommandHandlers - Regression Tests', () => {
  let commandHandlers: CommandHandlers;
  let expenseService: ExpenseService;
  let analyticsService: AnalyticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    expenseService = new ExpenseService();
    analyticsService = new AnalyticsService();
    commandHandlers = new CommandHandlers(expenseService, analyticsService);
  });

  describe('/balance command', () => {
    it('should return simple balance message when no transactions', async () => {
      const mockCtx = {
        reply: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce({ id: BigInt(1), role: 'Bryan' } as any)
        .mockResolvedValueOnce({ id: BigInt(2), role: 'HweiYeen' } as any);
      
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      await commandHandlers.handleBalance(mockCtx as any);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('All expenses are settled'),
        { parse_mode: 'Markdown' }
      );
    });

    it('should show correct debt when Bryan paid more', async () => {
      const mockCtx = {
        reply: vi.fn().mockResolvedValue({}),
      };

      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };

      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan as any)
        .mockResolvedValueOnce(mockHweiYeen as any);
      
      // Bryan paid $100, 70/30 split means Hwei Yeen owes $30
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        {
          payerId: BigInt(1),
          amountSGD: 100,
          bryanPercentage: 0.7,
          hweiYeenPercentage: 0.3,
        } as any,
      ]);

      await commandHandlers.handleBalance(mockCtx as any);

      const calledMessage = mockCtx.reply.mock.calls[0][0];
      expect(calledMessage).toContain('Hwei Yeen owes Bryan');
      expect(calledMessage).toContain('30.00');
    });
  });

  describe('/recurring command', () => {
    it('should parse and create recurring expense with quoted description', async () => {
      const mockCtx = {
        message: { text: '/recurring add "Internet Bill" 50 15 bryan' },
        from: { id: '123' },
        reply: vi.fn().mockResolvedValue({}),
      };

      const mockUser = { id: BigInt(1), role: 'Bryan' };
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.recurringExpense.create).mockResolvedValue({
        id: BigInt(1),
        description: 'Internet Bill',
        amountOriginal: 50,
        dayOfMonth: 15,
      } as any);

      await commandHandlers.handleRecurring(mockCtx as any);

      expect(prisma.recurringExpense.create).toHaveBeenCalledWith({
        data: {
          description: 'Internet Bill',
          amountOriginal: 50,
          payerId: BigInt(1),
          dayOfMonth: 15,
          isActive: true,
        },
      });

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅ Recurring expense added')
      );
    });

    it('should handle smart quotes from iPhone', async () => {
      const mockCtx = {
        message: { text: '/recurring add "Internet Bill" 50 15 bryan' },
        from: { id: '123' },
        reply: vi.fn().mockResolvedValue({}),
      };

      const mockUser = { id: BigInt(1), role: 'Bryan' };
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.recurringExpense.create).mockResolvedValue({} as any);

      await commandHandlers.handleRecurring(mockCtx as any);

      expect(prisma.recurringExpense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: 'Internet Bill',
          }),
        })
      );
    });

    it('should reject invalid payer name', async () => {
      const mockCtx = {
        message: { text: '/recurring add "Test" 10 15 invalid' },
        from: { id: '123' },
        reply: vi.fn().mockResolvedValue({}),
      };

      await commandHandlers.handleRecurring(mockCtx as any);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Invalid payer')
      );
      expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
    });

    it('should parse unquoted single-word descriptions', async () => {
      const mockCtx = {
        message: { text: '/recurring add Netflix 15.99 1 hweiyeen' },
        from: { id: '123' },
        reply: vi.fn().mockResolvedValue({}),
      };

      const mockUser = { id: BigInt(2), role: 'HweiYeen' };
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.recurringExpense.create).mockResolvedValue({} as any);

      await commandHandlers.handleRecurring(mockCtx as any);

      expect(prisma.recurringExpense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: 'Netflix',
            amountOriginal: 15.99,
            dayOfMonth: 1,
          }),
        })
      );
    });
  });

  describe('/history command', () => {
    it('should show empty state when no transactions', async () => {
      const mockCtx = {
        reply: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);
      vi.mocked(prisma.transaction.count).mockResolvedValue(0);

      await commandHandlers.handleHistory(mockCtx as any);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('No transactions found'),
        { parse_mode: 'Markdown' }
      );
    });
  });

  describe('/fixed command (admin only)', () => {
    it('should only allow Bryan to execute', async () => {
      const mockCtx = {
        from: { id: '999' },
        reply: vi.fn(),
      };

      await commandHandlers.handleFixed(mockCtx as any);

      expect(prisma.settings.findUnique).not.toHaveBeenCalled();
    });

    it('should broadcast fix message to broken groups', async () => {
      const mockCtx = {
        from: { id: USER_IDS.BRYAN },
        telegram: {
          sendMessage: vi.fn().mockResolvedValue({}),
        },
        reply: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'broken_groups',
        value: 'group1,group2',
      } as any);

      await commandHandlers.handleFixed(mockCtx as any);

      expect(mockCtx.telegram.sendMessage).toHaveBeenCalledTimes(2);
      expect(prisma.settings.update).toHaveBeenCalledWith({
        where: { key: 'broken_groups' },
        data: { value: '' },
      });
    });
  });

  describe('/detailedBalance command', () => {
    it('should use new detailed balance calculation', async () => {
      const mockCtx = {
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

      await commandHandlers.handleDetailedBalance(mockCtx as any);

      const calledMessage = mockCtx.reply.mock.calls[0][0];
      expect(calledMessage).toContain('💰 **Balance Summary**');
      expect(calledMessage).toContain('Total Paid by Bryan');
      expect(calledMessage).toContain('Split Calculation');
    });
  });
});


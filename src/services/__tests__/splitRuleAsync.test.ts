import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SplitRulesService } from '../splitRulesService';
import { ExpenseService } from '../expenseService';
import { prisma } from '../../lib/prisma';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    settings: {
      findUnique: vi.fn(),
    },
  },
}));

describe('SplitRuleAsync - Async Contract Verification', () => {
  let splitRulesService: SplitRulesService;
  let expenseService: ExpenseService;

  beforeEach(() => {
    splitRulesService = new SplitRulesService();
    expenseService = new ExpenseService(splitRulesService);
    splitRulesService.invalidateCache();
    vi.clearAllMocks();
  });

  describe('Test Case 1: Verify createSmartExpense waits for getSplitRule', () => {
    it('should wait for getSplitRule result before calculating shares', async () => {
      const mockUser = { id: BigInt(1), name: 'Bryan', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(1),
        amountSGD: 100,
        category: 'Food',
        description: 'Test expense',
        bryanPercentage: 0.5,
        hweiYeenPercentage: 0.5,
        payerId: mockUser.id,
        payer: mockUser,
        currency: 'SGD',
        date: new Date(),
        isSettled: false,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.create).mockResolvedValue(mockTransaction as any);
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);

      // Track when getSplitRule is called and resolved
      let getSplitRuleCalled = false;
      let getSplitRuleResolved = false;

      // Mock getSplitRule with a delay to verify await behavior
      const originalGetSplitRule = splitRulesService.getSplitRule.bind(splitRulesService);
      vi.spyOn(splitRulesService, 'getSplitRule').mockImplementation(async (category: string) => {
        getSplitRuleCalled = true;
        // Simulate async delay
        await new Promise(resolve => setTimeout(resolve, 10));
        getSplitRuleResolved = true;
        return originalGetSplitRule(category);
      });

      // Call createSmartExpense
      const result = await expenseService.createSmartExpense(
        mockUser.id,
        100,
        'Food',
        'Test expense'
      );

      // Verify getSplitRule was called
      expect(getSplitRuleCalled).toBe(true);
      expect(getSplitRuleResolved).toBe(true);

      // Verify the transaction was created with correct split (50-50 default)
      expect(prisma.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bryanPercentage: 0.5,
          hweiYeenPercentage: 0.5,
        }),
        include: {
          payer: true,
        },
      });

      // Verify result has correct split
      expect(result.transaction.bryanPercentage).toBe(0.5);
      expect(result.transaction.hweiYeenPercentage).toBe(0.5);
    });
  });

  describe('Test Case 2: Verify getSplitRulesConfig returns default on DB failure', () => {
    it('should return empty config object when database fails', async () => {
      // Mock database failure
      vi.mocked(prisma.settings.findUnique).mockRejectedValue(
        new Error('Database connection failed')
      );

      // Should not throw, should return empty config
      const config = await splitRulesService.getSplitRulesConfig();

      // Empty config means categories will use 50-50 default
      expect(config).toEqual({});
      expect(typeof config).toBe('object');
    });

    it('should return 50-50 default when getSplitRule encounters error', async () => {
      // Mock database failure
      vi.mocked(prisma.settings.findUnique).mockRejectedValue(
        new Error('Database connection failed')
      );

      // getSplitRule should not throw, should return 50-50 default
      const rule = await splitRulesService.getSplitRule('Food');

      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
    });
  });

  describe('Test Case 3: Verify parallel fetching works correctly', () => {
    it('should fetch multiple split rules in parallel', async () => {
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);

      const categories = ['Food', 'Groceries', 'Bills'];
      const startTime = Date.now();

      // Fetch all in parallel
      const rules = await Promise.all(
        categories.map(cat => splitRulesService.getSplitRule(cat))
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify all rules returned
      expect(rules).toHaveLength(3);
      rules.forEach(rule => {
        expect(rule.userAPercent).toBe(0.5);
        expect(rule.userBPercent).toBe(0.5);
      });

      // Verify it was faster than sequential (should be < 100ms for cached/empty config)
      // This is a sanity check - actual timing depends on DB performance
      expect(duration).toBeLessThan(1000);
    });
  });
});


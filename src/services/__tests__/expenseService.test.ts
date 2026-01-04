import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExpenseService } from '../expenseService';
import { prisma } from '../../lib/prisma';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    settings: {
      findUnique: vi.fn(),
    },
  },
}));

describe('ExpenseService', () => {
  let expenseService: ExpenseService;

  beforeEach(() => {
    expenseService = new ExpenseService();
    vi.clearAllMocks();
  });

  describe('calculateTransactionOwed', () => {
    it('should calculate 70/30 split correctly when Bryan pays', () => {
      const result = expenseService.calculateTransactionOwed(100, 'Bryan');
      expect(result.hweiYeenOwes).toBe(30);
      expect(result.bryanOwes).toBe(0);
    });

    it('should calculate 70/30 split correctly when Hwei Yeen pays', () => {
      const result = expenseService.calculateTransactionOwed(100, 'HweiYeen');
      expect(result.bryanOwes).toBe(70);
      expect(result.hweiYeenOwes).toBe(0);
    });

    it('should respect custom split percentages', () => {
      const result = expenseService.calculateTransactionOwed(100, 'Bryan', 0.5, 0.5);
      expect(result.hweiYeenOwes).toBe(50);
      expect(result.bryanOwes).toBe(0);
    });
  });

  describe('calculateOutstandingBalance', () => {
    it('should calculate total balance correctly', async () => {
      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };
      
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockBryan as any);
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockHweiYeen as any);
      
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
        { payerId: BigInt(1), amountSGD: 100, isSettled: false, bryanPercentage: 0.7, hweiYeenPercentage: 0.3 },
        { payerId: BigInt(2), amountSGD: 100, isSettled: false, bryanPercentage: 0.7, hweiYeenPercentage: 0.3 },
      ] as any);

      const result = await expenseService.calculateOutstandingBalance();
      
      // Bryan paid 100, owes 70 + 70 = 140. Bryan share paid = 100. Bryan still owes 40.
      // Hwei Yeen paid 100, owes 30 + 30 = 60. Hwei Yeen share paid = 100. Hwei Yeen owes 0.
      expect(result.bryanOwes).toBe(40);
      expect(result.hweiYeenOwes).toBe(0);
    });
  });

  describe('createSmartExpense', () => {
    const mockBryan = { id: BigInt(1), name: 'Bryan', role: 'Bryan' };
    const mockTransaction = {
      id: BigInt(1),
      amountSGD: 100,
      category: 'Groceries',
      description: 'Weekly groceries',
      bryanPercentage: 0.7,
      hweiYeenPercentage: 0.3,
      payerId: mockBryan.id,
      payer: mockBryan,
      currency: 'SGD',
      date: new Date(),
      isSettled: false,
    };

    beforeEach(() => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockBryan as any);
      vi.mocked(prisma.transaction.create).mockResolvedValue(mockTransaction as any);
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockBryan as any);
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);
      // Mock settings for SplitRulesService (returns null = no custom config, use defaults)
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
    });

    describe('Split Logic - All Categories Default to 50/50', () => {
      it('should apply 50/50 split for Groceries (default)', async () => {
        const mockTx = { ...mockTransaction, category: 'Groceries', bryanPercentage: 0.5, hweiYeenPercentage: 0.5 };
        vi.mocked(prisma.transaction.create).mockResolvedValue(mockTx as any);

        const result = await expenseService.createSmartExpense(
          mockBryan.id,
          100,
          'Groceries',
          'Weekly groceries'
        );

        expect(prisma.transaction.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            amountSGD: 100,
            category: 'Groceries',
            description: 'Weekly groceries',
            bryanPercentage: 0.5,
            hweiYeenPercentage: 0.5,
            payerId: mockBryan.id,
          }),
          include: {
            payer: true,
          },
        });
        expect(result.transaction.bryanPercentage).toBe(0.5);
        expect(result.transaction.hweiYeenPercentage).toBe(0.5);
      });

      it('should apply 50/50 split for Bills (default)', async () => {
        const mockTx = { ...mockTransaction, category: 'Bills', bryanPercentage: 0.5, hweiYeenPercentage: 0.5 };
        vi.mocked(prisma.transaction.create).mockResolvedValue(mockTx as any);

        const result = await expenseService.createSmartExpense(
          mockBryan.id,
          50,
          'Bills',
          'Electricity bill'
        );

        expect(prisma.transaction.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            bryanPercentage: 0.5,
            hweiYeenPercentage: 0.5,
          }),
          include: {
            payer: true,
          },
        });
        expect(result.transaction.bryanPercentage).toBe(0.5);
        expect(result.transaction.hweiYeenPercentage).toBe(0.5);
      });

      it('should apply 50/50 split for Shopping (default)', async () => {
        const mockTx = { ...mockTransaction, category: 'Shopping', bryanPercentage: 0.5, hweiYeenPercentage: 0.5 };
        vi.mocked(prisma.transaction.create).mockResolvedValue(mockTx as any);

        const result = await expenseService.createSmartExpense(
          mockBryan.id,
          200,
          'Shopping',
          'Furniture'
        );

        expect(prisma.transaction.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            bryanPercentage: 0.5,
            hweiYeenPercentage: 0.5,
          }),
          include: {
            payer: true,
          },
        });
        expect(result.transaction.bryanPercentage).toBe(0.5);
        expect(result.transaction.hweiYeenPercentage).toBe(0.5);
      });
    });

    describe('Split Logic - Personal Categories (50/50)', () => {
      it('should apply 50/50 split for Food', async () => {
        const mockTx = { ...mockTransaction, category: 'Food', bryanPercentage: 0.5, hweiYeenPercentage: 0.5 };
        vi.mocked(prisma.transaction.create).mockResolvedValue(mockTx as any);

        const result = await expenseService.createSmartExpense(
          mockBryan.id,
          80,
          'Food',
          'Dinner'
        );

        expect(prisma.transaction.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            bryanPercentage: 0.5,
            hweiYeenPercentage: 0.5,
          }),
          include: {
            payer: true,
          },
        });
        expect(result.transaction.bryanPercentage).toBe(0.5);
        expect(result.transaction.hweiYeenPercentage).toBe(0.5);
      });

      it('should apply 50/50 split for Travel', async () => {
        const mockTx = { ...mockTransaction, category: 'Travel', bryanPercentage: 0.5, hweiYeenPercentage: 0.5 };
        vi.mocked(prisma.transaction.create).mockResolvedValue(mockTx as any);

        const result = await expenseService.createSmartExpense(
          mockBryan.id,
          500,
          'Travel',
          'Flight tickets'
        );

        expect(prisma.transaction.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            bryanPercentage: 0.5,
            hweiYeenPercentage: 0.5,
          }),
          include: {
            payer: true,
          },
        });
        expect(result.transaction.bryanPercentage).toBe(0.5);
        expect(result.transaction.hweiYeenPercentage).toBe(0.5);
      });

      it('should apply 50/50 split for Entertainment', async () => {
        const mockTx = { ...mockTransaction, category: 'Entertainment', bryanPercentage: 0.5, hweiYeenPercentage: 0.5 };
        vi.mocked(prisma.transaction.create).mockResolvedValue(mockTx as any);

        const result = await expenseService.createSmartExpense(
          mockBryan.id,
          60,
          'Entertainment',
          'Games'
        );

        expect(prisma.transaction.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            bryanPercentage: 0.5,
            hweiYeenPercentage: 0.5,
          }),
          include: {
            payer: true,
          },
        });
        expect(result.transaction.bryanPercentage).toBe(0.5);
        expect(result.transaction.hweiYeenPercentage).toBe(0.5);
      });

      it('should apply 50/50 split for Transport', async () => {
        const mockTx = { ...mockTransaction, category: 'Transport', bryanPercentage: 0.5, hweiYeenPercentage: 0.5 };
        vi.mocked(prisma.transaction.create).mockResolvedValue(mockTx as any);

        const result = await expenseService.createSmartExpense(
          mockBryan.id,
          20,
          'Transport',
          'Grab ride'
        );

        expect(prisma.transaction.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            bryanPercentage: 0.5,
            hweiYeenPercentage: 0.5,
          }),
          include: {
            payer: true,
          },
        });
        expect(result.transaction.bryanPercentage).toBe(0.5);
        expect(result.transaction.hweiYeenPercentage).toBe(0.5);
      });
    });

    describe('Default Split Logic', () => {
      it('should default to 50/50 for unknown categories', async () => {
        const mockTx = { ...mockTransaction, category: 'Other', bryanPercentage: 0.5, hweiYeenPercentage: 0.5 };
        vi.mocked(prisma.transaction.create).mockResolvedValue(mockTx as any);

        const result = await expenseService.createSmartExpense(
          mockBryan.id,
          100,
          'UnknownCategory',
          'Some expense'
        );

        expect(prisma.transaction.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            bryanPercentage: 0.5,
            hweiYeenPercentage: 0.5,
          }),
          include: {
            payer: true,
          },
        });
        expect(result.transaction.bryanPercentage).toBe(0.5);
        expect(result.transaction.hweiYeenPercentage).toBe(0.5);
      });
    });

    it('should return balance message', async () => {
      const result = await expenseService.createSmartExpense(
        mockBryan.id,
        100,
        'Groceries',
        'Weekly groceries'
      );

      expect(result.balanceMessage).toBeDefined();
      expect(typeof result.balanceMessage).toBe('string');
    });
  });

  describe('getFunConfirmation', () => {
    it('should return a confirmation message for Food category', () => {
      const result = expenseService.getFunConfirmation('Food');
      expect(result).toMatch(/^(Yum! 🍜|Delicious! 🍕|Bon appétit! 🍽️|Tasty! 🥘)$/);
    });

    it('should return a confirmation message for Bills category', () => {
      const result = expenseService.getFunConfirmation('Bills');
      expect(result).toMatch(/^(💸 Money flies!|💰 Bills paid!|💳 Charged!|📄 Documented!)$/);
    });

    it('should return a confirmation message for all valid categories', () => {
      const categories = ['Food', 'Bills', 'Travel', 'Groceries', 'Shopping', 'Transport', 'Entertainment', 'Medical', 'Other'];
      categories.forEach(category => {
        const result = expenseService.getFunConfirmation(category);
        expect(result).toBeTruthy();
        expect(result.length).toBeGreaterThan(0);
      });
    });

    it('should return random confirmation from available options', () => {
      // Run multiple times to verify randomness
      const results = new Set();
      for (let i = 0; i < 20; i++) {
        results.add(expenseService.getFunConfirmation('Food'));
      }
      // Should have at least 2 different results (randomization working)
      expect(results.size).toBeGreaterThan(1);
    });

    it('should default to Other category for unknown categories', () => {
      const result = expenseService.getFunConfirmation('UnknownCategory');
      expect(result).toMatch(/^(✅ Recorded!|📝 Saved!|💼 Logged!|✨ Added!)$/);
    });

    it('should handle null/undefined category gracefully', () => {
      const result1 = expenseService.getFunConfirmation(null as any);
      const result2 = expenseService.getFunConfirmation(undefined as any);
      expect(result1).toBeTruthy();
      expect(result2).toBeTruthy();
    });
  });
});


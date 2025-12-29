import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExpenseService } from '../expenseService';
import { prisma } from '../../lib/prisma';

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
});


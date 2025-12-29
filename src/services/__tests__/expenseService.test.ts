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

    it('should handle mixed split percentages (weighted calculation)', async () => {
      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };
      
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockBryan as any);
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockHweiYeen as any);
      
      // Transaction 1: Bryan pays $100 at 70/30 split
      // Transaction 2: Hwei Yeen pays $200 at 50/50 split
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
        { payerId: BigInt(1), amountSGD: 100, isSettled: false, bryanPercentage: 0.7, hweiYeenPercentage: 0.3 },
        { payerId: BigInt(2), amountSGD: 200, isSettled: false, bryanPercentage: 0.5, hweiYeenPercentage: 0.5 },
      ] as any);

      const result = await expenseService.calculateOutstandingBalance();
      
      // Bryan paid: 100, Bryan share: 70 + 100 = 170, Bryan net: 100 - 170 = -70 (Bryan owes 70)
      // Hwei Yeen paid: 200, Hwei Yeen share: 30 + 100 = 130, Hwei Yeen net: 200 - 130 = 70 (Hwei Yeen is owed 70)
      expect(result.bryanOwes).toBe(70);
      expect(result.hweiYeenOwes).toBe(0);
    });

    it('should handle 50/50 split correctly', async () => {
      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };
      
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockBryan as any);
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockHweiYeen as any);
      
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
        { payerId: BigInt(1), amountSGD: 100, isSettled: false, bryanPercentage: 0.5, hweiYeenPercentage: 0.5 },
      ] as any);

      const result = await expenseService.calculateOutstandingBalance();
      
      // Bryan paid 100, shares 50/50, so Hwei Yeen owes 50
      expect(result.bryanOwes).toBe(0);
      expect(result.hweiYeenOwes).toBe(50);
    });

    it('should handle PAYER_ONLY split (100% paid by payer)', async () => {
      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };
      
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockBryan as any);
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockHweiYeen as any);
      
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
        { payerId: BigInt(1), amountSGD: 100, isSettled: false, bryanPercentage: 1.0, hweiYeenPercentage: 0.0 },
      ] as any);

      const result = await expenseService.calculateOutstandingBalance();
      
      // Bryan paid 100, but 100% his responsibility, so no one owes anyone
      expect(result.bryanOwes).toBe(0);
      expect(result.hweiYeenOwes).toBe(0);
    });

    it('should return zeros when no unsettled transactions', async () => {
      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };
      
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockBryan as any);
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(mockHweiYeen as any);
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([]);

      const result = await expenseService.calculateOutstandingBalance();
      
      expect(result.bryanOwes).toBe(0);
      expect(result.hweiYeenOwes).toBe(0);
    });
  });
});


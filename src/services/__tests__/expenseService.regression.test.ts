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
      create: vi.fn(),
    },
  },
}));

describe('ExpenseService - Regression Tests for Refactored Methods', () => {
  let expenseService: ExpenseService;

  beforeEach(() => {
    vi.clearAllMocks();
    expenseService = new ExpenseService();
  });

  describe('calculateDetailedBalance (new method)', () => {
    it('should match old handleCheckBalance logic exactly', async () => {
      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };

      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan as any)
        .mockResolvedValueOnce(mockHweiYeen as any);

      // Mixed split scenario: one 70/30, one 50/50
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        {
          payerId: BigInt(1),
          amountSGD: 100,
          bryanPercentage: 0.7,
          hweiYeenPercentage: 0.3,
          payer: mockBryan,
        },
        {
          payerId: BigInt(2),
          amountSGD: 200,
          bryanPercentage: 0.5,
          hweiYeenPercentage: 0.5,
          payer: mockHweiYeen,
        },
      ] as any);

      const result = await expenseService.calculateDetailedBalance();

      // Verify calculations
      expect(result.bryanPaid).toBe(100);
      expect(result.hweiYeenPaid).toBe(200);
      expect(result.bryanShare).toBe(170); // 70 + 100
      expect(result.hweiYeenShare).toBe(130); // 30 + 100
      expect(result.totalSpending).toBe(300);
      
      // Weighted average: (100*0.7 + 200*0.5) / 300 = 170/300 = 56.67%
      expect(result.avgBryanPercent).toBeCloseTo(56.67, 1);
      expect(result.avgHweiYeenPercent).toBeCloseTo(43.33, 1);

      // Net: Bryan paid 100 but owes 170 = -70 (Bryan owes 70)
      expect(result.bryanNet).toBe(-70);
      expect(result.hweiYeenNet).toBe(70);
    });

    it('should handle all 70/30 split correctly', async () => {
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

      const result = await expenseService.calculateDetailedBalance();

      expect(result.avgBryanPercent).toBe(70);
      expect(result.avgHweiYeenPercent).toBe(30);
      expect(result.bryanNet).toBe(30); // Paid 100, owes 70
      expect(result.hweiYeenNet).toBe(-30); // Paid 0, owes 30
    });

    it('should handle 50/50 split correctly', async () => {
      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };

      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan as any)
        .mockResolvedValueOnce(mockHweiYeen as any);

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        {
          payerId: BigInt(1),
          amountSGD: 100,
          bryanPercentage: 0.5,
          hweiYeenPercentage: 0.5,
          payer: mockBryan,
        },
      ] as any);

      const result = await expenseService.calculateDetailedBalance();

      expect(result.avgBryanPercent).toBe(50);
      expect(result.avgHweiYeenPercent).toBe(50);
      expect(result.bryanNet).toBe(50); // Paid 100, owes 50
      expect(result.hweiYeenNet).toBe(-50); // Paid 0, owes 50
    });

    it('should handle PAYER_ONLY split (100/0)', async () => {
      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };

      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan as any)
        .mockResolvedValueOnce(mockHweiYeen as any);

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        {
          payerId: BigInt(1),
          amountSGD: 100,
          bryanPercentage: 1.0,
          hweiYeenPercentage: 0.0,
          payer: mockBryan,
        },
      ] as any);

      const result = await expenseService.calculateDetailedBalance();

      expect(result.avgBryanPercent).toBe(100);
      expect(result.avgHweiYeenPercent).toBe(0);
      expect(result.bryanNet).toBe(0); // Paid 100, owes 100
      expect(result.hweiYeenNet).toBe(0); // Paid 0, owes 0
    });

    it('should return zeros when no transactions', async () => {
      const mockBryan = { id: BigInt(1), role: 'Bryan' };
      const mockHweiYeen = { id: BigInt(2), role: 'HweiYeen' };

      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan as any)
        .mockResolvedValueOnce(mockHweiYeen as any);

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      const result = await expenseService.calculateDetailedBalance();

      expect(result.bryanPaid).toBe(0);
      expect(result.hweiYeenPaid).toBe(0);
      expect(result.bryanShare).toBe(0);
      expect(result.hweiYeenShare).toBe(0);
      expect(result.totalSpending).toBe(0);
      expect(result.avgBryanPercent).toBe(70); // Default
      expect(result.avgHweiYeenPercent).toBe(30); // Default
    });
  });

  describe('getDetailedBalanceMessage', () => {
    it('should format message identically to old bot.ts logic', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce({ id: BigInt(1), role: 'Bryan' } as any)
        .mockResolvedValueOnce({ id: BigInt(2), role: 'HweiYeen' } as any);

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        {
          payerId: BigInt(1),
          amountSGD: 100,
          bryanPercentage: 0.7,
          hweiYeenPercentage: 0.3,
          payer: { id: BigInt(1), role: 'Bryan' },
        },
      ] as any);

      const message = await expenseService.getDetailedBalanceMessage();

      // Verify message contains expected elements
      expect(message).toContain('💰 **Balance Summary**');
      expect(message).toContain('Total Paid by Bryan');
      expect(message).toContain('Total Paid by Hwei Yeen');
      expect(message).toContain('Split Calculation');
      expect(message).toContain('👉'); // Should show who owes
      expect(message).toContain('30.00'); // Hwei Yeen owes $30
    });

    it('should show Bryan owes when he underpaid', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce({ id: BigInt(1), role: 'Bryan' } as any)
        .mockResolvedValueOnce({ id: BigInt(2), role: 'HweiYeen' } as any);

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        {
          payerId: BigInt(2), // Hwei Yeen paid
          amountSGD: 100,
          bryanPercentage: 0.7,
          hweiYeenPercentage: 0.3,
          payer: { id: BigInt(2), role: 'HweiYeen' },
        },
      ] as any);

      const message = await expenseService.getDetailedBalanceMessage();

      expect(message).toContain('Bryan owes Hwei Yeen');
      expect(message).toContain('70.00'); // Bryan owes $70
    });

    it('should show settled when balanced', async () => {
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce({ id: BigInt(1), role: 'Bryan' } as any)
        .mockResolvedValueOnce({ id: BigInt(2), role: 'HweiYeen' } as any);

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      const message = await expenseService.getDetailedBalanceMessage();

      expect(message).toContain('✅ All settled!');
    });
  });

  describe('recordAISavedTransactions', () => {
    it('should maintain backward compatibility with AI service', async () => {
      const receiptData = {
        total: 100,
        merchant: 'Test Merchant',
        category: 'Food',
        date: '2025-12-29',
      };

      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce({ id: BigInt(1), role: 'Bryan' } as any)
        .mockResolvedValueOnce({ id: BigInt(2), role: 'HweiYeen' } as any);

      vi.mocked(prisma.transaction.create).mockResolvedValue({
        id: BigInt(1),
        amountSGD: 100,
        description: 'Test Merchant',
        category: 'Food',
        payer: { id: BigInt(1), role: 'Bryan' },
      } as any);

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      const result = await expenseService.recordAISavedTransactions(
        receiptData,
        BigInt(1)
      );

      expect(result.savedTransactions).toHaveLength(1);
      expect(result.balanceMessage).toContain('All expenses are settled');
    });
  });
});


import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsService } from '../analyticsService';
import { prisma } from '../../lib/prisma';
import * as dateHelpers from '../../utils/dateHelpers';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    systemLog: {
      findMany: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
    dailyStats: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../utils/dateHelpers', async () => {
  const actual = await vi.importActual('../../utils/dateHelpers') as any;
  return {
    ...actual,
    getStartOfDay: vi.fn((d) => d),
    getEndOfDay: vi.fn((d) => d),
    getDaysAgo: vi.fn((n, d) => new Date(d.getTime() - n * 24 * 60 * 60 * 1000)),
    getHour: vi.fn((d) => d.getHours()),
    getNow: vi.fn(() => new Date('2025-12-29T12:00:00Z')),
  };
});

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;

  beforeEach(() => {
    analyticsService = new AnalyticsService();
    vi.clearAllMocks();
  });

  describe('calculateDailyStats', () => {
    it('should calculate stats correctly and upsert to database', async () => {
      const mockDate = new Date('2025-12-28T12:00:00Z');
      
      vi.mocked(prisma.systemLog.findMany).mockResolvedValueOnce([
        { userId: BigInt(1), event: 'command_used', timestamp: mockDate, metadata: {} },
        { userId: BigInt(2), event: 'command_used', timestamp: mockDate, metadata: {} },
        { userId: BigInt(1), event: 'receipt_processed', timestamp: mockDate, metadata: { success: true, latencyMs: 500 } },
        { userId: BigInt(1), event: 'receipt_processed', timestamp: mockDate, metadata: { success: true, latencyMs: 1500 } },
      ] as any);

      vi.mocked(prisma.transaction.findMany)
        .mockResolvedValueOnce([
          { amountSGD: 100 },
          { amountSGD: 50 },
        ] as any) // Daily transactions
        .mockResolvedValueOnce([
          { amountSGD: 700 },
        ] as any); // 7-day transactions

      await analyticsService.calculateDailyStats(mockDate);

      expect(prisma.dailyStats.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { date: expect.any(Date) },
        update: expect.objectContaining({
          dau: 2,
          receiptsProcessed: 2,
          totalSpend: 150,
          avgLatencyMs: 1000,
          peakHour: 20,
          spendVelocity7DayAvg: 100,
        }),
      }));
    });
  });

  describe('getAdminStats', () => {
    it('should return a summary string of week stats', async () => {
      vi.mocked(prisma.dailyStats.findMany).mockResolvedValue([
        {
          date: new Date(),
          dau: 2,
          receiptsProcessed: 5,
          totalSpend: 500,
          avgLatencyMs: 1200,
          peakHour: 18,
          spendVelocity7DayAvg: 70,
        },
      ] as any);

      vi.mocked(prisma.systemLog.findMany).mockResolvedValue([]);
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      const stats = await analyticsService.getAdminStats();
      expect(stats).toContain('Admin Statistics');
      expect(stats).toContain('Receipts Processed: 5');
      expect(stats).toContain('Total Spend: SGD $500.00');
    });
  });
});


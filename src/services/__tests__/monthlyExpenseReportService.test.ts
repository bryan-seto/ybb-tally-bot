import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonthlyExpenseReportService } from '../monthlyExpenseReportService';
import { prisma } from '../../lib/prisma';
import * as dateHelpers from '../../utils/dateHelpers';
import * as config from '../../config';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    transaction: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../utils/dateHelpers', () => ({
  getEndOfPreviousMonth: vi.fn(),
  getMonthsAgo: vi.fn(),
  getStartOfMonth: vi.fn(),
  getNow: vi.fn(),
  getDayOfMonth: vi.fn(),
  getEndOfDay: vi.fn(),
}));

vi.mock('../../config', () => ({
  getUserNameByRole: vi.fn(),
  USER_A_ROLE_KEY: 'Bryan',
  USER_B_ROLE_KEY: 'HweiYeen',
}));

describe('MonthlyExpenseReportService', () => {
  let service: MonthlyExpenseReportService;
  const mockEndDate = new Date('2024-02-29T23:59:59.999Z');
  const mockStartDate = new Date('2023-10-01T00:00:00.000Z');

  beforeEach(() => {
    service = new MonthlyExpenseReportService();
    vi.clearAllMocks();

    // Setup default date mocks
    vi.mocked(dateHelpers.getEndOfPreviousMonth).mockReturnValue(mockEndDate);
    vi.mocked(dateHelpers.getMonthsAgo).mockReturnValue(new Date('2023-10-01T00:00:00.000Z'));
    vi.mocked(dateHelpers.getStartOfMonth).mockReturnValue(mockStartDate);
    vi.mocked(config.getUserNameByRole).mockImplementation((role: string) => {
      if (role === 'Bryan') return 'Bryan';
      if (role === 'HweiYeen') return 'Hy';
      return 'Unknown';
    });
  });

  describe('getLast5MonthsReport', () => {
    it('should calculate correct totals for mixed payers', async () => {
      // Mock transactions: 3 for Bryan (10, 20, 30), 2 for Hy (5, 5)
      const mockTransactions = [
        {
          id: BigInt(1),
          amountSGD: 10,
          payer: { role: 'Bryan' },
          date: new Date('2024-01-15'),
        },
        {
          id: BigInt(2),
          amountSGD: 20,
          payer: { role: 'Bryan' },
          date: new Date('2024-01-20'),
        },
        {
          id: BigInt(3),
          amountSGD: 30,
          payer: { role: 'Bryan' },
          date: new Date('2024-02-10'),
        },
        {
          id: BigInt(4),
          amountSGD: 5,
          payer: { role: 'HweiYeen' },
          date: new Date('2024-01-25'),
        },
        {
          id: BigInt(5),
          amountSGD: 5,
          payer: { role: 'HweiYeen' },
          date: new Date('2024-02-15'),
        },
      ];

      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await service.getLast5MonthsReport();

      // Verify query was called with correct date range
      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          date: {
            gte: mockStartDate,
            lte: mockEndDate,
          },
        },
        include: {
          payer: true,
        },
      });

      // Verify totals: Bryan=60.00, Hy=10.00, Total=70.00
      expect(result).toContain('Bryan');
      expect(result).toContain('Hy');
      expect(result).toContain('60.00');
      expect(result).toContain('10.00');
      expect(result).toContain('70.00');
      expect(result).toContain('SGD $60.00');
      expect(result).toContain('SGD $10.00');
      expect(result).toContain('SGD $70.00');
    });

    it('should handle zero transactions gracefully', async () => {
      // Mock empty transactions array
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

      const result = await service.getLast5MonthsReport();

      // Verify query was called
      expect(prisma.transaction.findMany).toHaveBeenCalled();

      // Verify message mentions "No expenses recorded"
      expect(result).toContain('No expenses recorded');
      expect(result).toContain('5-Month Expense Summary');
      expect(result).toContain('Period:');
    });

    it('should exclude transactions outside date range', async () => {
      // Mock only transactions within the date range (Prisma filters before returning)
      // This simulates what Prisma would actually return after applying the date filter
      const mockTransactions = [
        {
          id: BigInt(2),
          amountSGD: 50, // This is included (within range)
          payer: { role: 'Bryan' },
          date: new Date('2024-01-15'), // Within range (between mockStartDate and mockEndDate)
        },
      ];

      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await service.getLast5MonthsReport();

      // Verify query filters by date range (Prisma handles this, but we verify the query)
      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          date: {
            gte: mockStartDate,
            lte: mockEndDate,
          },
        },
        include: {
          payer: true,
        },
      });

      // The service should only process transactions returned by Prisma (which are already filtered)
      // So we expect only the transaction within range (50) to be counted
      expect(result).toContain('50.00');
      expect(result).not.toContain('100.00'); // Excluded (not in mockTransactions)
      expect(result).not.toContain('25.00'); // Excluded (not in mockTransactions)
    });

    it('should format currency with commas', async () => {
      // Mock transaction with amount 1234.56
      const mockTransactions = [
        {
          id: BigInt(1),
          amountSGD: 1234.56,
          payer: { role: 'Bryan' },
          date: new Date('2024-01-15'),
        },
      ];

      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await service.getLast5MonthsReport();

      // Verify currency formatting with commas
      expect(result).toContain('1,234.56');
      expect(result).toContain('SGD $1,234.56');
    });
  });

  describe('getDetailedMonthlyReport', () => {
    it('should generate detailed breakdown for mixed months', async () => {
      // Mock transactions: Jan 15 ($10 Bryan), Feb 20 ($20 Bryan)
      const mockTransactions = [
        {
          id: BigInt(1),
          amountSGD: 10,
          payer: { role: 'Bryan' },
          date: new Date('2025-01-15'),
        },
        {
          id: BigInt(2),
          amountSGD: 20,
          payer: { role: 'Bryan' },
          date: new Date('2025-02-20'),
        },
      ];

      // Mock date helpers to return Feb 15 as current date (simulating day > 1 scenario)
      const mockNow = new Date('2025-02-15T10:00:00Z');
      vi.mocked(dateHelpers.getNow).mockReturnValue(mockNow);
      vi.mocked(dateHelpers.getDayOfMonth).mockReturnValue(15); // Day > 1
      vi.mocked(dateHelpers.getEndOfDay).mockReturnValue(new Date('2025-02-15T23:59:59.999Z'));
      vi.mocked(dateHelpers.getMonthsAgo).mockReturnValue(new Date('2024-12-01T00:00:00Z')); // 2 months ago
      vi.mocked(dateHelpers.getStartOfMonth).mockReturnValue(new Date('2024-12-01T00:00:00Z'));

      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await service.getDetailedMonthlyReport();

      // Verify title contains "3-Month"
      expect(result).toContain('**3-Month Expense Summary**');
      
      // Verify output does NOT contain "Grand Total"
      expect(result).not.toContain('Grand Total');
      
      // Verify output contains distinct month blocks
      expect(result).toContain('**Jan 2025:**');
      expect(result).toContain('**Feb 2025 (partial):**');
      
      // Verify each month has its own totals
      const janIndex = result.indexOf('**Jan 2025:**');
      const febIndex = result.indexOf('**Feb 2025 (partial):**');
      expect(janIndex).toBeLessThan(febIndex); // Jan comes before Feb
      
      // Verify amounts are in separate blocks
      expect(result).toContain('10.00'); // Jan amount
      expect(result).toContain('20.00'); // Feb amount
    });

    it('should mark current month as partial', async () => {
      // Mock Date: March 15th
      const mockNow = new Date('2025-03-15T10:00:00Z');
      vi.mocked(dateHelpers.getNow).mockReturnValue(mockNow);
      vi.mocked(dateHelpers.getDayOfMonth).mockReturnValue(15); // Day > 1
      vi.mocked(dateHelpers.getEndOfDay).mockReturnValue(new Date('2025-03-15T23:59:59.999Z'));
      vi.mocked(dateHelpers.getMonthsAgo).mockReturnValue(new Date('2025-01-01T00:00:00Z')); // 2 months ago
      vi.mocked(dateHelpers.getStartOfMonth).mockReturnValue(new Date('2025-01-01T00:00:00Z'));

      // Mock transaction: March 10th
      const mockTransactions = [
        {
          id: BigInt(1),
          amountSGD: 50,
          payer: { role: 'Bryan' },
          date: new Date('2025-03-10'),
        },
      ];

      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await service.getDetailedMonthlyReport();

      // Verify title contains "3-Month"
      expect(result).toContain('**3-Month Expense Summary**');
      
      // Verify output does NOT contain "Grand Total"
      expect(result).not.toContain('Grand Total');
      
      // Verify warning message
      expect(result).toContain('⚠️ **Note:** Current month is not yet complete');
      
      // Verify month is marked as partial
      expect(result).toContain('**Mar 2025 (partial):**');
    });

    it('should sort months chronologically', async () => {
      // Mock transactions in non-chronological order: Dec, Oct, Nov
      const mockTransactions = [
        {
          id: BigInt(1),
          amountSGD: 30,
          payer: { role: 'Bryan' },
          date: new Date('2024-12-15'),
        },
        {
          id: BigInt(2),
          amountSGD: 10,
          payer: { role: 'Bryan' },
          date: new Date('2024-10-15'),
        },
        {
          id: BigInt(3),
          amountSGD: 20,
          payer: { role: 'Bryan' },
          date: new Date('2024-11-15'),
        },
      ];

      // Mock date helpers for day > 1 scenario
      const mockNow = new Date('2025-01-15T10:00:00Z');
      vi.mocked(dateHelpers.getNow).mockReturnValue(mockNow);
      vi.mocked(dateHelpers.getDayOfMonth).mockReturnValue(15);
      vi.mocked(dateHelpers.getEndOfDay).mockReturnValue(new Date('2025-01-15T23:59:59.999Z'));
      vi.mocked(dateHelpers.getMonthsAgo).mockReturnValue(new Date('2024-11-01T00:00:00Z')); // 2 months ago
      vi.mocked(dateHelpers.getStartOfMonth).mockReturnValue(new Date('2024-11-01T00:00:00Z'));

      vi.mocked(prisma.transaction.findMany).mockResolvedValue(mockTransactions as any);

      const result = await service.getDetailedMonthlyReport();

      // Verify title contains "3-Month"
      expect(result).toContain('**3-Month Expense Summary**');
      
      // Verify output does NOT contain "Grand Total"
      expect(result).not.toContain('Grand Total');

      // Verify months appear in chronological order (oldest to newest)
      const octIndex = result.indexOf('**Oct 2024:**');
      const novIndex = result.indexOf('**Nov 2024:**');
      const decIndex = result.indexOf('**Dec 2024:**');

      expect(octIndex).toBeLessThan(novIndex);
      expect(novIndex).toBeLessThan(decIndex);
    });
  });
});

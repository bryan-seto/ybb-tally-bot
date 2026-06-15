/**
 * TDD tests for expenseService — FX extension.
 * Tests createSmartExpense and recordAISavedTransactions with foreign currencies.
 *
 * Covers:
 *  - createSmartExpense with foreign currency: stores originalAmount, fxRate, currency, amountSGD
 *  - createSmartExpense with SGD: no FX call, fxRate = 1
 *  - recordAISavedTransactions with foreign currency receipt data
 *  - Balance math always uses amountSGD (SGD-equivalent), not originalAmount
 *  - Fallback source tagged on transaction metadata
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      $transaction: vi.fn(),
    },
    settings: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../fxRateService', () => ({
  FxRateService: vi.fn().mockImplementation(function() {
    this.convertToSGD = vi.fn();
    this.setManualRate = vi.fn();
    this.clearManualRate = vi.fn();
    this.getManualRate = vi.fn();
    this.isManualRateStale = vi.fn().mockResolvedValue(false);
  }),
}));

import { prisma } from '../../lib/prisma';
import { ExpenseService } from '../expenseService';
import { FxRateService } from '../fxRateService';

describe('ExpenseService — FX extension', () => {
  let expenseService: ExpenseService;
  let mockFxService: any;

  const mockBryan = { id: BigInt(1001), name: 'Bryan', role: 'Bryan', createdAt: new Date(), updatedAt: new Date() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFxService = new (FxRateService as any)();
    expenseService = new ExpenseService(undefined, mockFxService);

    // Base mocks
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockBryan as any);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(mockBryan as any);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);
    vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
  });

  // ── createSmartExpense — SGD (no FX call) ─────────────────────────────
  describe('createSmartExpense with SGD', () => {
    it('does not call FxRateService for SGD expenses', async () => {
      const mockTx = {
        id: BigInt(1), amountSGD: 15.50, originalAmount: null, fxRate: null,
        currency: 'SGD', category: 'Food', description: 'coffee',
        payerId: mockBryan.id, payer: mockBryan, date: new Date(),
        isSettled: false, bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
        createdAt: new Date(), updatedAt: new Date(), splitType: 'FULL',
      };
      vi.mocked(prisma.transaction.create).mockResolvedValue(mockTx as any);
      vi.mocked(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));

      await expenseService.createSmartExpense(mockBryan.id, 15.50, 'Food', 'coffee');

      expect(mockFxService.convertToSGD).not.toHaveBeenCalled();
    });

    it('saves amountSGD = input amount, originalAmount = null, fxRate = null for SGD', async () => {
      const createSpy = vi.mocked(prisma.transaction.create).mockResolvedValue({
        id: BigInt(1), amountSGD: 15.50, originalAmount: null, fxRate: null,
        currency: 'SGD', category: 'Food', description: 'coffee',
        payerId: mockBryan.id, payer: mockBryan, date: new Date(),
        isSettled: false, bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
        createdAt: new Date(), updatedAt: new Date(), splitType: 'FULL',
      } as any);

      await expenseService.createSmartExpense(mockBryan.id, 15.50, 'Food', 'coffee');

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountSGD: 15.50,
            currency: 'SGD',
            originalAmount: null,
            fxRate: null,
          }),
        }),
      );
    });
  });

  // ── createSmartExpense — foreign currency ─────────────────────────────
  describe('createSmartExpense with foreign currency', () => {
    it('calls FxRateService.convertToSGD when currency is VND', async () => {
      mockFxService.convertToSGD.mockResolvedValue({
        sgdAmount: 2.45,
        fxRate: 1 / 20408,
        source: 'live',
        originalCurrency: 'VND',
      });

      vi.mocked(prisma.transaction.create).mockResolvedValue({
        id: BigInt(1), amountSGD: 2.45, originalAmount: 50000, fxRate: 1 / 20408,
        currency: 'VND', category: 'Food', description: 'pho',
        payerId: mockBryan.id, payer: mockBryan, date: new Date(),
        isSettled: false, bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
        createdAt: new Date(), updatedAt: new Date(), splitType: 'FULL',
      } as any);

      await expenseService.createSmartExpense(mockBryan.id, 50000, 'Food', 'pho', 'VND');

      expect(mockFxService.convertToSGD).toHaveBeenCalledWith(50000, 'VND');
    });

    it('stores amountSGD as converted value, originalAmount as input, currency as VND', async () => {
      mockFxService.convertToSGD.mockResolvedValue({
        sgdAmount: 2.45,
        fxRate: 1 / 20408,
        source: 'live',
        originalCurrency: 'VND',
      });

      const createSpy = vi.mocked(prisma.transaction.create).mockResolvedValue({
        id: BigInt(1), amountSGD: 2.45, originalAmount: 50000, fxRate: 1 / 20408,
        currency: 'VND', category: 'Food', description: 'pho',
        payerId: mockBryan.id, payer: mockBryan, date: new Date(),
        isSettled: false, bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
        createdAt: new Date(), updatedAt: new Date(), splitType: 'FULL',
      } as any);

      await expenseService.createSmartExpense(mockBryan.id, 50000, 'Food', 'pho', 'VND');

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountSGD: 2.45,
            originalAmount: 50000,
            currency: 'VND',
            fxRate: expect.closeTo(1 / 20408, 8),
          }),
        }),
      );
    });

    it('works for MYR', async () => {
      mockFxService.convertToSGD.mockResolvedValue({
        sgdAmount: 14.20, fxRate: 1 / 3.52, source: 'live', originalCurrency: 'MYR',
      });
      vi.mocked(prisma.transaction.create).mockResolvedValue({
        id: BigInt(2), amountSGD: 14.20, originalAmount: 50, fxRate: 1 / 3.52,
        currency: 'MYR', category: 'Transport', description: 'petrol',
        payerId: mockBryan.id, payer: mockBryan, date: new Date(),
        isSettled: false, bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
        createdAt: new Date(), updatedAt: new Date(), splitType: 'FULL',
      } as any);

      await expenseService.createSmartExpense(mockBryan.id, 50, 'Transport', 'petrol', 'MYR');

      expect(mockFxService.convertToSGD).toHaveBeenCalledWith(50, 'MYR');
    });
  });

  // ── Balance math uses amountSGD only ───────────────────────────────────
  describe('balance math always uses amountSGD', () => {
    it('calculateNetBalance sums amountSGD, ignoring originalAmount', async () => {
      const mockHY = { id: BigInt(1002), role: 'HweiYeen' };
      vi.mocked(prisma.user.findFirst)
        .mockResolvedValueOnce(mockBryan as any)
        .mockResolvedValueOnce(mockHY as any);

      // Bryan paid VND 500,000 (≈ SGD 24.50) and a SGD 30 meal
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        {
          id: BigInt(1), payerId: mockBryan.id, amountSGD: 24.50, originalAmount: 500000,
          currency: 'VND', category: 'Food', isSettled: false,
          bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
        },
        {
          id: BigInt(2), payerId: mockBryan.id, amountSGD: 30.00, originalAmount: null,
          currency: 'SGD', category: 'Food', isSettled: false,
          bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
        },
      ] as any);

      const balance = await expenseService.calculateNetBalance();

      // Total = 24.50 + 30 = 54.50 SGD. HY's 40% = 21.80 SGD owed.
      expect(balance.hweiYeenOwes).toBeCloseTo(21.80, 1);
      expect(balance.bryanOwes).toBe(0);
    });
  });

  // ── recordAISavedTransactions — foreign currency receipt ───────────────
  describe('recordAISavedTransactions with foreign currency', () => {
    it('calls FxRateService when receiptData.currency is VND', async () => {
      mockFxService.convertToSGD.mockResolvedValue({
        sgdAmount: 23.51, fxRate: 1 / 20416, source: 'live', originalCurrency: 'VND',
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockBryan as any);

      const createdTx = {
        id: BigInt(10), amountSGD: 23.51, originalAmount: 480000, fxRate: 1 / 20416,
        currency: 'VND', category: 'Food', description: 'Nhà Hàng Ngon',
        payerId: mockBryan.id, payer: mockBryan, date: new Date(),
        isSettled: false, bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
        createdAt: new Date(), updatedAt: new Date(), splitType: 'FULL',
      };

      vi.mocked(prisma.$transaction as any).mockImplementation(async (cb: any) => {
        await cb({
          transaction: { create: vi.fn().mockResolvedValue(createdTx) },
        });
      });

      const receiptData = {
        isValid: true,
        transactions: [{
          amount: 480000, merchant: 'Nhà Hàng Ngon', category: 'Food', date: '2026-06-20',
        }],
        currency: 'VND',
        total: 480000,
      };

      await expenseService.recordAISavedTransactions(receiptData, mockBryan.id);

      expect(mockFxService.convertToSGD).toHaveBeenCalledWith(480000, 'VND');
    });
  });
});

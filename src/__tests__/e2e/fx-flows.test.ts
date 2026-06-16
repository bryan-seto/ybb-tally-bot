/**
 * E2E tests for foreign currency feature — uses real Postgres test DB.
 *
 * Covers end-to-end user flows with FxRateService mocked (no real HTTP calls):
 *
 *  E2E-FX-1: Text input "VND 50000 pho" → DB row with amountSGD≈2.45, originalAmount=50000, currency=VND
 *  E2E-FX-2: Text input "RM 50 petrol" → DB row with amountSGD≈14.20, currency=MYR
 *  E2E-FX-3: Text input "¥1200 ramen" → DB row with amountSGD correct, currency=JPY
 *  E2E-FX-4: Text input "VND 500,000 hotel" (commas) → DB row amountSGD correct
 *  E2E-FX-5: Photo receipt with VND currency → DB row with originalAmount
 *  E2E-FX-6: Balance message shows SGD-equivalent, not VND
 *  E2E-FX-7: FX API fallback → expense still saved (with fallback source)
 *  E2E-FX-8: Manual rate override → /setrate VND 20000 → next VND expense uses manual rate
 *  E2E-FX-9: Mixed SGD + VND expenses → balance sums amountSGD only
 *  E2E-FX-10: History display shows "VND 50,000 (≈ SGD $2.45)", not raw VND
 *  E2E-FX-11: Stale manual rate (>14 days) → bot warns on next VND expense
 */

import { vi, describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { prisma as testPrisma, setupTestDb, clearDb } from './helpers/prismaTestSetup';
import { createMockContext, createMockUser, createMockPhotoMessage } from './helpers/mockFactory';
import { createTestUsers } from './helpers/testFixtures';

// ── Wire test prisma ──────────────────────────────────────────────────────────
vi.mock('../../lib/prisma', () => ({ prisma: testPrisma }));
export const prisma = testPrisma;

// ── Mock FxRateService so no real HTTP calls ──────────────────────────────────
const mockConvertToSGD = vi.fn();
const mockSetManualRate = vi.fn();
const mockClearManualRate = vi.fn();
const mockIsManualRateStale = vi.fn().mockResolvedValue(false);

vi.mock('../../services/fxRateService', () => ({
  FxRateService: vi.fn().mockImplementation(function() {
    this.convertToSGD = mockConvertToSGD;
    this.setManualRate = mockSetManualRate;
    this.clearManualRate = mockClearManualRate;
    this.isManualRateStale = mockIsManualRateStale;
    this.getManualRate = vi.fn().mockResolvedValue(null);
  }),
}));

// ── Mock AI service + Telegraf ────────────────────────────────────────────────
vi.mock('../../services/ai');
vi.mock('telegraf', () => ({
  Markup: {
    inlineKeyboard: (btns: any) => ({ reply_markup: { inline_keyboard: btns } }),
    button: { callback: (t: string, d: string) => ({ text: t, callback_data: d }) },
  },
}));

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  } as Response),
);

// ── App imports (after mocks) ─────────────────────────────────────────────────
import { PhotoHandler } from '../../handlers/photoHandler';
import { MessageHandlers } from '../../handlers/messageHandlers';
import { AIService } from '../../services/ai';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';

describe('E2E: Foreign Currency', () => {
  const userA = createMockUser(1001, 'bryan', 'Bryan');
  const userB = createMockUser(1002, 'hweiyeen', 'Hwei Yeen');

  let photoHandler: PhotoHandler;
  let messageHandlers: MessageHandlers;
  let mockAIService: any;
  let expenseService: ExpenseService;
  let historyService: HistoryService;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    vi.clearAllMocks();
    mockIsManualRateStale.mockResolvedValue(false);

    await createTestUsers();

    mockAIService = {
      processReceipt: vi.fn(),
      processQuickExpense: vi.fn(),
      processCorrection: vi.fn(),
      parseEditIntent: vi.fn(),
    };
    expenseService = new ExpenseService();
    historyService = new HistoryService();

    photoHandler = new PhotoHandler(mockAIService as any, expenseService, undefined);
    messageHandlers = new MessageHandlers(
      expenseService,
      mockAIService as any,
      historyService,
      () => 'test_bot',
      undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── E2E-FX-1: VND text input ─────────────────────────────────────────────
  it('E2E-FX-1: "VND 50000 pho" creates DB row with amountSGD≈2.45, originalAmount=50000, currency=VND', async () => {
    mockConvertToSGD.mockResolvedValue({
      sgdAmount: 2.45, fxRate: 1 / 20408, source: 'live', originalCurrency: 'VND',
    });

    const ctx = createMockContext('VND 50000 pho', userA);
    await messageHandlers.handleText(ctx);

    const tx = await prisma.transaction.findFirst({ where: { payerId: BigInt(userA.id) } });
    expect(tx).toBeTruthy();
    expect(tx!.currency).toBe('VND');
    expect(Number(tx!.originalAmount)).toBe(50000);
    expect(Number(tx!.amountSGD)).toBeCloseTo(2.45, 1);
    expect(tx!.description).toBe('pho');
    expect(tx!.category).toBe('Food');
  });

  // ── E2E-FX-2: MYR "RM 50 petrol" ────────────────────────────────────────
  it('E2E-FX-2: "RM 50 petrol" creates DB row with currency=MYR, amountSGD≈14.20', async () => {
    mockConvertToSGD.mockResolvedValue({
      sgdAmount: 14.20, fxRate: 1 / 3.52, source: 'live', originalCurrency: 'MYR',
    });

    const ctx = createMockContext('RM 50 petrol', userA);
    await messageHandlers.handleText(ctx);

    const tx = await prisma.transaction.findFirst({ where: { payerId: BigInt(userA.id) } });
    expect(tx).toBeTruthy();
    expect(tx!.currency).toBe('MYR');
    expect(Number(tx!.originalAmount)).toBe(50);
    expect(Number(tx!.amountSGD)).toBeCloseTo(14.20, 1);
  });

  // ── E2E-FX-3: JPY ¥ symbol ───────────────────────────────────────────────
  it('E2E-FX-3: "¥1200 ramen" creates DB row with currency=JPY', async () => {
    mockConvertToSGD.mockResolvedValue({
      sgdAmount: 10.86, fxRate: 1 / 110.5, source: 'live', originalCurrency: 'JPY',
    });

    const ctx = createMockContext('¥1200 ramen', userA);
    await messageHandlers.handleText(ctx);

    const tx = await prisma.transaction.findFirst({ where: { description: 'ramen' } });
    expect(tx).toBeTruthy();
    expect(tx!.currency).toBe('JPY');
    expect(Number(tx!.originalAmount)).toBe(1200);
  });

  // ── E2E-FX-4: VND with commas ────────────────────────────────────────────
  it('E2E-FX-4: "VND 500,000 hotel" strips commas and saves originalAmount=500000', async () => {
    mockConvertToSGD.mockResolvedValue({
      sgdAmount: 24.49, fxRate: 1 / 20408, source: 'live', originalCurrency: 'VND',
    });

    const ctx = createMockContext('VND 500,000 hotel', userA);
    await messageHandlers.handleText(ctx);

    const tx = await prisma.transaction.findFirst({ where: { description: 'hotel' } });
    expect(tx).toBeTruthy();
    expect(Number(tx!.originalAmount)).toBe(500000);
    expect(tx!.currency).toBe('VND');
  });

  // ── E2E-FX-5: Photo receipt with VND ─────────────────────────────────────
  it('E2E-FX-5: photo receipt with VND currency → saves originalAmount in DB', async () => {
    vi.useFakeTimers();

    mockConvertToSGD.mockResolvedValue({
      sgdAmount: 23.51, fxRate: 1 / 20416, source: 'live', originalCurrency: 'VND',
    });

    mockAIService.processReceipt.mockResolvedValue({
      isValid: true,
      transactions: [{ amount: 480000, merchant: 'Nhà Hàng Ngon', category: 'Food', date: '2026-06-20' }],
      currency: 'VND',
      total: 480000,
    });

    const photoMsg = createMockPhotoMessage('photo1', 'path1.jpg');
    const ctx = createMockContext('', userA);
    ctx.message = photoMsg;
    ctx.chat.id = userA.id;
    ctx.telegram.getFile = vi.fn().mockResolvedValue({ file_path: 'path1.jpg' });

    await photoHandler.handlePhoto(ctx);
    await vi.advanceTimersByTimeAsync(11000);
    vi.useRealTimers();
    await new Promise(r => setTimeout(r, 500));

    const tx = await prisma.transaction.findFirst({ where: { description: 'Nhà Hàng Ngon' } });
    expect(tx).toBeTruthy();
    expect(tx!.currency).toBe('VND');
    expect(Number(tx!.originalAmount)).toBe(480000);
    expect(Number(tx!.amountSGD)).toBeCloseTo(23.51, 1);
  });

  // ── E2E-FX-6: Balance uses SGD only ──────────────────────────────────────
  it('E2E-FX-6: balance message shows SGD-equivalent, not VND amount', async () => {
    // Seed a VND transaction directly — simulates post-E2E-FX-1 state
    const bryan = await prisma.user.findFirst({ where: { role: 'Bryan' } });
    await prisma.transaction.create({
      data: {
        amountSGD: 2.45,
        originalAmount: 50000,
        fxRate: 1 / 20408,
        currency: 'VND',
        category: 'Food',
        description: 'pho',
        payerId: bryan!.id,
        date: new Date(),
        bryanPercentage: 0.6,
        hweiYeenPercentage: 0.4,
      },
    });

    const balanceMsg = await expenseService.getOutstandingBalanceMessage();

    // Must show SGD in balance — NOT VND
    expect(balanceMsg).toMatch(/SGD/);
    expect(balanceMsg).not.toMatch(/50,000/); // original VND amount should NOT appear in balance
    expect(balanceMsg).toMatch(/0\.9[0-9]/); // HY's 40% of $2.45 ≈ $0.98
  });

  // ── E2E-FX-7: FX API fallback ────────────────────────────────────────────
  it('E2E-FX-7: when FX API is down, expense still saves using fallback rate', async () => {
    mockConvertToSGD.mockResolvedValue({
      sgdAmount: 2.45, fxRate: 1 / 20000, source: 'fallback', originalCurrency: 'VND',
    });

    const ctx = createMockContext('VND 50000 pho', userA);
    await messageHandlers.handleText(ctx);

    const tx = await prisma.transaction.findFirst({ where: { currency: 'VND' } });
    // Expense must still be saved — fallback doesn't block
    expect(tx).toBeTruthy();
    expect(Number(tx!.amountSGD)).toBeGreaterThan(0);
  });

  // ── E2E-FX-8: Manual rate override ───────────────────────────────────────
  it('E2E-FX-8: after /setrate VND 20000, VND expense uses manual rate (not live rate)', async () => {
    // Simulate manual rate set in Settings
    await prisma.settings.upsert({
      where: { key: 'fx_manual_VND' },
      create: {
        key: 'fx_manual_VND',
        value: JSON.stringify({ rate: 20000, setAt: new Date().toISOString() }),
      },
      update: {
        value: JSON.stringify({ rate: 20000, setAt: new Date().toISOString() }),
      },
    });

    // FxService returns manual rate (as per its priority logic)
    mockConvertToSGD.mockResolvedValue({
      sgdAmount: 2.50, fxRate: 1 / 20000, source: 'manual', originalCurrency: 'VND',
    });

    const ctx = createMockContext('VND 50000 pho', userA);
    await messageHandlers.handleText(ctx);

    const tx = await prisma.transaction.findFirst({ where: { currency: 'VND' } });
    expect(tx).toBeTruthy();
    // Manual rate: 50000 / 20000 = $2.50
    expect(Number(tx!.amountSGD)).toBeCloseTo(2.50, 2);
    // fxRate stored should reflect manual rate
    expect(Number(tx!.fxRate)).toBeCloseTo(1 / 20000, 8);
  });

  // ── E2E-FX-9: Mixed SGD + VND balance ────────────────────────────────────
  it('E2E-FX-9: mixed SGD and VND expenses sum correctly in SGD balance', async () => {
    const bryan = await prisma.user.findFirst({ where: { role: 'Bryan' } });

    // Seed: SGD $30 + VND 480,000 (≈ SGD $23.51) = SGD $53.51 total
    await prisma.transaction.createMany({
      data: [
        {
          amountSGD: 30.00, originalAmount: null, fxRate: null, currency: 'SGD',
          category: 'Food', description: 'dinner', payerId: bryan!.id,
          date: new Date(), bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
        },
        {
          amountSGD: 23.51, originalAmount: 480000, fxRate: 1 / 20416, currency: 'VND',
          category: 'Food', description: 'pho shop', payerId: bryan!.id,
          date: new Date(), bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
        },
      ],
    });

    const balance = await expenseService.calculateNetBalance();
    // Total SGD = 53.51. HY's 40% = 21.40. HY owes Bryan 21.40.
    expect(balance.hweiYeenOwes).toBeCloseTo(21.40, 0);
    expect(balance.bryanOwes).toBe(0);
  });

  // ── E2E-FX-10: History display shows both VND and SGD ────────────────────
  it('E2E-FX-10: history detail card shows original VND amount AND SGD equivalent', async () => {
    const bryan = await prisma.user.findFirst({ where: { role: 'Bryan' } });
    const tx = await prisma.transaction.create({
      data: {
        amountSGD: 2.45, originalAmount: 50000, fxRate: 1 / 20408, currency: 'VND',
        category: 'Food', description: 'pho', payerId: bryan!.id,
        date: new Date(), bryanPercentage: 0.6, hweiYeenPercentage: 0.4,
      },
      include: { payer: true },
    });

    const detail = historyService.formatTransactionDetail(
      historyService.formatTransactionModel(tx as any),
    );

    // Must show BOTH the original VND and SGD equivalent
    expect(detail).toMatch(/VND/);
    expect(detail).toMatch(/50[,.]?000/);
    expect(detail).toMatch(/S\$/);   // new format: "VND 50,000 → S$2.45 (@ ...)"
    expect(detail).toMatch(/2\.4[0-9]/);
  });

  // ── E2E-FX-11: Stale manual rate warning ─────────────────────────────────
  it('E2E-FX-11: bot warns when manual rate is >14 days old on next VND expense', async () => {
    // Rate set 15 days ago
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await prisma.settings.upsert({
      where: { key: 'fx_manual_VND' },
      create: {
        key: 'fx_manual_VND',
        value: JSON.stringify({ rate: 20000, setAt: fifteenDaysAgo.toISOString() }),
      },
      update: {
        value: JSON.stringify({ rate: 20000, setAt: fifteenDaysAgo.toISOString() }),
      },
    });

    // isManualRateStale returns true for this test
    mockIsManualRateStale.mockResolvedValue(true);

    mockConvertToSGD.mockResolvedValue({
      sgdAmount: 2.50, fxRate: 1 / 20000, source: 'manual', originalCurrency: 'VND',
    });

    const ctx = createMockContext('VND 50000 pho', userA);
    await messageHandlers.handleText(ctx);

    // The reply should include a stale rate warning
    const replyCalls = (ctx.reply as any).mock?.calls ?? [];
    const allReplies = replyCalls.map((c: any) => c[0]).join(' ');
    expect(allReplies).toMatch(/manual rate|set.*days ago|still correct|clearrate/i);
  });
});

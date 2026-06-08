/**
 * HY UX Sprint — Failing tests (RED bar)
 *
 * Covers 5 items from the HY experience improvement sprint:
 *   BUG-1: Settlement/Payment rows show 🔴 instead of ✅
 *   BUG-2: calculateDetailedBalance double-counts Settlement transactions
 *   BUG-3: historyService display fallback uses 0.7 instead of 0.5 for null-percent rows
 *   FEAT-1: Settle-up confirmation step before recording
 *   FEAT-2: Dashboard header includes subject (who owes whom)
 *
 * These tests MUST fail before the fixes and pass after.
 * Pre-existing auth.test.ts failures are unrelated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatBalanceHeader } from '../../utils/balanceHeader';
import { HistoryService } from '../historyService';
import { ExpenseService } from '../expenseService';
import { SettleCallbackHandler } from '../../handlers/callbacks/SettleCallbackHandler';
import { prisma } from '../../lib/prisma';

// ─── Config mock (prevents process.exit on missing TELEGRAM_BOT_TOKEN) ────────
vi.mock('../../config', () => ({
  USER_A_ROLE_KEY: 'Bryan',
  USER_B_ROLE_KEY: 'HweiYeen',
  USER_A_ID: '109284773',
  USER_B_ID: '424894363',
  USER_A_NAME: 'Bryan',
  USER_B_NAME: 'Hwei Yeen',
  CONFIG: {
    TELEGRAM_BOT_TOKEN: 'mock:token',
    USER_A_ID: '109284773',
    USER_B_ID: '424894363',
    USER_A_NAME: 'Bryan',
    USER_B_NAME: 'Hwei Yeen',
  },
  getUserNameByRole: (role: string) => role === 'Bryan' ? 'Bryan' : 'Hwei Yeen',
  getUserIdByRole: (role: string) => role === 'Bryan' ? '109284773' : '424894363',
  getUserAName: () => 'Bryan',
  getUserBName: () => 'Hwei Yeen',
  getUserAId: () => '109284773',
  getUserBId: () => '424894363',
  getAllowedUserIds: () => ['109284773', '424894363'],
  isAuthorizedUserId: () => true,
  BOT_USERS: [{ id: '109284773', role: 'Bryan', name: 'Bryan' }, { id: '424894363', role: 'HweiYeen', name: 'Hwei Yeen' }],
  USER_IDS: { Bryan: '109284773', HweiYeen: '424894363' },
  USER_NAMES: { Bryan: 'Bryan', HweiYeen: 'Hwei Yeen' },
}));

// ─── Prisma mock ──────────────────────────────────────────────────────────────
vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    settings: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_BRYAN    = { id: BigInt(1), name: 'Bryan', role: 'Bryan' };
const MOCK_HY       = { id: BigInt(2), name: 'Hwei Yeen', role: 'HweiYeen' };

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: BigInt(1),
    date: new Date('2026-01-01'),
    description: 'Test merchant',
    amountSGD: 100,
    currency: 'SGD',
    isSettled: false,
    category: 'Food',
    bryanPercentage: 0.5,
    hweiYeenPercentage: 0.5,
    payerId: MOCK_BRYAN.id,
    payer: MOCK_BRYAN,
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── BUG-1: Settlement/Payment rows should show ✅ regardless of isSettled flag ─

describe('BUG-1: Settlement/Payment rows display status', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
    vi.clearAllMocks();
  });

  it('Settlement category with isSettled=false should map to status="settled"', async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
      makeTx({ category: 'Settlement', isSettled: false }) as any,
    ]);
    const result = await historyService.getRecentTransactions(1);
    expect(result[0].status).toBe('settled');
  });

  it('Payment category with isSettled=false should map to status="settled"', async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
      makeTx({ category: 'Payment', isSettled: false }) as any,
    ]);
    const result = await historyService.getRecentTransactions(1);
    expect(result[0].status).toBe('settled');
  });

  it('Regular expense with isSettled=false should remain status="unsettled"', async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
      makeTx({ category: 'Food', isSettled: false }) as any,
    ]);
    const result = await historyService.getRecentTransactions(1);
    expect(result[0].status).toBe('unsettled');
  });

  it('Regular expense with isSettled=true should map to status="settled"', async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
      makeTx({ category: 'Food', isSettled: true }) as any,
    ]);
    const result = await historyService.getRecentTransactions(1);
    expect(result[0].status).toBe('settled');
  });
});

// ─── BUG-2: calculateDetailedBalance must exclude Settlement/Payment transactions ─

describe('BUG-2: calculateDetailedBalance excludes Settlement/Payment transactions', () => {
  let expenseService: ExpenseService;

  beforeEach(() => {
    expenseService = new ExpenseService();
    vi.clearAllMocks();
  });

  it('should NOT count Settlement transaction as an expense in bryanPaid', async () => {
    // One real $100 expense by Bryan (70/30) + one $50 Settlement by Bryan
    // Only the $100 should be counted
    vi.mocked(prisma.user.findFirst)
      .mockResolvedValueOnce(MOCK_BRYAN as any)
      .mockResolvedValueOnce(MOCK_HY as any);

    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
      makeTx({ amountSGD: 100, category: 'Food', payerId: MOCK_BRYAN.id, isSettled: false, bryanPercentage: 0.7, hweiYeenPercentage: 0.3 }),
      makeTx({ id: BigInt(2), amountSGD: 50, category: 'Settlement', payerId: MOCK_BRYAN.id, isSettled: false, bryanPercentage: null, hweiYeenPercentage: null }),
    ] as any);

    const result = await expenseService.calculateDetailedBalance();
    // Only the $100 Food transaction should count
    expect(result.bryanPaid).toBe(100);
    expect(result.hweiYeenPaid).toBe(0);
    expect(result.totalSpending).toBe(100);
  });

  it('should return zero totals when only Settlement/Payment transactions exist', async () => {
    vi.mocked(prisma.user.findFirst)
      .mockResolvedValueOnce(MOCK_BRYAN as any)
      .mockResolvedValueOnce(MOCK_HY as any);

    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
      makeTx({ amountSGD: 200, category: 'Settlement', payerId: MOCK_HY.id, isSettled: false, bryanPercentage: null, hweiYeenPercentage: null }),
    ] as any);

    const result = await expenseService.calculateDetailedBalance();
    expect(result.bryanPaid).toBe(0);
    expect(result.hweiYeenPaid).toBe(0);
    expect(result.totalSpending).toBe(0);
  });
});

// ─── BUG-3: historyService display fallback must use 0.5, not 0.7/0.3 ─────────

describe('BUG-3: historyService uses 0.5 fallback for null-percent transactions', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  it('formatTransactionDetail with null percentages should display "50% (Bryan) / 50% (HY)" not "70%/30%"', () => {
    const tx = {
      id: BigInt(42),
      date: new Date('2026-01-01'),
      merchant: 'Old Merchant',
      amount: 100,
      currency: 'SGD',
      status: 'unsettled' as const,
      category: 'Food',
      description: 'Old Merchant',
      paidBy: 'Bryan',
      payerId: MOCK_BRYAN.id,
      payerRole: 'Bryan',
      splitType: undefined,
      bryanPercentage: undefined,   // null → should default to 0.5
      hweiYeenPercentage: undefined,
    };

    const card = historyService.formatTransactionDetail(tx);

    // Must NOT contain 70% or 30% anywhere in the split display
    expect(card).not.toMatch(/70%.*Bryan|Bryan.*70%/);
    expect(card).not.toMatch(/30%.*HY|HY.*30%/);

    // Must show 50/50
    expect(card).toMatch(/50%.*Bryan|Bryan.*50%/);
    expect(card).toMatch(/50%.*HY|HY.*50%/);
  });

  it('formatBalanceImpact shows 50/50 debt math for null-percent Bryan-paid expense', () => {
    // Bryan paid $100, null percentages → should default to 50/50
    // Bryan consumed 50%, HY consumed 50% → HY owes Bryan $50
    const tx = {
      id: BigInt(42),
      date: new Date('2026-01-01'),
      merchant: 'Old Merchant',
      amount: 100,
      currency: 'SGD',
      status: 'unsettled' as const,
      category: 'Food',
      description: 'Old Merchant',
      paidBy: 'Bryan',
      payerId: MOCK_BRYAN.id,
      payerRole: 'Bryan',
      splitType: undefined,
      bryanPercentage: undefined,
      hweiYeenPercentage: undefined,
    };

    const card = historyService.formatTransactionDetail(tx);
    // With 50/50 split and Bryan paid $100: HY owes Bryan $50 (not $30)
    expect(card).toMatch(/\$50\.00/);
    expect(card).not.toMatch(/\$30\.00/);
  });
});

// ─── FEAT-1: Settle-up confirmation step ────────────────────────────────────

describe('FEAT-1: Settle-up confirmation step', () => {
  let settleHandler: SettleCallbackHandler;
  let mockExpenseService: any;
  let mockHistoryService: any;
  let mockRecurringService: any;
  let mockShowDashboard: any;
  let mockCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExpenseService = {
      calculateNetBalance: vi.fn().mockResolvedValue({
        bryanOwes: 0,
        hweiYeenOwes: 551.07,
        netOutstanding: 551.07,
        whoOwes: 'HweiYeen',
        whoIsOwed: 'Bryan',
      }),
      recordPayment: vi.fn().mockResolvedValue({ id: BigInt(99) }),
    };
    mockHistoryService = {};
    mockRecurringService = {};
    mockShowDashboard = vi.fn();

    mockCtx = {
      from: { id: 424894363 }, // HY's user ID
      session: {},
      reply: vi.fn(),
      editMessageText: vi.fn(),
      answerCbQuery: vi.fn(),
    };

    // Mock prisma.user.findUnique to return HY
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_HY as any);

    settleHandler = new SettleCallbackHandler(
      mockExpenseService,
      mockHistoryService as any,
      mockRecurringService as any,
      mockShowDashboard
    );
  });

  it('canHandle should return true for "settle_ok_551.07"', () => {
    expect(settleHandler.canHandle('settle_ok_551.07')).toBe(true);
  });

  it('canHandle should return true for "settle_pay_full_551.07" (unchanged)', () => {
    expect(settleHandler.canHandle('settle_pay_full_551.07')).toBe(true);
  });

  it('settle_pay_full_ should show a CONFIRMATION CARD and NOT record payment immediately', async () => {
    await settleHandler.handle(mockCtx, 'settle_pay_full_551.07');

    // Should NOT have called recordPayment
    expect(mockExpenseService.recordPayment).not.toHaveBeenCalled();

    // Should have sent a confirmation card with amount in it
    expect(mockCtx.reply).toHaveBeenCalled();
    const replyCall = mockCtx.reply.mock.calls[0];
    const messageText: string = typeof replyCall[0] === 'string' ? replyCall[0] : JSON.stringify(replyCall[0]);
    expect(messageText).toMatch(/551\.07|551/);
    // Should have Confirm / confirm button
    const replyMarkup = replyCall[1]?.reply_markup ?? replyCall[1]?.replyMarkup ?? JSON.stringify(replyCall[1]);
    const replyMarkupStr = JSON.stringify(replyMarkup);
    expect(replyMarkupStr.toLowerCase()).toMatch(/confirm|settle_ok/);
  });

  it('settle_ok_ should call recordPayment (finalise the payment)', async () => {
    await settleHandler.handle(mockCtx, 'settle_ok_551.07');
    expect(mockExpenseService.recordPayment).toHaveBeenCalled();
  });
});

// ─── FEAT-2: Dashboard header includes subject ────────────────────────────────

describe('FEAT-2: Dashboard balance header includes subject (who owes whom)', () => {
  /**
   * The header comes from bot.ts getRandomBalanceHeader() or getOutstandingBalanceMessage().
   * That function is not currently exported. BLADE will need to either:
   * (a) Export it from bot.ts, or
   * (b) Extract it into a utility in src/utils/balanceHeader.ts and export from there.
   *
   * For now we test via the ExpenseService.formatOutstandingBalanceMessage()
   * which is the closest exported equivalent, or via getDetailedBalanceMessage.
   * If those don't exist, BLADE should create a testable exported function.
   */

  let expenseService: ExpenseService;

  beforeEach(() => {
    expenseService = new ExpenseService();
    vi.clearAllMocks();
  });

  it('getOutstandingBalanceMessage: when HY owes Bryan, should contain both names', async () => {
    vi.mocked(prisma.user.findFirst)
      .mockResolvedValueOnce(MOCK_BRYAN as any)
      .mockResolvedValueOnce(MOCK_HY as any);
    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
      makeTx({ amountSGD: 100, category: 'Food', payerId: MOCK_BRYAN.id, bryanPercentage: 0.6, hweiYeenPercentage: 0.4 }),
    ] as any);

    const msg = await expenseService.getOutstandingBalanceMessage();
    // Must contain BOTH names (not just "to Bryan")
    expect(msg).toMatch(/Hwei Yeen/i);
    expect(msg).toMatch(/Bryan/i);
    // Must indicate direction (owes)
    expect(msg.toLowerCase()).toMatch(/owes|owe/);
  });

  it('getOutstandingBalanceMessage: when Bryan owes HY, should contain both names', async () => {
    vi.mocked(prisma.user.findFirst)
      .mockResolvedValueOnce(MOCK_BRYAN as any)
      .mockResolvedValueOnce(MOCK_HY as any);
    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([
      makeTx({ amountSGD: 100, category: 'Food', payerId: MOCK_HY.id, bryanPercentage: 0.6, hweiYeenPercentage: 0.4 }),
    ] as any);

    const msg = await expenseService.getOutstandingBalanceMessage();
    expect(msg).toMatch(/Bryan/i);
    expect(msg).toMatch(/Hwei Yeen/i);
    expect(msg.toLowerCase()).toMatch(/owes|owe/);
  });

  it('getOutstandingBalanceMessage: when settled, should indicate settled state', async () => {
    vi.mocked(prisma.user.findFirst)
      .mockResolvedValueOnce(MOCK_BRYAN as any)
      .mockResolvedValueOnce(MOCK_HY as any);
    vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([] as any);

    const msg = await expenseService.getOutstandingBalanceMessage();
    expect(msg.toLowerCase()).toMatch(/settled|all good|even/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROUND 2 — Expanded coverage (gaps surfaced by PAX/ARIA/VERA review)
// ════════════════════════════════════════════════════════════════════════════

// ─── BUG1-5/6: Detail view (formatTransactionModel) status for settlements ────

describe('BUG-1 (detail view): formatTransactionModel status for settlements', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  it('BUG1-5: Settlement tx via formatTransactionModel maps to status="settled"', () => {
    const raw = makeTx({ category: 'Settlement', isSettled: false, payer: MOCK_BRYAN });
    const detail = historyService.formatTransactionModel(raw);
    expect(detail.status).toBe('settled');
  });

  it('BUG1-6: Payment tx via formatTransactionModel maps to status="settled"', () => {
    const raw = makeTx({ category: 'Payment', isSettled: false, payer: MOCK_BRYAN });
    const detail = historyService.formatTransactionModel(raw);
    expect(detail.status).toBe('settled');
  });

  it('BUG1-regression: regular unsettled expense via formatTransactionModel stays "unsettled"', () => {
    const raw = makeTx({ category: 'Food', isSettled: false, payer: MOCK_BRYAN });
    const detail = historyService.formatTransactionModel(raw);
    expect(detail.status).toBe('unsettled');
  });
});

// ─── BUG3-3: Explicit percentages are NOT overridden by the 0.5 fallback ──────

describe('BUG-3 (regression guard): explicit percentages preserved', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  it('BUG3-3: explicit 70/30 tx still displays 70/30 (fallback only applies to null)', () => {
    const tx = {
      id: BigInt(7),
      date: new Date('2026-01-01'),
      merchant: 'Explicit Split',
      amount: 100,
      currency: 'SGD',
      status: 'unsettled' as const,
      category: 'Food',
      description: 'Explicit Split',
      paidBy: 'Bryan',
      payerId: MOCK_BRYAN.id,
      payerRole: 'Bryan',
      splitType: undefined,
      bryanPercentage: 0.7,
      hweiYeenPercentage: 0.3,
    };
    const card = historyService.formatTransactionDetail(tx);
    expect(card).toMatch(/70%/);
    expect(card).toMatch(/30%/);
  });
});

// ─── FEAT1-5/6/7/8: settle_ok_ edge cases ────────────────────────────────────

describe('FEAT-1 (edge cases): settle_ok_ robustness', () => {
  let settleHandler: SettleCallbackHandler;
  let mockExpenseService: any;
  let mockCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExpenseService = {
      calculateNetBalance: vi.fn().mockResolvedValue({
        bryanOwes: 0, hweiYeenOwes: 551.07, netOutstanding: 551.07,
        whoOwes: 'HweiYeen', whoIsOwed: 'Bryan',
      }),
      recordPayment: vi.fn().mockResolvedValue({ id: BigInt(99) }),
    };
    mockCtx = {
      from: { id: 424894363 },
      session: { paymentMode: true, paymentOutstanding: 551.07, paymentUserOwes: 551.07, paymentOwedTo: 'Bryan' },
      reply: vi.fn(),
      editMessageText: vi.fn(),
      answerCbQuery: vi.fn(),
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_HY as any);
    settleHandler = new SettleCallbackHandler(
      mockExpenseService, {} as any, {} as any, vi.fn()
    );
  });

  it('FEAT1-5: successful settle_ok_ clears session.paymentMode', async () => {
    await settleHandler.handle(mockCtx, 'settle_ok_551.07');
    expect(mockCtx.session.paymentMode).toBe(false);
  });

  it('FEAT1-6: settle_ok_ with non-numeric amount → error reply, recordPayment NOT called', async () => {
    await settleHandler.handle(mockCtx, 'settle_ok_abc');
    expect(mockExpenseService.recordPayment).not.toHaveBeenCalled();
    expect(mockCtx.reply).toHaveBeenCalled();
    const replyText = String(mockCtx.reply.mock.calls[0][0]);
    expect(replyText.toLowerCase()).toMatch(/invalid|error/);
  });

  it('FEAT1-7: settle_ok_ when recordPayment throws → graceful error reply, no crash', async () => {
    mockExpenseService.recordPayment.mockRejectedValueOnce(new Error('DB down'));
    await expect(settleHandler.handle(mockCtx, 'settle_ok_551.07')).resolves.not.toThrow();
    const lastReply = String(mockCtx.reply.mock.calls.at(-1)?.[0] ?? '');
    expect(lastReply.toLowerCase()).toMatch(/error|try again/);
  });

  it('FEAT1-8: legacy settle_confirm_ prefix still routes (no collision with settle_ok_)', () => {
    // settle_confirm_123 should be handled by the legacy branch, not settle_ok_
    expect(settleHandler.canHandle('settle_confirm_123')).toBe(true);
    expect(settleHandler.canHandle('settle_ok_551.07')).toBe(true);
    // The two prefixes must be distinct
    expect('settle_ok_551.07'.startsWith('settle_confirm_')).toBe(false);
  });
});

// ─── FEAT2-4/5: Dashboard header pure helper (exact format) ───────────────────

describe('FEAT-2 (helper): formatBalanceHeader exact output', () => {
  it('FEAT2-4: whoOwes=HweiYeen → "⚖️ Hwei Yeen owes $X to Bryan"', () => {
    const out = formatBalanceHeader(
      { netOutstanding: 551.07, whoOwes: 'HweiYeen' }, 'Bryan', 'Hwei Yeen'
    );
    expect(out).toBe('⚖️ Hwei Yeen owes $551.07 to Bryan');
  });

  it('FEAT2-4b: whoOwes=Bryan → "⚖️ Bryan owes $X to Hwei Yeen"', () => {
    const out = formatBalanceHeader(
      { netOutstanding: 80.26, whoOwes: 'Bryan' }, 'Bryan', 'Hwei Yeen'
    );
    expect(out).toBe('⚖️ Bryan owes $80.26 to Hwei Yeen');
  });

  it('FEAT2-3b: netOutstanding=0 → settled message', () => {
    const out = formatBalanceHeader(
      { netOutstanding: 0, whoOwes: null }, 'Bryan', 'Hwei Yeen'
    );
    expect(out.toLowerCase()).toMatch(/settled/);
  });

  it('FEAT2-5: amount always formatted to 2 decimals', () => {
    const out = formatBalanceHeader(
      { netOutstanding: 5, whoOwes: 'HweiYeen' }, 'Bryan', 'Hwei Yeen'
    );
    expect(out).toMatch(/\$5\.00/);
  });
});

// ─── COPY-1..4: ARIA-approved copy is present in the handler ──────────────────

describe('ARIA copy verification: settle flow strings', () => {
  let settleHandler: SettleCallbackHandler;
  let mockExpenseService: any;
  let mockCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExpenseService = {
      calculateNetBalance: vi.fn().mockResolvedValue({
        bryanOwes: 0, hweiYeenOwes: 551.07, netOutstanding: 551.07,
        whoOwes: 'HweiYeen', whoIsOwed: 'Bryan',
      }),
      recordPayment: vi.fn().mockResolvedValue({ id: BigInt(99) }),
    };
    mockCtx = {
      from: { id: 424894363 },
      session: {},
      reply: vi.fn(),
      editMessageText: vi.fn(),
      answerCbQuery: vi.fn(),
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_HY as any);
    settleHandler = new SettleCallbackHandler(
      mockExpenseService, {} as any, {} as any, vi.fn()
    );
  });

  it('COPY-1: confirmation card uses "Confirm payment of SGD $X" + "logged as a settlement"', async () => {
    await settleHandler.handle(mockCtx, 'settle_pay_full_551.07');
    const text = String(mockCtx.reply.mock.calls[0][0]);
    expect(text).toMatch(/Confirm payment of SGD \$551\.07/i);
    expect(text.toLowerCase()).toMatch(/logged as a settlement/);
  });

  it('COPY-2: success message includes amount + recipient + butler salutation', async () => {
    await settleHandler.handle(mockCtx, 'settle_ok_551.07');
    const allReplies = mockCtx.reply.mock.calls.map((c: any[]) => String(c[0])).join('\n');
    expect(allReplies).toMatch(/Done!/);
    expect(allReplies).toMatch(/551\.07/);
    expect(allReplies.toLowerCase()).toMatch(/all square|slate is clean/);
  });

  it('COPY-3: cancel message = "No rush — the ledger will wait."', async () => {
    await settleHandler.handle(mockCtx, 'settle_cancel');
    const allOutputs = [
      ...mockCtx.reply.mock.calls.map((c: any[]) => String(c[0])),
      ...mockCtx.editMessageText.mock.calls.map((c: any[]) => String(c[0])),
    ].join('\n');
    expect(allOutputs).toMatch(/No rush — the ledger will wait/);
  });

  it('COPY-4: confirmation card buttons = "✅ Yes, confirm" and "❌ Never mind"', async () => {
    await settleHandler.handle(mockCtx, 'settle_pay_full_551.07');
    const markup = JSON.stringify(mockCtx.reply.mock.calls[0][1]);
    expect(markup).toMatch(/Yes, confirm/);
    expect(markup).toMatch(/Never mind/);
  });
});


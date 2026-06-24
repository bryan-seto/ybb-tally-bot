/**
 * TDD tests for QuickExpenseHandler — multi-line expense path.
 *
 * Covers:
 *  - canHandle accepts a 2-line expense message
 *  - handle() calls createSmartExpense twice for a 2-line valid message
 *  - handle() records only good lines + notes failed lines for a partial-failure message
 *  - handle() falls back to single-line AI path when zero lines parse (e.g. pure gibberish)
 *  - showDashboard is called once after batch (not once per line)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────
vi.mock('../../../config', () => ({
  USER_A_ROLE_KEY: 'user_a',
  USER_B_ROLE_KEY: 'user_b',
  getUserAName: () => 'Bryan',
  getUserBName: () => 'HY',
  config: {
    TELEGRAM_BOT_TOKEN: 'fake_token_for_tests',
    USER_A_ID: '111',
    USER_A_NAME: 'Bryan',
    USER_B_ID: '222',
    USER_B_NAME: 'HY',
    GEMINI_API_KEY: 'fake_gemini_key',
    BACKUP_RECIPIENT_ID: '333',
    DATABASE_URL: 'postgresql://localhost/testdb',
  },
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@sentry/node', () => ({
  default: { captureException: vi.fn(), init: vi.fn() },
  captureException: vi.fn(),
  init: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

import { QuickExpenseHandler } from '../QuickExpenseHandler';

function makeTransaction(id: bigint, amountSGD: number) {
  return {
    id,
    amountSGD,
    originalAmount: null,
    fxRate: null,
    bryanPercentage: 0.5,
    hweiYeenPercentage: 0.5,
  };
}

function makeExpenseService(overrides: Partial<ReturnType<typeof defaultExpenseService>> = {}) {
  return {
    ...defaultExpenseService(),
    ...overrides,
  };
}

function defaultExpenseService() {
  let callCount = 0;
  return {
    createSmartExpense: vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        transaction: makeTransaction(BigInt(100 + callCount), 10 + callCount),
        balanceMessage: `Bryan owes HY SGD $${100 + callCount}`,
      };
    }),
    getFunConfirmation: vi.fn().mockReturnValue('✅ Recorded!'),
    fxRateService: {
      isManualRateStale: vi.fn().mockResolvedValue(false),
    },
  };
}

function makeCtx() {
  const editMessageText = vi.fn().mockResolvedValue({});
  return {
    from: { id: 111 },
    chat: { id: -999 },
    reply: vi.fn().mockResolvedValue({ message_id: 42 }),
    telegram: { editMessageText },
  };
}

function makeSession() {
  return { mode: null };
}

function makeSessionManager() {
  return {
    isManualAddMode: vi.fn().mockReturnValue(false),
    isEditMode: vi.fn().mockReturnValue(false),
  };
}

function makeHandler(expenseService: any, showDashboard?: any) {
  return new QuickExpenseHandler(
    expenseService as any,
    { processQuickExpense: vi.fn().mockRejectedValue(new Error('AI not called in test')) } as any,
    {} as any,
    makeSessionManager() as any,
    () => 'testbot',
    showDashboard,
    undefined,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('QuickExpenseHandler — multi-line', () => {
  const session = makeSession();

  // ── canHandle ──────────────────────────────────────────────────────────
  describe('canHandle', () => {
    it('returns true for a 2-line expense message', () => {
      const h = makeHandler(makeExpenseService());
      expect(h.canHandle('Baby store 11.86\nStella dresses 38.38', session)).toBe(true);
    });

    it('returns true for a 3-line expense message', () => {
      const h = makeHandler(makeExpenseService());
      expect(h.canHandle('grab 5\nlunch 12\ncoffee 3', session)).toBe(true);
    });

    it('still returns false for bot mention in multi-line', () => {
      const h = makeHandler(makeExpenseService());
      expect(h.canHandle('@testbot grab 5\nlunch 12', session)).toBe(false);
    });
  });

  // ── handle: all-valid path ────────────────────────────────────────────
  describe('handle — all lines valid', () => {
    it('calls createSmartExpense twice for a 2-line message', async () => {
      const expenseService = makeExpenseService();
      const showDashboard = vi.fn().mockResolvedValue(undefined);
      const h = makeHandler(expenseService, showDashboard);
      const ctx = makeCtx();

      await h.handle(ctx as any, 'Baby store 11.86\nStella dresses 38.38');

      expect(expenseService.createSmartExpense).toHaveBeenCalledTimes(2);

      const calls = expenseService.createSmartExpense.mock.calls;
      // First call: Baby store 11.86
      expect(calls[0][1]).toBeCloseTo(11.86);
      expect(calls[0][3]).toBe('Baby store');
      // Second call: Stella dresses 38.38
      expect(calls[1][1]).toBeCloseTo(38.38);
      expect(calls[1][3]).toBe('Stella dresses');
    });

    it('showDashboard is called exactly once after a batch (not per line)', async () => {
      const expenseService = makeExpenseService();
      const showDashboard = vi.fn().mockResolvedValue(undefined);
      const h = makeHandler(expenseService, showDashboard);
      const ctx = makeCtx();

      await h.handle(ctx as any, 'grab 5\nlunch 12\ncoffee 3');

      expect(expenseService.createSmartExpense).toHaveBeenCalledTimes(3);
      expect(showDashboard).toHaveBeenCalledTimes(1);
    });

    it('final reply contains both descriptions', async () => {
      const expenseService = makeExpenseService();
      const h = makeHandler(expenseService);
      const ctx = makeCtx();

      await h.handle(ctx as any, 'Baby store 11.86\nStella dresses 38.38');

      // The final edit or reply should mention both item descriptions
      const allCalls = [
        ...ctx.telegram.editMessageText.mock.calls.map((c: any[]) => String(c[3] ?? '')),
        ...ctx.reply.mock.calls.map((c: any[]) => String(c[0] ?? '')),
      ].join(' ');

      expect(allCalls).toMatch(/Baby store/i);
      expect(allCalls).toMatch(/Stella dresses/i);
    });
  });

  // ── handle: partial-failure path ─────────────────────────────────────
  describe('handle — partial failure (1 valid, 1 invalid line)', () => {
    it('records the valid line and does NOT throw', async () => {
      const expenseService = makeExpenseService();
      const h = makeHandler(expenseService);
      const ctx = makeCtx();

      await h.handle(ctx as any, 'grab 5\nthis line is not an expense at all');

      // The parseable line is recorded
      expect(expenseService.createSmartExpense).toHaveBeenCalledTimes(1);
      expect(expenseService.createSmartExpense.mock.calls[0][3]).toBe('grab');
    });

    it('reply mentions the skipped line when there is a parse failure', async () => {
      const expenseService = makeExpenseService();
      const h = makeHandler(expenseService);
      const ctx = makeCtx();

      await h.handle(ctx as any, 'grab 5\nthis line is not an expense at all');

      const allText = [
        ...ctx.telegram.editMessageText.mock.calls.map((c: any[]) => String(c[3] ?? '')),
        ...ctx.reply.mock.calls.map((c: any[]) => String(c[0] ?? '')),
      ].join(' ');

      // Some indication that a line was skipped
      expect(allText).toMatch(/couldn'?t parse|skip|not.*parse|⚠️/i);
    });
  });

  // ── handle: zero parsed → AI fallback ────────────────────────────────
  describe('handle — zero lines parseable → falls back to AI path', () => {
    it('calls AI processQuickExpense when no lines parse (not createSmartExpense directly)', async () => {
      const aiService = {
        processQuickExpense: vi.fn().mockResolvedValue({
          amount: 5,
          description: 'test',
          category: 'Other',
        }),
      };
      const expenseService = makeExpenseService();
      const h = new QuickExpenseHandler(
        expenseService as any,
        aiService as any,
        {} as any,
        makeSessionManager() as any,
        () => 'testbot',
        undefined,
        undefined,
      );
      const ctx = makeCtx();

      // Two gibberish lines — neither matches regex
      await h.handle(ctx as any, 'hello world\njust some text');

      // AI was invoked with the original text
      expect(aiService.processQuickExpense).toHaveBeenCalledWith(
        'hello world\njust some text',
        expect.any(Function),
      );
    });
  });
});

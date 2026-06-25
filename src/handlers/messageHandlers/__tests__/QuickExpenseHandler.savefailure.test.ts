/**
 * Fix 4.2 — Guard test: genuine recordExpense failure must still surface ❌ to the user.
 *
 * Context: the showDashboard no-rethrow fix (3aef638) correctly swallows dashboard
 * render errors. This test ensures that a real *expense save* failure (i.e.
 * createSmartExpense throws) still produces a visible error reply to the user,
 * NOT a success message or silent hang.
 *
 * If this test ever breaks it means the no-rethrow accidentally silenced save failures.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────
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
  prisma: { transaction: { findMany: vi.fn() } },
}));

vi.mock('@sentry/node', () => ({
  default: { captureException: vi.fn(), init: vi.fn() },
  captureException: vi.fn(),
  init: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────
import { QuickExpenseHandler } from '../QuickExpenseHandler';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeExpenseService(overrides: Record<string, any> = {}) {
  return {
    createSmartExpense: vi.fn(),
    getFunConfirmation: vi.fn(() => '✅'),
    getOutstandingBalanceMessage: vi.fn(async () => 'Balance: $0'),
    fxRateService: { isManualRateStale: vi.fn(async () => false) },
    ...overrides,
  };
}

function makeAIService() {
  return {
    processQuickExpense: vi.fn(async () => ({
      amount: 10,
      category: 'Food',
      description: 'coffee',
    })),
  };
}

function makeHistoryService() {
  return { getRecentTransactions: vi.fn(async () => []) };
}

function makeSessionManager() {
  return {
    isManualAddMode: vi.fn(() => false),
    isEditMode: vi.fn(() => false),
    clearSession: vi.fn(),
  };
}

function makeSplitRulesService() {
  return { getSplitRulesForCategory: vi.fn(async () => ({ userAPercent: 0.5, userBPercent: 0.5 })) };
}

function makeCtx(replySpy: ReturnType<typeof vi.fn>, editSpy: ReturnType<typeof vi.fn>) {
  return {
    from: { id: 111 },
    chat: { id: 999 },
    message: { message_id: 42 },
    session: {},
    reply: replySpy,
    telegram: {
      editMessageText: editSpy,
      sendMessage: vi.fn(),
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('QuickExpenseHandler — save failure guard (Fix 4.2)', () => {
  it('replies with ❌ error message when createSmartExpense throws (single-expense path)', async () => {
    const saveError = new Error('DB connection lost');
    const expenseService = makeExpenseService({
      createSmartExpense: vi.fn().mockRejectedValue(saveError),
    });
    const aiService = makeAIService();
    const historyService = makeHistoryService();
    const sessionManager = makeSessionManager();
    const splitRulesService = makeSplitRulesService();

    const replySpy = vi.fn(async () => ({ message_id: 100 }));
    const editSpy = vi.fn(async () => ({}));
    const ctx = makeCtx(replySpy, editSpy);

    const handler = new QuickExpenseHandler(
      expenseService as any,
      aiService as any,
      historyService as any,
      sessionManager as any,
      () => 'testbot',
      undefined, // no showDashboard
      splitRulesService as any,
    );

    // "5 coffee" matches single-expense path
    await handler.handle(ctx as any, '5 coffee');

    // The handler must NOT send a success message
    const allReplies = [
      ...replySpy.mock.calls.map(args => args[0]),
      ...editSpy.mock.calls.map(args => args[3]),
    ].filter(Boolean);

    const hasSuccess = allReplies.some(msg =>
      typeof msg === 'string' && (msg.includes('✅') || msg.toLowerCase().includes('recorded'))
    );
    const hasError = allReplies.some(msg =>
      typeof msg === 'string' && (msg.includes('❌') || msg.toLowerCase().includes('sorry'))
    );

    expect(hasSuccess, 'should NOT show success message on save failure').toBe(false);
    expect(hasError, 'should show error message on save failure').toBe(true);
  });

  it('replies with ❌ error message when createSmartExpense throws (multi-line batch path)', async () => {
    const saveError = new Error('DB connection lost');
    const expenseService = makeExpenseService({
      createSmartExpense: vi.fn().mockRejectedValue(saveError),
    });
    const aiService = makeAIService();
    const historyService = makeHistoryService();
    const sessionManager = makeSessionManager();
    const splitRulesService = makeSplitRulesService();

    const replySpy = vi.fn(async () => ({ message_id: 100 }));
    const editSpy = vi.fn(async () => ({}));
    const ctx = makeCtx(replySpy, editSpy);

    const handler = new QuickExpenseHandler(
      expenseService as any,
      aiService as any,
      historyService as any,
      sessionManager as any,
      () => 'testbot',
      undefined,
      splitRulesService as any,
    );

    // Two-line batch
    await handler.handle(ctx as any, '5 coffee\n10 lunch');

    const allReplies = [
      ...replySpy.mock.calls.map(args => args[0]),
      ...editSpy.mock.calls.map(args => args[3]),
    ].filter(Boolean);

    const hasSuccess = allReplies.some(msg =>
      typeof msg === 'string' && (msg.includes('✅ Recorded') || msg.toLowerCase().includes('recorded 2'))
    );
    const hasError = allReplies.some(msg =>
      typeof msg === 'string' && (msg.includes('❌') || msg.toLowerCase().includes('sorry'))
    );

    expect(hasSuccess, 'should NOT show success message on save failure').toBe(false);
    expect(hasError, 'should show error message on save failure').toBe(true);
  });
});

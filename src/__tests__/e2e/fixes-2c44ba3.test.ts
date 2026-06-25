/**
 * Regression E2E tests for the 13 fixes shipped in commit 2c44ba3.
 *
 * Coverage:
 *   P-1  /add amount validation    — ManualAddHandler rejects negatives/zero/words
 *   E-1  escapeMd sweep            — special Markdown chars in descriptions don't crash
 *   P-2  History item tap          — history_tx_<id> callback returns a detail card
 *   P-4  AI correction resilience  — status-edit failure is non-fatal; DB write still lands
 *   L-08 Batch back-to-back        — session cleared after batch; next message processed OK
 */

import { vi, describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';

// ── 1. Prisma mock (must come before application imports) ──────────────────
import { prisma as testPrisma, setupTestDb, clearDb } from './helpers/prismaTestSetup';
import { createMockContext, createMockUser } from './helpers/mockFactory';
import { createTestUsers, createTestTransaction } from './helpers/testFixtures';

vi.mock('../../lib/prisma', () => ({ prisma: testPrisma }));
export const prisma = testPrisma;

// ── 2. Application code ───────────────────────────────────────────────────
import { MessageHandlers } from '../../handlers/messageHandlers';
import { CallbackHandlers } from '../../handlers/callbackHandlers';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';
import { ManualAddHandler } from '../../handlers/messageHandlers/ManualAddHandler';
import { HistoryCallbackHandler } from '../../handlers/callbacks/HistoryCallbackHandler';
import { executeCorrectionActions } from '../../handlers/messageHandlers/CorrectionActionExecutor';
import { SessionManager } from '../../handlers/messageHandlers/SessionManager';

// ── 3. External mocks ─────────────────────────────────────────────────────
vi.mock('../../services/ai');
vi.mock('telegraf', () => ({
  Markup: {
    inlineKeyboard: (btns: any) => ({ reply_markup: { inline_keyboard: btns } }),
    button: {
      callback: (txt: string, data: string) => ({ text: txt, callback_data: data }),
    },
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('Fixes 2c44ba3 — Regression E2E Suite', () => {
  const userA = createMockUser(1001, 'bryan', 'Bryan');

  let messageHandlers: MessageHandlers;
  let callbackHandlers: CallbackHandlers;
  let expenseService: ExpenseService;
  let historyService: HistoryService;
  let recurringExpenseService: RecurringExpenseService;
  let sessionManager: SessionManager;
  let mockAIService: any;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    vi.clearAllMocks();

    await createTestUsers();

    mockAIService = {
      processReceipt: vi.fn(),
      processQuickExpense: vi.fn().mockResolvedValue({
        amount: 5,
        description: 'coffee',
        category: 'Food',
      }),
      processCorrection: vi.fn(),
      parseEditIntent: vi.fn(),
    };

    expenseService = new ExpenseService();
    historyService = new HistoryService();
    sessionManager = new SessionManager();
    recurringExpenseService = new RecurringExpenseService(expenseService);

    messageHandlers = new MessageHandlers(
      expenseService,
      mockAIService as any,
      historyService,
      () => 'test_bot',
      undefined,
    );

    callbackHandlers = new CallbackHandlers(
      expenseService,
      historyService,
      recurringExpenseService,
      undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==========================================================================
  // P-1: /add amount validation — ManualAddHandler
  // ==========================================================================
  describe('Fix P-1: /add amount validation (ManualAddHandler)', () => {
    function makeManualHandler() {
      return new ManualAddHandler(
        expenseService,
        mockAIService as any,
        historyService,
        sessionManager,
      );
    }

    it('advances from description → amount step on valid description', async () => {
      const handler = makeManualHandler();
      const ctx = createMockContext('Lunch at hawker centre', userA);
      ctx.session = { manualAddMode: true, manualAddStep: 'description' };

      await handler.handle(ctx, 'Lunch at hawker centre');

      expect((ctx.session as any).manualAddStep).toBe('amount');
      expect((ctx.session as any).manualDescription).toBe('Lunch at hawker centre');
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Amount in SGD?'),
      );
    });

    it('rejects a negative amount with a helpful error', async () => {
      const handler = makeManualHandler();
      const ctx = createMockContext('-5', userA);
      ctx.session = { manualAddMode: true, manualAddStep: 'amount', manualDescription: 'lunch' };

      await handler.handle(ctx, '-5');

      // Session must NOT advance past 'amount'
      expect((ctx.session as any).manualAddStep).toBe('amount');
      // Error reply must mention "positive"
      const reply = (ctx.reply as any).mock.calls[0][0] as string;
      expect(reply).toMatch(/positive/i);
    });

    it('rejects zero with a descriptive error', async () => {
      const handler = makeManualHandler();
      const ctx = createMockContext('0', userA);
      ctx.session = { manualAddMode: true, manualAddStep: 'amount', manualDescription: 'lunch' };

      await handler.handle(ctx, '0');

      expect((ctx.session as any).manualAddStep).toBe('amount');
      const reply = (ctx.reply as any).mock.calls[0][0] as string;
      expect(reply).toMatch(/greater than zero/i);
    });

    it('rejects a non-numeric word with an invalid-amount error', async () => {
      const handler = makeManualHandler();
      const ctx = createMockContext('fifty', userA);
      ctx.session = { manualAddMode: true, manualAddStep: 'amount', manualDescription: 'lunch' };

      await handler.handle(ctx, 'fifty');

      expect((ctx.session as any).manualAddStep).toBe('amount');
      const reply = (ctx.reply as any).mock.calls[0][0] as string;
      expect(reply).toMatch(/invalid amount/i);
    });

    it('rejects a decimal with more than 2 decimal places', async () => {
      const handler = makeManualHandler();
      const ctx = createMockContext('12.123', userA);
      ctx.session = { manualAddMode: true, manualAddStep: 'amount', manualDescription: 'lunch' };

      await handler.handle(ctx, '12.123');

      expect((ctx.session as any).manualAddStep).toBe('amount');
    });

    it('accepts a valid integer and shows category picker', async () => {
      const handler = makeManualHandler();
      const ctx = createMockContext('12', userA);
      ctx.session = { manualAddMode: true, manualAddStep: 'amount', manualDescription: 'lunch' };

      await handler.handle(ctx, '12');

      expect((ctx.session as any).manualAddStep).toBe('category');
      expect((ctx.session as any).manualAmount).toBe(12);
      // Category inline keyboard must be present
      const replyOptions = (ctx.reply as any).mock.calls[0][1];
      expect(replyOptions?.reply_markup?.inline_keyboard).toBeTruthy();
    });

    it('accepts a valid decimal (2 dp) and shows category picker', async () => {
      const handler = makeManualHandler();
      const ctx = createMockContext('12.50', userA);
      ctx.session = { manualAddMode: true, manualAddStep: 'amount', manualDescription: 'hawker lunch' };

      await handler.handle(ctx, '12.50');

      expect((ctx.session as any).manualAddStep).toBe('category');
      expect((ctx.session as any).manualAmount).toBeCloseTo(12.5);
    });
  });

  // ==========================================================================
  // E-1: escapeMd sweep — special chars in descriptions & history
  // ==========================================================================
  describe('Fix E-1: escapeMd sweep — Markdown-special descriptions don\'t break history', () => {
    it('formatTransactionListItem escapes * _ ` [ in merchant name', () => {
      const item = {
        id: BigInt(42),
        date: new Date(),
        merchant: '*bold* _italic_ `code` [link]',
        amount: 10,
        currency: 'SGD',
        status: 'unsettled' as const,
        category: 'Food',
        description: '*bold* _italic_ `code` [link]',
        paidBy: 'Bryan',
        originalAmount: null,
        fxRate: null,
      };

      const formatted = historyService.formatTransactionListItem(item);

      // The user-provided special chars inside the merchant name must be escaped.
      // Note: the format template wraps merchant in *...* for bold, so the outer
      // Markdown `*` is intentional; we only verify the inner user chars are escaped.
      expect(formatted).toContain('\\*bold\\*');
      expect(formatted).toContain('\\_italic\\_');
      expect(formatted).toContain('\\`code\\`');
      expect(formatted).toContain('\\[link]');
    });

    it('formatTransactionDetail escapes special chars in merchant, category, paidBy, and description', () => {
      const detail = {
        id: BigInt(99),
        date: new Date(),
        merchant: '[Mc_Donald\'s]',
        amount: 25.5,
        currency: 'SGD',
        status: 'unsettled' as const,
        category: 'Food_&_Drink',
        description: '[Mc_Donald\'s]',
        paidBy: 'Bryan',
        payerId: BigInt(1001),
        payerRole: 'Bryan',
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
        originalAmount: null,
        fxRate: null,
      };

      const formatted = historyService.formatTransactionDetail(detail);

      // No unescaped [ in user-controlled fields
      expect(formatted).not.toMatch(/(?<!\\)\[Mc/);
      // The escaped form should appear
      expect(formatted).toContain('\\[Mc');
    });

    it('view_history callback with a special-char description does not throw', async () => {
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      await createTestTransaction({
        amountSGD: 10,
        description: '*Starred* & _underlined_ item [link]',
        category: 'Food',
        payerId: bryanUser.id,
      });

      const ctx = createMockContext('', userA, 'view_history');
      // Should NOT throw even with special-char description
      await expect(callbackHandlers.handleCallback(ctx)).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // P-2: History item tap — history_tx_<id> detail card
  // ==========================================================================
  describe('Fix P-2: History item tap — history_tx_<id> callback', () => {
    it('history_load_0 callback (paginated list) renders per-transaction history_tx_<id> buttons', async () => {
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      const tx = await createTestTransaction({
        amountSGD: 45,
        description: 'Dinner at restaurant',
        category: 'Food',
        payerId: bryanUser.id,
      });

      const ctx = createMockContext('', userA, 'history_load_0');
      await callbackHandlers.handleCallback(ctx);

      // Find all callback_data values used in the mocked reply/edit calls
      const allArgs = [
        ...(ctx.editMessageText as any).mock.calls,
        ...(ctx.reply as any).mock.calls,
      ];
      const allText = allArgs.map(args => JSON.stringify(args)).join('\n');

      expect(allText).toContain(`history_tx_${tx.id}`);
    });

    it('history_tx_<id> callback returns a transaction detail card', async () => {
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      const tx = await createTestTransaction({
        amountSGD: 30,
        description: 'Bubble tea',
        category: 'Food',
        payerId: bryanUser.id,
      });

      const ctx = createMockContext('', userA, `history_tx_${tx.id}`);
      // Simulate "message" to edit (required by editMessageText mock)
      (ctx as any).callbackQuery = {
        ...(ctx as any).callbackQuery,
        message: { message_id: 500, chat: { id: userA.id } },
      };

      await callbackHandlers.handleCallback(ctx);

      // Detail card should be sent via editMessageText (or reply as fallback)
      const wasEdited = (ctx.editMessageText as any).mock.calls.length > 0;
      const wasReplied = (ctx.reply as any).mock.calls.length > 0;
      expect(wasEdited || wasReplied).toBe(true);

      // Detail card must contain the transaction description
      const allContent = [
        ...(ctx.editMessageText as any).mock.calls,
        ...(ctx.reply as any).mock.calls,
      ].map(args => String(args[0])).join('\n');

      expect(allContent).toMatch(/Bubble tea/i);
      expect(allContent).toMatch(/Transaction Details/i);
    });

    it('history_tx_<id> for a non-existent ID shows "not found" alert', async () => {
      const ctx = createMockContext('', userA, 'history_tx_99999');
      await callbackHandlers.handleCallback(ctx);

      // answerCbQuery should have been called with a "not found" message
      const cbAnswerCalls = (ctx.answerCbQuery as any).mock.calls;
      const anyNotFound = cbAnswerCalls.some((args: any[]) =>
        JSON.stringify(args).toLowerCase().includes('not found')
      );
      expect(anyNotFound).toBe(true);
    });
  });

  // ==========================================================================
  // P-4: AI correction Thinking state — status-edit failure is non-fatal
  // ==========================================================================
  describe('Fix P-4: CorrectionActionExecutor — status-edit failure is non-fatal', () => {
    it('completes DB update even when editMessageText throws on every call', async () => {
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      const tx = await createTestTransaction({
        amountSGD: 80,
        description: 'Groceries',
        category: 'Groceries',
        payerId: bryanUser.id,
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
      });

      // Build a ctx where status-message editing always throws
      const ctx = {
        from: { id: 1001 },
        chat: { id: 1001, type: 'private' },
        telegram: {
          editMessageText: vi.fn().mockRejectedValue(new Error('message is not modified')),
        },
      };

      const actions = [{
        action: 'UPDATE_SPLIT' as const,
        transactionId: tx.id,
        data: { bryanPercentage: 0.5, hweiYeenPercentage: 0.5 },
        statusMessage: 'Updating split to 50/50…',
      }];

      // Provide a fake statusMsg (the message that carries "Thinking…")
      const statusMsg = { message_id: 123 };

      // Should NOT throw even though editMessageText always rejects
      const { results, updatedTransaction } = await executeCorrectionActions(
        ctx as any,
        actions,
        statusMsg,
      );

      // DB write must have succeeded
      expect(results).toHaveLength(1);
      expect(results[0]).toMatch(/✅/);
      expect(updatedTransaction).toBeTruthy();

      // Verify the DB row was actually updated
      const afterTx = await prisma.transaction.findUnique({ where: { id: tx.id } });
      expect(afterTx?.bryanPercentage).toBeCloseTo(0.5);
      expect(afterTx?.hweiYeenPercentage).toBeCloseTo(0.5);
    });

    it('continues processing subsequent actions after a failed status-edit on the first', async () => {
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      const tx = await createTestTransaction({
        amountSGD: 50,
        description: 'Coffee',
        category: 'Food',
        payerId: bryanUser.id,
      });

      let editCallCount = 0;
      const ctx = {
        from: { id: 1001 },
        chat: { id: 1001, type: 'private' },
        telegram: {
          editMessageText: vi.fn().mockImplementation(() => {
            editCallCount++;
            // Fail the first status-edit call, succeed the rest
            if (editCallCount === 1) {
              return Promise.reject(new Error('Too old to edit'));
            }
            return Promise.resolve(true);
          }),
        },
      };

      const actions = [
        {
          action: 'UPDATE_AMOUNT' as const,
          transactionId: tx.id,
          data: { amountSGD: 99 },
          statusMessage: 'Updating amount…',
        },
      ];

      const { results } = await executeCorrectionActions(ctx as any, actions, { message_id: 456 });

      expect(results).toHaveLength(1);
      expect(results[0]).toContain('$99.00');

      const afterTx = await prisma.transaction.findUnique({ where: { id: tx.id } });
      expect(Number(afterTx?.amountSGD)).toBe(99);
    });
  });

  // ==========================================================================
  // L-08: Batch back-to-back — session cleared after batch completes
  // ==========================================================================
  describe('Fix L-08: Batch back-to-back — session cleared after batch so next message is processed', () => {
    it('two back-to-back batches on the same session each save their expenses', async () => {
      const ctx = createMockContext('5 coffee\n10 lunch', userA);

      // First batch
      await messageHandlers.handleText(ctx);

      // Both expenses from the first batch must be in the DB
      const afterFirst = await prisma.transaction.count();
      expect(afterFirst).toBe(2);

      // Simulate second message on the same session (same ctx, same session object)
      ctx.message = {
        ...(ctx.message as any),
        text: '3 tea\n6 snack',
        message_id: (ctx.message?.message_id ?? 0) + 1,
      } as any;

      await messageHandlers.handleText(ctx);

      const afterSecond = await prisma.transaction.count();
      expect(afterSecond).toBe(4);
    });

    it('session is cleared after batch so a follow-up single expense is not swallowed', async () => {
      const ctx = createMockContext('5 coffee\n10 lunch', userA);

      // First: batch
      await messageHandlers.handleText(ctx);

      // Second: single expense on the same session
      ctx.message = {
        ...(ctx.message as any),
        text: '12 groceries',
        message_id: (ctx.message?.message_id ?? 0) + 1,
      } as any;

      await messageHandlers.handleText(ctx);

      const total = await prisma.transaction.count();
      // 2 from batch + 1 single = 3
      expect(total).toBe(3);
    });

    it('session is cleared after single expense so next message is not treated as continuation', async () => {
      const ctx = createMockContext('8 coffee', userA);

      await messageHandlers.handleText(ctx);

      // Verify session was cleared — manualAddMode must be falsy
      expect((ctx.session as any)?.manualAddMode).toBeFalsy();
      expect((ctx.session as any)?.manualAddStep).toBeUndefined();

      // Send another single expense
      ctx.message = {
        ...(ctx.message as any),
        text: '4 juice',
        message_id: (ctx.message?.message_id ?? 0) + 1,
      } as any;

      await messageHandlers.handleText(ctx);

      const total = await prisma.transaction.count();
      expect(total).toBe(2);
    });
  });
});

import { vi, describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';

// 1. MOCK PRISMA SINGLETON (CRITICAL FIX)
// This forces all application code importing '../../lib/prisma' 
// to use the instance exported by our test setup.
// Note: We'll set this up after importing the test prisma instance

// 2. NOW import the setup (Order matters less now, but good practice)
import { prisma as testPrisma, setupTestDb, clearDb } from './helpers/prismaTestSetup';
import { createMockContext, createMockUser, MOCK_AI_RESPONSES, createMockPhotoMessage } from './helpers/mockFactory';
import { createTestUsers, createTestTransaction } from './helpers/testFixtures';

// 3. Mock Prisma after importing test instance
vi.mock('../../lib/prisma', () => {
  // Use the test prisma instance
  return {
    prisma: testPrisma
  };
});

// Export test prisma as prisma for use in tests
export const prisma = testPrisma;

// 4. Import Application Code
import { PhotoHandler } from '../../handlers/photoHandler';
import { MessageHandlers } from '../../handlers/messageHandlers';
import { CallbackHandlers } from '../../handlers/callbackHandlers';
import { AIService } from '../../services/ai';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';

// Mock External Dependencies
vi.mock('../../services/ai');
vi.mock('telegraf', () => ({
  Markup: {
    inlineKeyboard: (btns: any) => ({ reply_markup: { inline_keyboard: btns } }),
    button: { 
      callback: (txt: string, data: string) => ({ text: txt, callback_data: data }) 
    }
  }
}));

// Mock Telegram API fetch for photo downloads
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  } as Response)
);

describe('Critical Flows E2E', () => {
  // Test Data
  const userA = createMockUser(1001, 'bryan', 'Bryan');
  const userB = createMockUser(1002, 'hweiyeen', 'Hwei Yeen');
  
  let photoHandler: PhotoHandler;
  let messageHandlers: MessageHandlers;
  let callbackHandlers: CallbackHandlers;
  let mockAIService: any;
  let expenseService: ExpenseService;
  let historyService: HistoryService;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await clearDb();
    vi.clearAllMocks();

    // 1. Seed Users (Required for Foreign Keys)
    // Must create users BEFORE services/handlers are instantiated
    const { bryan, hweiYeen } = await createTestUsers();
    
    // Verify users were created
    const verifyBryan = await prisma.user.findUnique({ where: { id: BigInt(1001) } });
    const verifyHweiYeen = await prisma.user.findUnique({ where: { id: BigInt(1002) } });
    if (!verifyBryan || !verifyHweiYeen) {
      throw new Error('Failed to create test users');
    }

    // 2. Setup Services
    mockAIService = {
      processReceipt: vi.fn(),
      processQuickExpense: vi.fn(),
      processCorrection: vi.fn(),
      parseEditIntent: vi.fn(),
    };
    expenseService = new ExpenseService();
    historyService = new HistoryService();
    const recurringExpenseService = new RecurringExpenseService(expenseService);

    // 3. Instantiate Handlers
    // PhotoHandler needs AIService, ExpenseService, and optional showDashboard callback
    photoHandler = new PhotoHandler(
      mockAIService as any,
      expenseService,
      undefined // No dashboard callback for tests
    );

    messageHandlers = new MessageHandlers(
      expenseService,
      mockAIService as any,
      historyService,
      () => 'test_bot', // getBotUsername
      undefined // showDashboard
    );

    callbackHandlers = new CallbackHandlers(
      expenseService,
      historyService,
      recurringExpenseService,
      undefined // showDashboard
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==========================================
  // 📸 FLOW 1: Record Expense via Receipt Photo
  // ==========================================
  describe('Flow 1: Receipt Photo Batching', () => {
    it('should batch photos, wait 10s, and create transaction via AI', async () => {
      vi.useFakeTimers();

      // Mock AI Response
      mockAIService.processReceipt.mockResolvedValue(MOCK_AI_RESPONSES.RECEIPT_GROCERY);

      // Create photo messages
      const photoMsg1 = createMockPhotoMessage('photo1', 'path1.jpg');
      const photoMsg2 = createMockPhotoMessage('photo2', 'path2.jpg');

      const ctx1 = createMockContext('', userA);
      ctx1.message = photoMsg1;
      ctx1.chat.id = userA.id;

      const ctx2 = createMockContext('', userA);
      ctx2.message = photoMsg2;
      ctx2.chat.id = userA.id;

      // Mock telegram.getFile
      ctx1.telegram.getFile = vi.fn().mockResolvedValue({ file_path: 'path1.jpg' });
      ctx2.telegram.getFile = vi.fn().mockResolvedValue({ file_path: 'path2.jpg' });

      // 1. Send first photo
      await photoHandler.handlePhoto(ctx1);
      
      // 2. Send second photo (simulate multi-page receipt)
      await photoHandler.handlePhoto(ctx2);

      // 3. Fast-forward 11 seconds (past 10s window)
      await vi.advanceTimersByTimeAsync(11000);
      
      // Switch back to real timers for DB operations
      vi.useRealTimers();
      
      // Wait for async processing to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // 4. Verify AI was called ONCE (batching worked)
      expect(mockAIService.processReceipt).toHaveBeenCalledTimes(1);
      
      const tx = await prisma.transaction.findFirst({
        where: { payerId: BigInt(userA.id) },
        orderBy: { createdAt: 'desc' }
      });
      
      expect(tx).toBeTruthy();
      expect(Number(tx?.amountSGD)).toBe(130.00);
      expect(tx?.category).toBe('Groceries');
      expect(tx?.description).toBe('FairPrice Xtra');
    });
  });

  // ==========================================
  // ⚡ FLOW 2: Quick Text Input
  // ==========================================
  describe('Flow 2: Quick Expense Text', () => {
    it('should parse "15.50 coffee" via regex (no AI call) and create expense', async () => {
      const ctx = createMockContext('15.50 coffee', userA);

      // Mock AI as a guard: if the handler wrongly calls AI, we'd see "Afternoon Coffee".
      // The regex parser SHOULD handle "15.50 coffee" directly and skip AI entirely
      // (intentional design in quickExpenseParser.ts — "saves LLM costs").
      mockAIService.processQuickExpense.mockResolvedValue(MOCK_AI_RESPONSES.QUICK_EXPENSE_COFFEE);

      // 1. Handle Text (quick expense pattern → handleQuickExpense → regex parse)
      await messageHandlers.handleText(ctx);

      // 2. AI must NOT have been called — regex covers this input
      expect(mockAIService.processQuickExpense).not.toHaveBeenCalled();

      // 3. Verify DB: description is the raw token "coffee" (regex), not the AI's "Afternoon Coffee"
      const tx = await prisma.transaction.findFirst({
        where: { description: 'coffee' }
      });

      expect(tx).toBeTruthy();
      expect(Number(tx?.amountSGD)).toBe(15.50);
      expect(tx?.category).toBe('Food'); // inferCategory('coffee') → Food
    });

    it('should fall back to AI for free-text the regex cannot parse', async () => {
      // "paid 25 for lunch today" has a number, so canHandle() routes it to the quick-expense
      // handler — but the number is mid-string, so parseQuickExpense() returns null and the
      // handler delegates to AI. This exercises the AI fallback path.
      const ctx = createMockContext('paid 25 for lunch today', userA);
      mockAIService.processQuickExpense.mockResolvedValue(MOCK_AI_RESPONSES.QUICK_EXPENSE_COFFEE);

      await messageHandlers.handleText(ctx);

      // AI IS the path here
      expect(mockAIService.processQuickExpense).toHaveBeenCalled();

      // DB reflects the AI-parsed values (mock returns "Afternoon Coffee" / 15.50 / Food)
      const tx = await prisma.transaction.findFirst({
        where: { description: 'Afternoon Coffee' }
      });
      expect(tx).toBeTruthy();
      expect(Number(tx?.amountSGD)).toBe(15.50);
      expect(tx?.category).toBe('Food');
    });
  });

  // ==========================================
  // 💰 FLOW 3: Balance & Settle (Snapshot System)
  // ==========================================
  describe('Flow 3: View Balance and Settle', () => {
    it('settle_up callback: when current user is OWED, shows "no need to pay" (balance-based flow)', async () => {
      // Setup: Bryan paid $100 at 70/30 → HweiYeen owes Bryan $30.
      // The settle_up CALLBACK now uses balance-based logic (not the old watermark preview).
      // Since Bryan (userA) is the one OWED, the bot should tell him he doesn't need to pay.
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      await createTestTransaction({
        amountSGD: 100,
        description: "Dinner",
        category: "Food",
        payerId: bryanUser.id,
        isSettled: false,
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
      });

      const ctx = createMockContext('', userA, 'settle_up'); // userA = Bryan
      await callbackHandlers.handleCallback(ctx);

      // CallbackRouter sends "⏳ Loading..." first, then the handler's reply
      const messages = (ctx.reply as any).mock.calls.map((c: any[]) => String(c[0])).join('\n');
      expect(messages).toMatch(/don't need to pay|all good|owes you/i);
      // Bryan is owed $30 → message should reference that he's owed, not that he owes
      expect(messages).toContain('30.00');
    });

    it('settle_up callback: when current user OWES, shows a Pay button (balance-based flow)', async () => {
      // Setup: HweiYeen paid $100 at 70/30 → Bryan owes HweiYeen $70.
      // Bryan (userA) triggers settle_up and IS the one who owes → should see a Pay prompt.
      const hyUser = await prisma.user.findFirst({ where: { role: 'HweiYeen' } });
      if (!hyUser) throw new Error('HweiYeen user not found');

      await createTestTransaction({
        amountSGD: 100,
        description: "Groceries",
        category: "Groceries",
        payerId: hyUser.id,
        isSettled: false,
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
      });

      const ctx = createMockContext('', userA, 'settle_up'); // userA = Bryan (owes $70)
      await callbackHandlers.handleCallback(ctx);

      const messages = (ctx.reply as any).mock.calls.map((c: any[]) => String(c[0])).join('\n');
      expect(messages).toMatch(/owes \$70\.00|Pay/i);

      // The Pay button should carry the settle_pay_full_ callback (→ confirmation card in FEAT-1)
      const allMarkup = (ctx.reply as any).mock.calls
        .map((c: any[]) => JSON.stringify(c[1]?.reply_markup ?? ''))
        .join('');
      expect(allMarkup).toMatch(/settle_pay_full_70\.00/);
    });

    it('/settle command: watermark protection — txns added after preview are NOT settled', async () => {
      // The watermark "Ready to settle" preview flow lives under the /settle COMMAND
      // (commandHandlers.handleSettle), distinct from the settle_up callback above.
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      const tx1 = await createTestTransaction({
        amountSGD: 100,
        description: "Dinner",
        category: "Food",
        payerId: bryanUser.id,
        isSettled: false,
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
      });
      const watermarkID = tx1.id.toString();

      const { CommandHandlers } = await import('../../handlers/commandHandlers');
      const commandHandlers = new CommandHandlers(expenseService, {} as any, historyService);

      const cmdCtx = createMockContext('/settle', userA);
      cmdCtx.message = { text: '/settle', message_id: 1 } as any;

      // 1. /settle shows the watermark preview
      await commandHandlers.handleSettle(cmdCtx);
      const previewMessage = (cmdCtx.reply as any).mock.calls[0][0];
      expect(previewMessage).toContain('Ready to settle');
      expect(previewMessage).toContain('SGD $');

      const confirmButton = (cmdCtx.reply as any).mock.calls[0][1].reply_markup.inline_keyboard[0][0];
      expect(confirmButton.callback_data).toMatch(/^settle_confirm_\d+$/);
      expect(confirmButton.callback_data.replace('settle_confirm_', '')).toBe(watermarkID);

      // 2. A new transaction is added AFTER the preview
      const tx2 = await createTestTransaction({
        amountSGD: 50,
        description: "Coffee",
        category: "Food",
        payerId: bryanUser.id,
        isSettled: false,
      });

      // 3. Confirm settlement with the original watermark
      const confirmCtx = createMockContext('', userA, `settle_confirm_${watermarkID}`);
      confirmCtx.callbackQuery = {
        ...confirmCtx.callbackQuery!,
        message: cmdCtx.reply.mock.results[0].value as any,
      } as any;
      await callbackHandlers.handleCallback(confirmCtx);

      // 4. Watermark protection: only tx1 settled, tx2 (added after) untouched
      const tx1After = await prisma.transaction.findUnique({ where: { id: tx1.id } });
      const tx2After = await prisma.transaction.findUnique({ where: { id: tx2.id } });
      expect(tx1After?.isSettled).toBe(true);
      expect(tx2After?.isSettled).toBe(false);
    });

    it('should handle /settle command with preview', async () => {
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      const tx = await createTestTransaction({
        amountSGD: 75,
        description: "Lunch",
        category: "Food",
        payerId: bryanUser.id,
        isSettled: false,
      });

      // Import CommandHandlers
      const { CommandHandlers } = await import('../../handlers/commandHandlers');
      const commandHandlers = new CommandHandlers(expenseService, {} as any, historyService);

      const ctx = createMockContext('/settle', userA);
      ctx.message = { text: '/settle', message_id: 1 } as any;

      // 1. Trigger /settle command (should show preview)
      await commandHandlers.handleSettle(ctx);

      // Verify preview was shown
      expect(ctx.reply).toHaveBeenCalled();
      const previewMessage = (ctx.reply as any).mock.calls[0][0];
      expect(previewMessage).toContain('Ready to settle');
      expect(previewMessage).toContain('SGD $');

      // Verify buttons are present
      const replyMarkup = (ctx.reply as any).mock.calls[0][1]?.reply_markup;
      expect(replyMarkup).toBeTruthy();
      expect(replyMarkup.inline_keyboard.length).toBeGreaterThan(0);
      
      // Verify confirm button has watermark matching transaction ID
      const confirmButton = replyMarkup.inline_keyboard[0][0];
      expect(confirmButton.callback_data).toMatch(/^settle_confirm_\d+$/);
      const extractedWatermark = confirmButton.callback_data.replace('settle_confirm_', '');
      expect(extractedWatermark).toBe(tx.id.toString());
    });

    it('should handle cancel button correctly', async () => {
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      await createTestTransaction({
        amountSGD: 50,
        description: "Test",
        category: "Food",
        payerId: bryanUser.id,
        isSettled: false,
      });

      const ctx = createMockContext('', userA, 'settle_up');
      await callbackHandlers.handleCallback(ctx);

      // Create cancel context with message reference
      const cancelCtx = createMockContext('', userA, 'settle_cancel');
      cancelCtx.callbackQuery = {
        ...cancelCtx.callbackQuery!,
        message: ctx.reply.mock.results[0].value as any,
      } as any;
      
      await callbackHandlers.handleCallback(cancelCtx);

      // Verify cancel was handled (editMessageText should be called)
      expect(cancelCtx.editMessageText).toHaveBeenCalled();
      const cancelMessage = (cancelCtx.editMessageText as any).mock.calls[0][0];
      // ARIA-approved copy (HY UX sprint): warmer than the old "❌ Settlement cancelled."
      expect(cancelMessage).toContain('No rush');

      // Verify transaction is still unsettled
      const unsettledCount = await prisma.transaction.count({
        where: { isSettled: false }
      });
      expect(unsettledCount).toBe(1);
    });
  });

  // ==========================================
  // 📜 FLOW 4: History
  // ==========================================
  describe('Flow 4: Transaction History', () => {
    it('should fetch recent transactions', async () => {
      // Seed 5 transactions
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      for(let i=0; i<5; i++) {
        await createTestTransaction({
          amountSGD: 10 * (i+1),
          description: `Item ${i}`,
          category: 'Food',
          payerId: bryanUser.id,
        });
      }

      const ctx = createMockContext('', userA, 'view_history');
      await callbackHandlers.handleCallback(ctx);

      // Verify handler was called and response sent
      expect(ctx.editMessageText || ctx.reply).toHaveBeenCalled();
    });
  });

  // ==========================================
  // ✏️ FLOW 5: AI Edit
  // ==========================================
  describe('Flow 5: AI Edit', () => {
    it('should update transaction split via AI command', async () => {
      // Setup: Transaction exists
      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      const tx = await createTestTransaction({
        amountSGD: 100,
        description: "Lunch",
        category: "Food",
        payerId: bryanUser.id,
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
      });

      // Mock AI Intent for correction
      mockAIService.processCorrection.mockResolvedValue({
        ...MOCK_AI_RESPONSES.EDIT_SPLIT_50_50,
        actions: [{
          ...MOCK_AI_RESPONSES.EDIT_SPLIT_50_50.actions[0],
          transactionId: tx.id // Inject real ID
        }]
      });

      const ctx = createMockContext('@test_bot split 50-50', userA);
      
      // Trigger Edit Flow via handleText (which will detect @bot tag and call handleAICorrection)
      await messageHandlers.handleText(ctx);

      // Verify AI was called
      expect(mockAIService.processCorrection).toHaveBeenCalled();
      
      // Verify response was sent (handleAICorrection uses telegram.editMessageText for status updates)
      expect(ctx.telegram.editMessageText).toHaveBeenCalled();
    });
  });

  // ==========================================
  // 💸 FLOW 6: P-3 / E-02 — settle_confirm success is a reply, not an edit
  // ==========================================
  describe('Flow 6: settle_confirm success message (P-3 fix)', () => {
    it('settle_confirm_<id> success arrives as a reply (detectable by harness) not just an edit', async () => {
      // This is the root-cause regression test for P-3 / E-02.
      // The bug: SettleCallbackHandler used ctx.editMessageText for the success
      // message, then called showDashboard which sent a new message.
      // click_and_poll saw the dashboard first and failed the "🤝"/"settled" check.
      // Fix: success uses ctx.reply so the harness sees it as a new bot message.

      const bryanUser = await prisma.user.findFirst({ where: { role: 'Bryan' } });
      if (!bryanUser) throw new Error('Bryan user not found');

      const tx = await createTestTransaction({
        amountSGD: 50,
        description: 'Dinner',
        category: 'Food',
        payerId: bryanUser.id,
        isSettled: false,
      });

      const watermarkId = tx.id.toString();
      const ctx = createMockContext('', userA, `settle_confirm_${watermarkId}`);

      await callbackHandlers.handleCallback(ctx);

      // The success message MUST arrive via ctx.reply (new message),
      // not only via ctx.editMessageText.
      const replyCalls = (ctx.reply as any).mock.calls;
      const replyTexts = replyCalls.map((c: any[]) => String(c[0]));
      const hasSettledReply = replyTexts.some(t => t.includes('🤝') || /settled/i.test(t));

      expect(hasSettledReply).toBe(true);

      // Sanity: DB row must be settled
      const after = await prisma.transaction.findUnique({ where: { id: tx.id } });
      expect(after?.isSettled).toBe(true);
    });

    it('settle_confirm_<id> with nothing to settle returns early (idempotency)', async () => {
      // No unsettled transactions in DB — handler should report "already settled"
      // and not crash.
      const ctx = createMockContext('', userA, 'settle_confirm_99999');

      await callbackHandlers.handleCallback(ctx);

      // Should have replied with some message (edit or reply), not thrown
      const anyReply =
        (ctx.reply as any).mock.calls.length > 0 ||
        (ctx.editMessageText as any).mock.calls.length > 0;
      expect(anyReply).toBe(true);
    });
  });
});


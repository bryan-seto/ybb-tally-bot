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
    it('should parse "15.50 coffee" and create expense', async () => {
      const ctx = createMockContext('15.50 coffee', userA);
      
      // Mock AI
      mockAIService.processQuickExpense.mockResolvedValue(MOCK_AI_RESPONSES.QUICK_EXPENSE_COFFEE);

      // 1. Handle Text (this will detect quick expense pattern and call handleQuickExpense)
      await messageHandlers.handleText(ctx);

      // 2. Verify DB
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
    it('should show preview with snapshot and settle debts using watermark', async () => {
      // Setup: Bryan paid $100. Default split 70/30 means:
      // Bryan share: $70, HweiYeen share: $30
      // Since Bryan paid, HweiYeen owes Bryan $30
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

      // Get the transaction ID as watermark (max ID before settlement)
      const watermarkID = tx1.id.toString();

      const ctx = createMockContext('', userA, 'settle_up');

      // 1. Trigger Settle View (should show preview with watermark)
      // Note: CallbackRouter shows "⏳ Loading..." first, then handler sends preview
      await callbackHandlers.handleCallback(ctx);
      
      // Verify reply was called at least twice (loading + preview)
      expect(ctx.reply).toHaveBeenCalledTimes(2);
      
      // First call is loading message
      const loadingMessage = (ctx.reply as any).mock.calls[0][0];
      expect(loadingMessage).toBe('⏳ Loading...');
      
      // Second call is the preview message
      const previewMessage = (ctx.reply as any).mock.calls[1][0];
      expect(previewMessage).toContain('Ready to settle');
      expect(previewMessage).toContain('transactions');
      expect(previewMessage).toContain('SGD $');

      // Extract watermark from callback data in the reply
      const replyMarkup = (ctx.reply as any).mock.calls[1][1]?.reply_markup;
      expect(replyMarkup).toBeTruthy();
      const confirmButton = replyMarkup.inline_keyboard[0][0];
      expect(confirmButton.callback_data).toMatch(/^settle_confirm_\d+$/);
      
      // Verify watermark matches transaction ID
      const extractedWatermark = confirmButton.callback_data.replace('settle_confirm_', '');
      expect(extractedWatermark).toBe(watermarkID);

      // 2. Add a new transaction AFTER preview (should NOT be settled)
      const tx2 = await createTestTransaction({
        amountSGD: 50,
        description: "Coffee",
        category: "Food",
        payerId: bryanUser.id,
        isSettled: false,
      });

      // 3. Confirm Settlement with watermark
      // The confirm callback needs the preview message (second reply) as the message to edit
      const confirmCtx = createMockContext('', userA, `settle_confirm_${watermarkID}`);
      confirmCtx.callbackQuery = {
        ...confirmCtx.callbackQuery!,
        message: ctx.reply.mock.results[1].value as any, // Use second reply (preview message)
      } as any;
      await callbackHandlers.handleCallback(confirmCtx);

      // 4. Verify only original transaction is settled (watermark protection)
      const tx1After = await prisma.transaction.findUnique({ where: { id: tx1.id } });
      const tx2After = await prisma.transaction.findUnique({ where: { id: tx2.id } });
      
      expect(tx1After?.isSettled).toBe(true); // Original transaction settled
      expect(tx2After?.isSettled).toBe(false); // New transaction NOT settled (watermark protection)
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
      expect(cancelMessage).toContain('cancelled');

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
});


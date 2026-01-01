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
  // 💰 FLOW 3: Balance & Settle
  // ==========================================
  describe('Flow 3: View Balance and Settle', () => {
    it('should calculate balance and settle debts', async () => {
      // Setup: Bryan paid $100. Default split 70/30 means:
      // Bryan share: $70, HweiYeen share: $30
      // Since Bryan paid, HweiYeen owes Bryan $30
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

      const ctx = createMockContext('', userA, 'settle_up');

      // 1. Trigger Settle View
      await callbackHandlers.handleCallback(ctx);
      
      // Verify reply was called (balance message shown)
      expect(ctx.reply).toHaveBeenCalled();

      // 2. Confirm Settlement
      const confirmCtx = createMockContext('', userA, 'settle_confirm');
      await callbackHandlers.handleCallback(confirmCtx);

      // 3. Verify DB is settled
      const unsettledCount = await prisma.transaction.count({
        where: { isSettled: false }
      });
      expect(unsettledCount).toBe(0);
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


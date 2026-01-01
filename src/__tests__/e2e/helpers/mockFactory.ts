import { Context } from 'telegraf';
import { mockDeep, DeepMockProxy } from 'vitest-mock-extended';
import { Update, Message, User, CallbackQuery, PhotoSize } from 'telegraf/types';

// --- 1. ENTITY FACTORIES ---

export const createMockUser = (id: number, username: string, firstName?: string): User => ({
  id,
  is_bot: false,
  first_name: firstName || username,
  username: username,
  language_code: 'en',
});

export const createMockContext = (
  text: string, 
  user: User, 
  callbackData?: string
): DeepMockProxy<Context> => {
  const mockCtx = mockDeep<Context>();
  
  // Basic User Info
  mockCtx.from = user;
  mockCtx.chat = { id: user.id, type: 'private', first_name: user.first_name, username: user.username };
  
  // Mock Message
  if (text) {
    mockCtx.message = {
      message_id: Math.floor(Math.random() * 10000),
      date: Math.floor(Date.now() / 1000),
      chat: { id: user.id, type: 'private', first_name: user.first_name, username: user.username },
      from: user,
      text: text,
    } as Message.TextMessage;
  }

  // Mock Callback Query (if applicable)
  if (callbackData) {
    mockCtx.callbackQuery = {
      id: 'cb_id_' + Math.floor(Math.random() * 10000),
      from: user,
      message: mockCtx.message,
      chat_instance: 'instance_1',
      data: callbackData
    } as CallbackQuery.DataQuery;
    
    // Auto-resolve answerCbQuery to prevent hanging tests
    mockCtx.answerCbQuery.mockResolvedValue(true);
  }

  // Mock Reply Methods
  mockCtx.reply.mockResolvedValue({ message_id: 999 } as Message.TextMessage);
  mockCtx.replyWithPhoto.mockResolvedValue({ message_id: 999 } as Message.PhotoMessage);
  mockCtx.editMessageText.mockResolvedValue(true as any);
  mockCtx.telegram.getFile = mockCtx.telegram.getFile || (async () => ({ file_path: 'test/file/path.jpg' } as any));
  mockCtx.telegram.sendMessage = mockCtx.telegram.sendMessage || (async () => ({ message_id: 999 } as any));
  mockCtx.telegram.editMessageText = mockCtx.telegram.editMessageText || (async () => (true as any));
  mockCtx.telegram.deleteMessage = mockCtx.telegram.deleteMessage || (async () => (true as any));
  
  // Mock Session (Crucial for stateful flows)
  (mockCtx as any).session = {};

  return mockCtx;
};

export const createMockPhotoMessage = (fileId: string, filePath: string = 'test/file/path.jpg'): Message.PhotoMessage => {
  return {
    message_id: Math.floor(Math.random() * 10000),
    date: Math.floor(Date.now() / 1000),
    chat: { id: 123, type: 'private' },
    from: { id: 123, is_bot: false, first_name: 'Test' },
    photo: [
      {
        file_id: fileId,
        file_unique_id: 'unique_' + fileId,
        width: 640,
        height: 480,
        file_size: 50000,
      } as PhotoSize,
    ],
  } as Message.PhotoMessage;
};

// --- 2. DETERMINISTIC AI RESPONSE PATTERNS ---

export const MOCK_AI_RESPONSES = {
  // FLOW 1: Receipt Parsing
  // CORRECTED: Matches ReceiptDataSchema (No 'items' or 'confidence' at top level)
  RECEIPT_GROCERY: {
    isValid: true,
    transactions: [
      { 
        amount: 130.00, 
        merchant: "FairPrice Xtra", 
        category: "Groceries", 
        date: "2024-05-20" 
      }
    ],
    total: 130.00,
    currency: "SGD"
  },

  // FLOW 2: Quick Expense
  // CORRECTED: Category is strictly 'Food' (valid Enum)
  QUICK_EXPENSE_COFFEE: {
    amount: 15.50,
    description: "Afternoon Coffee",
    category: "Food", // Must be one of: Food, Transport, Shopping, Groceries, Bills, Entertainment, Medical, Travel, Other
  },

  // FLOW 5: Natural Language Edit (Split)
  // CORRECTED: Matches CorrectionResult structure
  EDIT_SPLIT_50_50: {
    confidence: 'high' as const,
    actions: [
      {
        action: 'UPDATE_SPLIT' as const,
        transactionId: BigInt(0), // Placeholder, will be set in test
        data: {
          bryanPercentage: 0.5,
          hweiYeenPercentage: 0.5,
        },
        statusMessage: "Updating split to 50-50..."
      }
    ]
  },

  // FLOW 5: Natural Language Edit (Amount)
  EDIT_AMOUNT_50: {
    confidence: 'high' as const,
    actions: [
      {
        action: 'UPDATE_AMOUNT' as const,
        transactionId: BigInt(0), // Placeholder, will be set in test
        data: {
          amountSGD: 50.00
        },
        statusMessage: "Amount updated to $50.00"
      }
    ]
  },

  // FLOW 5: Parse Edit Intent (for traditional edit command)
  PARSE_EDIT_INTENT_20: {
    amount: 20,
    description: undefined,
    category: undefined,
  },

  PARSE_EDIT_INTENT_LUNCH: {
    amount: undefined,
    description: "lunch",
    category: undefined,
  },
};



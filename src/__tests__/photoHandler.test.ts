import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhotoHandler } from '../handlers/photoHandler';
import { AIService } from '../services/ai';
import { ExpenseService } from '../services/expenseService';

// Mock dependencies
vi.mock('../services/ai');
vi.mock('../services/expenseService');
vi.mock('../config', () => ({
  CONFIG: { TELEGRAM_TOKEN: 'fake_token' }
}));

describe('PhotoHandler', () => {
  let photoHandler: PhotoHandler;
  let mockAiService: any;
  let mockExpenseService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAiService = new AIService('fake_key');
    mockExpenseService = new ExpenseService();
    photoHandler = new PhotoHandler(mockAiService, mockExpenseService);
  });

  it('should group multiple photos and send only one status message', async () => {
    const mockCtx = {
      chat: { id: 123 },
      from: { id: 456 },
      message: {
        photo: [{ file_id: 'file1' }]
      },
      telegram: {
        getFile: vi.fn().mockResolvedValue({ file_path: 'path/to/file1' }),
        editMessageText: vi.fn().mockResolvedValue({}),
      },
      reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    };

    // Simulate first photo
    await photoHandler.handlePhoto(mockCtx);
    
    // Simulate second photo arriving immediately
    mockCtx.message.photo = [{ file_id: 'file2' }];
    await photoHandler.handlePhoto(mockCtx);

    // Assertions
    expect(mockCtx.reply).toHaveBeenCalledTimes(1); // Only one initial "Collecting" message
    expect(mockCtx.telegram.editMessageText).toHaveBeenCalledTimes(1); // Second photo updates first message
    expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
      123, 100, undefined, expect.stringContaining('(2 photos received)')
    );
  });

  it('should re-throw errors from AI service to be handled globally', async () => {
    const mockCtx = {
      chat: { id: 123 },
      from: { id: 456 },
      telegram: {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 200 }),
        deleteMessage: vi.fn().mockResolvedValue(true),
      }
    };

    const mockCollection = {
      photos: [{ fileId: 'f1', filePath: 'p1' }],
      timer: null,
      userId: BigInt(456),
      statusMessageId: 100
    };

    // Mock global fetch for download
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
    });

    // Mock AI service to throw
    vi.mocked(mockAiService.processReceipt).mockRejectedValue(new Error('AI Model Not Found (404)'));

    // We call processPhotoBatch directly to test error propagation
    await expect(
      (photoHandler as any).processPhotoBatch(mockCtx, 123, mockCollection)
    ).rejects.toThrow('AI Model Not Found (404)');

    // Verify cleanup happened before re-throw
    expect(mockCtx.telegram.deleteMessage).toHaveBeenCalledWith(123, 100);
    expect(mockCtx.telegram.deleteMessage).toHaveBeenCalledWith(123, 200);
  });
});


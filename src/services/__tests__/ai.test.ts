import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIService } from '../ai';
import { prisma } from '../../lib/prisma';
import { GoogleGenerativeAI } from '@google/generative-ai';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    systemLog: {
      create: vi.fn(),
    },
  },
}));

const mockModel = {
  generateContent: vi.fn(),
};

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: class {
      getGenerativeModel = vi.fn().mockReturnValue(mockModel);
    },
  };
});

describe('AIService', () => {
  let aiService: AIService;

  beforeEach(() => {
    aiService = new AIService('fake-api-key');
    vi.clearAllMocks();
  });

  describe('processReceipt', () => {
    it('should extract data from a single receipt image', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          isValid: true,
          total: 45.67,
          currency: 'SGD',
          merchant: 'Din Tai Fung',
          date: '2025-12-29',
          category: 'Food',
          transactionCount: 1,
          individualAmounts: [45.67],
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.processReceipt(Buffer.from('fake-image'), BigInt(1));

      expect(result).toEqual(expect.objectContaining({
        isValid: true,
        total: 45.67,
        merchant: 'Din Tai Fung',
        category: 'Food',
      }));

      expect(prisma.systemLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          event: 'receipt_processed',
          metadata: expect.objectContaining({
            success: true,
            isValid: true,
          }),
        }),
      }));
    });

    it('should handle multiple receipt images', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          isValid: true,
          total: 100.0,
          currency: 'SGD',
          merchant: 'Multiple Receipts',
          merchants: ['FairPrice', 'Grab'],
          date: '2025-12-29',
          category: 'Shopping',
          categories: ['Shopping', 'Transport'],
          transactionCount: 2,
          individualAmounts: [80.0, 20.0],
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.processReceipt([Buffer.from('img1'), Buffer.from('img2')], BigInt(1));

      expect(result.total).toBe(100.0);
      expect(result.merchants).toEqual(['FairPrice', 'Grab']);
      expect(result.categories).toEqual(['Shopping', 'Transport']);
    });

    it('should throw error if AI response is invalid JSON', async () => {
      mockModel.generateContent.mockResolvedValueOnce({
        response: { text: () => 'Not a JSON' },
      });

      await expect(aiService.processReceipt(Buffer.from('img'), BigInt(1)))
        .rejects.toThrow('No JSON found in response');

      expect(prisma.systemLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            success: false,
          }),
        }),
      }));
    });
  });
});


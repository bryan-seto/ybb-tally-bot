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

  describe('processCorrection', () => {
    const mockTransactions = [
      {
        id: BigInt(1),
        description: 'Venchi chocolate',
        amountSGD: 25.50,
        category: 'Shopping',
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
      },
      {
        id: BigInt(2),
        description: 'Grab ride',
        amountSGD: 15.00,
        category: 'Transport',
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
      },
      {
        id: BigInt(3),
        description: 'Coffee at Starbucks',
        amountSGD: 8.50,
        category: 'Food',
        bryanPercentage: 0.7,
        hweiYeenPercentage: 0.3,
      },
    ];

    it('should parse a single UPDATE_SPLIT action', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          actions: [{
            action: 'UPDATE_SPLIT',
            transactionId: 1,
            data: {
              bryanPercentage: 0.5,
              hweiYeenPercentage: 0.5,
            },
            statusMessage: 'Updating split for Venchi chocolate to 50-50...',
          }],
          confidence: 'high',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.processCorrection('split venchi 50-50', mockTransactions);

      expect(result.confidence).toBe('high');
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action).toBe('UPDATE_SPLIT');
      expect(result.actions[0].transactionId).toBe(BigInt(1));
      expect(result.actions[0].data?.bryanPercentage).toBe(0.5);
      expect(result.actions[0].data?.hweiYeenPercentage).toBe(0.5);
      expect(result.actions[0].statusMessage).toContain('Updating split');
    });

    it('should parse multiple actions', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          actions: [
            {
              action: 'UPDATE_CATEGORY',
              transactionId: 3,
              data: {
                category: 'Entertainment',
              },
              statusMessage: 'Updating category for Coffee at Starbucks to Entertainment...',
            },
            {
              action: 'DELETE',
              transactionId: 2,
              statusMessage: 'Deleting Grab ride...',
            },
          ],
          confidence: 'high',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.processCorrection(
        'make the coffee entertainment and delete the grab',
        mockTransactions
      );

      expect(result.confidence).toBe('high');
      expect(result.actions).toHaveLength(2);
      expect(result.actions[0].action).toBe('UPDATE_CATEGORY');
      expect(result.actions[0].data?.category).toBe('Entertainment');
      expect(result.actions[1].action).toBe('DELETE');
      expect(result.actions[1].transactionId).toBe(BigInt(2));
    });

    it('should handle UPDATE_AMOUNT action', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          actions: [{
            action: 'UPDATE_AMOUNT',
            transactionId: 1,
            data: {
              amountSGD: 30.00,
            },
            statusMessage: 'Updating amount for Venchi chocolate to $30.00...',
          }],
          confidence: 'high',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.processCorrection('change venchi to $30', mockTransactions);

      expect(result.actions[0].action).toBe('UPDATE_AMOUNT');
      expect(result.actions[0].data?.amountSGD).toBe(30.00);
    });

    it('should handle DELETE actions for multiple transactions', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          actions: [
            {
              action: 'DELETE',
              transactionId: 1,
              statusMessage: 'Deleting Venchi chocolate...',
            },
            {
              action: 'DELETE',
              transactionId: 2,
              statusMessage: 'Deleting Grab ride...',
            },
          ],
          confidence: 'high',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.processCorrection('delete last two', mockTransactions);

      expect(result.actions).toHaveLength(2);
      expect(result.actions[0].action).toBe('DELETE');
      expect(result.actions[1].action).toBe('DELETE');
    });

    it('should return UNKNOWN action with low confidence for invalid JSON', async () => {
      mockModel.generateContent.mockResolvedValueOnce({
        response: { text: () => 'Not a valid JSON response' },
      });

      const result = await aiService.processCorrection('invalid command', mockTransactions);

      expect(result.confidence).toBe('low');
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action).toBe('UNKNOWN');
      expect(result.actions[0].statusMessage).toBeTruthy();
    });

    it('should handle AI errors gracefully', async () => {
      mockModel.generateContent.mockRejectedValueOnce(new Error('AI service unavailable'));

      const result = await aiService.processCorrection('split venchi 50-50', mockTransactions);

      expect(result.confidence).toBe('low');
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action).toBe('UNKNOWN');
    });

    it('should convert transactionId to bigint', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          actions: [{
            action: 'DELETE',
            transactionId: 123, // Returned as number from AI
            statusMessage: 'Deleting transaction...',
          }],
          confidence: 'high',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.processCorrection('delete last', mockTransactions);

      expect(typeof result.actions[0].transactionId).toBe('bigint');
      expect(result.actions[0].transactionId).toBe(BigInt(123));
    });

    it('should add default statusMessage if missing', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          actions: [{
            action: 'DELETE',
            transactionId: 1,
            // statusMessage is missing
          }],
          confidence: 'medium',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.processCorrection('delete', mockTransactions);

      expect(result.actions[0].statusMessage).toBe('Processing...');
    });
  });

  describe('parseEditIntent', () => {
    const mockCurrentTransaction = {
      description: 'Coffee',
      amount: 10.0,
      category: 'Food',
      date: '2025-01-01',
    };

    it('should parse numeric instruction as amount update', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          amount: 20,
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.parseEditIntent('20', mockCurrentTransaction);

      expect(result.amount).toBe(20);
      expect(result.description).toBeUndefined();
      expect(result.category).toBeUndefined();
    });

    it('should parse amount with dollar sign', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          amount: 25.50,
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.parseEditIntent('$25.50', mockCurrentTransaction);

      expect(result.amount).toBe(25.50);
    });

    it('should parse text instruction as description update', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          description: 'lunch',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.parseEditIntent('lunch', mockCurrentTransaction);

      expect(result.description).toBe('lunch');
      expect(result.amount).toBeUndefined();
    });

    it('should parse multi-word description', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          description: 'coffee and pastries',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.parseEditIntent('coffee and pastries', mockCurrentTransaction);

      expect(result.description).toBe('coffee and pastries');
    });

    it('should parse category instruction', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          category: 'Transport',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.parseEditIntent('Transport', mockCurrentTransaction);

      expect(result.category).toBe('Transport');
    });

    it('should parse multiple fields', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          amount: 20,
          description: 'lunch',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.parseEditIntent('20 lunch', mockCurrentTransaction);

      expect(result.amount).toBe(20);
      expect(result.description).toBe('lunch');
    });

    it('should handle invalid JSON response', async () => {
      mockModel.generateContent.mockResolvedValueOnce({
        response: {
          text: () => 'Not a JSON response',
        },
      });

      await expect(
        aiService.parseEditIntent('20', mockCurrentTransaction)
      ).rejects.toThrow();
    });

    it('should filter out invalid values (negative amount)', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          amount: -10, // Invalid
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.parseEditIntent('-10', mockCurrentTransaction);

      expect(result.amount).toBeUndefined();
    });

    it('should filter out invalid values (empty description)', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          description: '',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.parseEditIntent('', mockCurrentTransaction);

      expect(result.description).toBeUndefined();
    });

    it('should trim description strings', async () => {
      const mockResponse = {
        text: () => JSON.stringify({
          description: '  lunch  ',
        }),
      };

      mockModel.generateContent.mockResolvedValueOnce({
        response: mockResponse,
      });

      const result = await aiService.parseEditIntent('lunch', mockCurrentTransaction);

      expect(result.description).toBe('lunch');
    });
  });
});


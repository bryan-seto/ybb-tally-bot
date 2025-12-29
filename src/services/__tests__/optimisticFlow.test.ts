import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExpenseService } from '../expenseService';
import { prisma } from '../../lib/prisma';

// Mock the entire prisma client
vi.mock('../../lib/prisma', () => ({
  prisma: {
    transaction: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

describe('ExpenseService - Optimistic AI Flow', () => {
  let expenseService: ExpenseService;

  beforeEach(() => {
    expenseService = new ExpenseService();
    vi.clearAllMocks();
  });

  it('should batch record multiple transactions from AI result', async () => {
    const userId = BigInt(109284773);
    const mockReceiptData = {
      isValid: true,
      transactions: [
        { amount: 10, merchant: 'Store A', category: 'Food', date: '2023-01-01' },
        { amount: 20, merchant: 'Store B', category: 'Transport', date: '2023-01-02' }
      ]
    };

    // Mock prisma.transaction.create
    vi.mocked(prisma.transaction.create).mockImplementation(async ({ data }: any) => ({
      id: BigInt(Math.floor(Math.random() * 1000)),
      amountSGD: data.amountSGD,
      description: data.description,
      category: data.category,
      payerId: data.payerId,
      date: data.date,
      payer: { name: 'Bryan', role: 'Bryan' }
    }));

    // Mock balance related calls
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: BigInt(1), role: 'Bryan' } as any);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    const result = await expenseService.recordAISavedTransactions(mockReceiptData, userId);

    // Assertions
    expect(result.savedTransactions).toHaveLength(2);
    expect(prisma.transaction.create).toHaveBeenCalledTimes(2);
    expect(result.savedTransactions[0].description).toBe('Store A');
    expect(result.savedTransactions[1].amountSGD).toBe(20);
    expect(result.balanceMessage).toContain('All expenses are settled');
  });

  it('should fallback to default values if AI data is incomplete', async () => {
    const userId = BigInt(109284773);
    const incompleteData = {
      isValid: true,
      total: 15.50,
      merchant: null,
      category: undefined
    };

    vi.mocked(prisma.transaction.create).mockImplementation(async ({ data }: any) => ({
      id: BigInt(1),
      ...data,
      payer: { name: 'Bryan', role: 'Bryan' }
    }));
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: BigInt(1), role: 'Bryan' } as any);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    const result = await expenseService.recordAISavedTransactions(incompleteData, userId);

    expect(result.savedTransactions[0].description).toBe('Unknown Merchant');
    expect(result.savedTransactions[0].category).toBe('Other');
    expect(result.savedTransactions[0].amountSGD).toBe(15.50);
  });
});


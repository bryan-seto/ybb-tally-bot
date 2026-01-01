import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditService } from '../editService';
import { AIService } from '../ai';
import { prisma } from '../../lib/prisma';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    transaction: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('EditService', () => {
  let editService: EditService;
  let mockAIService: AIService;

  beforeEach(() => {
    mockAIService = {
      parseEditIntent: vi.fn(),
    } as any;
    editService = new EditService(mockAIService);
    vi.clearAllMocks();
  });

  describe('processEditCommand - Command Parsing', () => {
    it('should parse valid edit command with slash', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ amount: 20 });
      vi.mocked(prisma.transaction.update).mockResolvedValue({
        ...mockTransaction,
        amountSGD: 20.0,
      } as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 20');

      expect(result.success).toBe(true);
      expect(vi.mocked(prisma.transaction.update).mock.calls.length).toBe(1);
    });

    it('should parse valid edit command without slash', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ amount: 20 });
      vi.mocked(prisma.transaction.update).mockResolvedValue({
        ...mockTransaction,
        amountSGD: 20.0,
      } as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit 15 20');

      expect(result.success).toBe(true);
    });

    it('should parse case-insensitive edit command', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ amount: 20 });
      vi.mocked(prisma.transaction.update).mockResolvedValue({
        ...mockTransaction,
        amountSGD: 20.0,
      } as any);

      const result = await editService.processEditCommand(BigInt(1), 'Edit /15 20');

      expect(result.success).toBe(true);
    });

    it('should reject invalid format - missing instruction', async () => {
      const result = await editService.processEditCommand(BigInt(1), 'edit /15');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid edit command format');
    });

    it('should reject invalid format - no ID', async () => {
      const result = await editService.processEditCommand(BigInt(1), 'edit');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid edit command format');
    });

    it('should reject empty instruction', async () => {
      const result = await editService.processEditCommand(BigInt(1), 'edit /15   ');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Please provide an instruction');
    });
  });

  describe('processEditCommand - Security & Authorization', () => {
    it('should return error when transaction not found', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(null);

      const result = await editService.processEditCommand(BigInt(1), 'edit /999 20');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Transaction /999 not found');
    });

    it('should return error when user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const result = await editService.processEditCommand(BigInt(999), 'edit /15 20');

      expect(result.success).toBe(false);
      expect(result.message).toContain('User not found');
    });

    it('should validate groupId when both exist and mismatch', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan', groupId: BigInt(1) };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
        groupId: BigInt(2), // Different group
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 20');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unauthorized');
    });

    it('should allow edit when groupIds match', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan', groupId: BigInt(1) };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
        groupId: BigInt(1), // Same group
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ amount: 20 });
      vi.mocked(prisma.transaction.update).mockResolvedValue({
        ...mockTransaction,
        amountSGD: 20.0,
      } as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 20');

      expect(result.success).toBe(true);
    });
  });

  describe('processEditCommand - AI Parsing Integration', () => {
    it('should handle AI parsing failure', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockRejectedValue(new Error('AI service error'));

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 gibberish');

      expect(result.success).toBe(false);
      expect(result.message).toContain('something went wrong');
    });

    it('should handle empty AI result', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({});

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 gibberish');

      expect(result.success).toBe(false);
      expect(result.message).toContain('couldn\'t understand');
    });
  });

  describe('processEditCommand - Data Validation', () => {
    it('should reject invalid amount (negative)', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ amount: -10 });

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 -10');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid amount');
    });

    it('should reject invalid amount (zero)', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ amount: 0 });

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 0');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid amount');
    });

    it('should reject empty description', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ description: '   ' });

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 ""');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid description');
    });

    it('should accept valid partial update - amount only', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ amount: 20 });
      vi.mocked(prisma.transaction.update).mockResolvedValue({
        ...mockTransaction,
        amountSGD: 20.0,
      } as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 20');

      expect(result.success).toBe(true);
      expect(vi.mocked(prisma.transaction.update)).toHaveBeenCalledWith({
        where: { id: BigInt(15) },
        data: { amountSGD: 20 },
        include: { payer: true },
      });
    });

    it('should accept valid partial update - description only', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ description: 'lunch' });
      vi.mocked(prisma.transaction.update).mockResolvedValue({
        ...mockTransaction,
        description: 'lunch',
      } as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 lunch');

      expect(result.success).toBe(true);
      expect(vi.mocked(prisma.transaction.update)).toHaveBeenCalledWith({
        where: { id: BigInt(15) },
        data: { description: 'lunch' },
        include: { payer: true },
      });
    });
  });

  describe('processEditCommand - Diff Calculation', () => {
    it('should calculate diff correctly for amount change', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ amount: 20 });
      vi.mocked(prisma.transaction.update).mockResolvedValue({
        ...mockTransaction,
        amountSGD: 20.0,
      } as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 20');

      expect(result.success).toBe(true);
      expect(result.changes).toBeDefined();
      expect(result.changes?.length).toBe(1);
      expect(result.changes?.[0].field).toBe('amountSGD');
      expect(result.changes?.[0].old).toBe(10);
      expect(result.changes?.[0].new).toBe(20);
    });

    it('should calculate diff correctly for description change', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ description: 'lunch' });
      vi.mocked(prisma.transaction.update).mockResolvedValue({
        ...mockTransaction,
        description: 'lunch',
      } as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 lunch');

      expect(result.success).toBe(true);
      expect(result.changes).toBeDefined();
      expect(result.changes?.length).toBe(1);
      expect(result.changes?.[0].field).toBe('description');
      expect(result.changes?.[0].old).toBe('Coffee');
      expect(result.changes?.[0].new).toBe('lunch');
    });

    it('should calculate diff correctly for category change', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ category: 'Transport' });
      vi.mocked(prisma.transaction.update).mockResolvedValue({
        ...mockTransaction,
        category: 'Transport',
      } as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 Transport');

      expect(result.success).toBe(true);
      expect(result.changes).toBeDefined();
      expect(result.changes?.length).toBe(1);
      expect(result.changes?.[0].field).toBe('category');
      expect(result.changes?.[0].old).toBe('Food');
      expect(result.changes?.[0].new).toBe('Transport');
    });

    it('should calculate diff for multiple fields', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({
        amount: 20,
        description: 'lunch',
      });
      vi.mocked(prisma.transaction.update).mockResolvedValue({
        ...mockTransaction,
        amountSGD: 20.0,
        description: 'lunch',
      } as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 20 lunch');

      expect(result.success).toBe(true);
      expect(result.changes).toBeDefined();
      expect(result.changes?.length).toBe(2);
      expect(result.changes?.some((c) => c.field === 'amountSGD')).toBe(true);
      expect(result.changes?.some((c) => c.field === 'description')).toBe(true);
    });

    it('should not include unchanged fields in diff', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ amount: 10 }); // Same amount
      vi.mocked(prisma.transaction.update).mockResolvedValue(mockTransaction as any);

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 10');

      expect(result.success).toBe(true);
      // If amount didn't change, changes array should be empty or not include amount
      if (result.changes && result.changes.length > 0) {
        expect(result.changes.some((c) => c.field === 'amountSGD' && c.old === c.new)).toBe(false);
      }
    });
  });

  describe('processEditCommand - Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const mockUser = { id: BigInt(1), name: 'Test User', role: 'Bryan' };
      const mockTransaction = {
        id: BigInt(15),
        amountSGD: 10.0,
        description: 'Coffee',
        category: 'Food',
        date: new Date(),
        payerId: BigInt(1),
        payer: mockUser,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.transaction.findUnique).mockResolvedValue(mockTransaction as any);
      vi.mocked(mockAIService.parseEditIntent).mockResolvedValue({ amount: 20 });
      vi.mocked(prisma.transaction.update).mockRejectedValue(new Error('Database connection failed'));

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 20');

      expect(result.success).toBe(false);
      expect(result.message).toContain('something went wrong');
    });

    it('should handle unexpected errors', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('Unexpected error'));

      const result = await editService.processEditCommand(BigInt(1), 'edit /15 20');

      expect(result.success).toBe(false);
      expect(result.message).toContain('something went wrong');
    });
  });
});


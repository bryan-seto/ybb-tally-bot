import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SplitRulesService, ValidationError } from '../splitRulesService';
import { prisma } from '../../lib/prisma';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    settings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe('SplitRulesService', () => {
  let service: SplitRulesService;

  beforeEach(() => {
    service = new SplitRulesService();
    service.invalidateCache(); // Clear cache before each test
    vi.clearAllMocks();
  });

  describe('SplitRulesService_Defaults', () => {
    it('should return hardcoded defaults when Settings table is empty', async () => {
      // Mock: No setting found
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);

      // Test: Get split rule for known category
      const groceriesRule = await service.getSplitRule('Groceries');
      expect(groceriesRule.userAPercent).toBe(0.5);
      expect(groceriesRule.userBPercent).toBe(0.5);

      // Test: Get split rule for another known category
      const foodRule = await service.getSplitRule('Food');
      expect(foodRule.userAPercent).toBe(0.5);
      expect(foodRule.userBPercent).toBe(0.5);

      // Test: Get split rule for unknown category (should return global default)
      const unknownRule = await service.getSplitRule('UnknownCategory');
      expect(unknownRule.userAPercent).toBe(0.5);
      expect(unknownRule.userBPercent).toBe(0.5);
    });

    it('should return defaults when Settings.value is null', async () => {
      // Mock: Setting exists but value is null
      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'category_split_rules',
        value: null,
        updatedAt: new Date(),
      } as any);

      const rule = await service.getSplitRule('Groceries');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
    });
  });

  describe('SplitRulesService_Override', () => {
    it('should return configured value from database for specific category', async () => {
      // Mock: Database has custom config
      const customConfig = {
        Food: { userAPercent: 0.6, userBPercent: 0.4 },
      };

      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'category_split_rules',
        value: JSON.stringify(customConfig),
        updatedAt: new Date(),
      } as any);

      // Test: Food should return custom value
      const foodRule = await service.getSplitRule('Food');
      expect(foodRule.userAPercent).toBe(0.6);
      expect(foodRule.userBPercent).toBe(0.4);

      // Test: Groceries should return default (not in custom config)
      const groceriesRule = await service.getSplitRule('Groceries');
      expect(groceriesRule.userAPercent).toBe(0.5);
      expect(groceriesRule.userBPercent).toBe(0.5);
    });

    it('should merge custom config with defaults', async () => {
      // Mock: Database has partial config
      const customConfig = {
        Food: { userAPercent: 0.8, userBPercent: 0.2 },
      };

      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'category_split_rules',
        value: JSON.stringify(customConfig),
        updatedAt: new Date(),
      } as any);

      // Test: Food uses custom
      const foodRule = await service.getSplitRule('Food');
      expect(foodRule.userAPercent).toBe(0.8);
      expect(foodRule.userBPercent).toBe(0.2);

      // Test: Groceries uses default (merged)
      const groceriesRule = await service.getSplitRule('Groceries');
      expect(groceriesRule.userAPercent).toBe(0.5);
      expect(groceriesRule.userBPercent).toBe(0.5);
    });
  });

  describe('SplitRulesService_Normalization', () => {
    beforeEach(() => {
      // Mock: No database config (use defaults)
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
    });

    it('should treat "food", "Food", and "FOOD" as the same category', async () => {
      const rule1 = await service.getSplitRule('food');
      const rule2 = await service.getSplitRule('Food');
      const rule3 = await service.getSplitRule('FOOD');

      expect(rule1.userAPercent).toBe(rule2.userAPercent);
      expect(rule2.userAPercent).toBe(rule3.userAPercent);
      expect(rule1.userBPercent).toBe(rule2.userBPercent);
      expect(rule2.userBPercent).toBe(rule3.userBPercent);
    });

    it('should normalize "grocery" to "Groceries"', async () => {
      const rule = await service.getSplitRule('grocery');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
    });

    it('should normalize "dining" to "Food"', async () => {
      const rule = await service.getSplitRule('dining');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
    });

    it('should handle case-insensitive category matching', async () => {
      const lowerRule = await service.getSplitRule('groceries');
      const upperRule = await service.getSplitRule('GROCERIES');
      const mixedRule = await service.getSplitRule('GrOcErIeS');

      expect(lowerRule.userAPercent).toBe(upperRule.userAPercent);
      expect(upperRule.userAPercent).toBe(mixedRule.userAPercent);
    });
  });

  describe('SplitRulesService_Validation', () => {
    it('should throw ValidationError if percentages do not sum to 1.0', async () => {
      // Test: Sum > 1.0
      await expect(
        service.updateSplitRule('Food', 0.6, 0.5)
      ).rejects.toThrow(ValidationError);

      // Test: Sum < 1.0
      await expect(
        service.updateSplitRule('Food', 0.3, 0.6)
      ).rejects.toThrow(ValidationError);

      // Test: Sum = 0
      await expect(
        service.updateSplitRule('Food', 0, 0)
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if percentages are out of range', async () => {
      // Test: Negative percentage
      await expect(
        service.updateSplitRule('Food', -0.1, 1.1)
      ).rejects.toThrow(ValidationError);

      // Test: Percentage > 1.0
      await expect(
        service.updateSplitRule('Food', 1.5, -0.5)
      ).rejects.toThrow(ValidationError);
    });

    it('should accept valid percentages that sum to 1.0 (within epsilon)', async () => {
      // Mock: Database operations
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.settings.upsert).mockResolvedValue({
        key: 'category_split_rules',
        value: JSON.stringify({ Food: { userAPercent: 0.5, userBPercent: 0.5 } }),
        updatedAt: new Date(),
      } as any);

      // Test: Exact 1.0
      await expect(
        service.updateSplitRule('Food', 0.5, 0.5)
      ).resolves.not.toThrow();

      // Test: Within epsilon (0.5001 + 0.4999 = 1.0)
      await expect(
        service.updateSplitRule('Food', 0.5001, 0.4999)
      ).resolves.not.toThrow();
    });

    it('should validate rule structure (must have userAPercent and userBPercent)', async () => {
      // Mock: Invalid structure in database
      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'category_split_rules',
        value: JSON.stringify({ Food: { invalid: 'structure' } }),
        updatedAt: new Date(),
      } as any);

      // Should return default (invalid rule filtered out)
      const rule = await service.getSplitRule('Food');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
    });
  });

  describe('SplitRulesService_Corruption', () => {
    it('should return defaults when database contains invalid JSON', async () => {
      // Mock: Invalid JSON string
      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'category_split_rules',
        value: 'invalid json string',
        updatedAt: new Date(),
      } as any);

      // Should not throw, should return defaults
      const rule = await service.getSplitRule('Food');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
    });

    it('should return defaults when database contains empty JSON object', async () => {
      // Mock: Empty object
      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'category_split_rules',
        value: '{}',
        updatedAt: new Date(),
      } as any);

      // Should return defaults (empty object merged with defaults)
      const rule = await service.getSplitRule('Groceries');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
    });

    it('should return defaults when database contains null value', async () => {
      // Mock: Null value
      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'category_split_rules',
        value: null,
        updatedAt: new Date(),
      } as any);

      // Should return defaults
      const rule = await service.getSplitRule('Food');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
    });

    it('should handle database errors gracefully and return defaults', async () => {
      // Mock: Database throws error
      vi.mocked(prisma.settings.findUnique).mockRejectedValue(
        new Error('Database connection failed')
      );

      // Should not throw, should return defaults
      const rule = await service.getSplitRule('Food');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
    });

    it('should filter out invalid rules from corrupted config', async () => {
      // Mock: Config with some valid and some invalid rules
      const corruptedConfig = {
        Food: { userAPercent: 0.5, userBPercent: 0.5 }, // Valid
        Groceries: { userAPercent: 0.8, userBPercent: 0.1 }, // Invalid (sums to 0.9)
        Bills: { invalid: 'structure' }, // Invalid structure
      };

      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'category_split_rules',
        value: JSON.stringify(corruptedConfig),
        updatedAt: new Date(),
      } as any);

      // Food should use custom (valid)
      const foodRule = await service.getSplitRule('Food');
      expect(foodRule.userAPercent).toBe(0.5);
      expect(foodRule.userBPercent).toBe(0.5);

      // Groceries should use default (invalid rule filtered out)
      const groceriesRule = await service.getSplitRule('Groceries');
      expect(groceriesRule.userAPercent).toBe(0.5);
      expect(groceriesRule.userBPercent).toBe(0.5);

      // Bills should use default (invalid structure filtered out)
      const billsRule = await service.getSplitRule('Bills');
      expect(billsRule.userAPercent).toBe(0.5);
      expect(billsRule.userBPercent).toBe(0.5);
    });
  });

  describe('Caching', () => {
    it('should cache config for 60 seconds', async () => {
      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'category_split_rules',
        value: JSON.stringify({ Food: { userAPercent: 0.6, userBPercent: 0.4 } }),
        updatedAt: new Date(),
      } as any);

      // First call: should hit database
      await service.getSplitRule('Food');
      expect(prisma.settings.findUnique).toHaveBeenCalledTimes(1);

      // Second call: should use cache (no additional DB call)
      await service.getSplitRule('Food');
      expect(prisma.settings.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache after update', async () => {
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.settings.upsert).mockResolvedValue({
        key: 'category_split_rules',
        value: JSON.stringify({ Food: { userAPercent: 0.6, userBPercent: 0.4 } }),
        updatedAt: new Date(),
      } as any);

      // Update should invalidate cache
      await service.updateSplitRule('Food', 0.6, 0.4);

      // Next call should fetch fresh data
      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'category_split_rules',
        value: JSON.stringify({ Food: { userAPercent: 0.6, userBPercent: 0.4 } }),
        updatedAt: new Date(),
      } as any);

      await service.getSplitRule('Food');
      // Should have called findUnique after cache invalidation
      expect(prisma.settings.findUnique).toHaveBeenCalled();
    });
  });

  describe('updateSplitRule', () => {
    it('should update and persist split rule', async () => {
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.settings.upsert).mockResolvedValue({
        key: 'category_split_rules',
        value: JSON.stringify({ Food: { userAPercent: 0.6, userBPercent: 0.4 } }),
        updatedAt: new Date(),
      } as any);

      await service.updateSplitRule('Food', 0.6, 0.4);

      expect(prisma.settings.upsert).toHaveBeenCalledWith({
        where: { key: 'category_split_rules' },
        update: {
          value: expect.stringContaining('"Food"'),
          updatedAt: expect.any(Date),
        },
        create: {
          key: 'category_split_rules',
          value: expect.stringContaining('"Food"'),
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should normalize category name when updating', async () => {
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.settings.upsert).mockResolvedValue({
        key: 'category_split_rules',
        value: JSON.stringify({ Food: { userAPercent: 0.6, userBPercent: 0.4 } }),
        updatedAt: new Date(),
      } as any);

      // Update with lowercase category
      await service.updateSplitRule('food', 0.6, 0.4);

      // Should normalize to "Food" in the stored config
      const call = vi.mocked(prisma.settings.upsert).mock.calls[0][0];
      const storedValue = JSON.parse(call.update.value);
      expect(storedValue).toHaveProperty('Food');
      expect(storedValue.Food.userAPercent).toBe(0.6);
    });
  });

  describe('resetToDefaults', () => {
    it('should delete settings key and reset to defaults', async () => {
      vi.mocked(prisma.settings.delete).mockResolvedValue({
        key: 'category_split_rules',
        value: null,
        updatedAt: new Date(),
      } as any);

      await service.resetToDefaults();

      expect(prisma.settings.delete).toHaveBeenCalledWith({
        where: { key: 'category_split_rules' },
      });

      // After reset, should return defaults
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
      const rule = await service.getSplitRule('Food');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
    });
  });

  // TDD Contract Tests (as specified in the plan)
  describe('TDD Contract Tests', () => {
    beforeEach(() => {
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
    });

    it('Test: Household Defaults - should return 50/50 for Groceries', async () => {
      const rule = await service.getSplitRule('Groceries');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
      // Constraint: Must not return 0.7/0.3
      expect(rule.userAPercent).not.toBe(0.7);
      expect(rule.userBPercent).not.toBe(0.3);
    });

    it('Test: Unknown Category Fallback - should return 50/50 for AlienTechnology', async () => {
      const rule = await service.getSplitRule('AlienTechnology');
      expect(rule.userAPercent).toBe(0.5);
      expect(rule.userBPercent).toBe(0.5);
      // Constraint: Must use GLOBAL_DEFAULT (no longer 0.7/0.3)
      expect(rule.userAPercent).not.toBe(0.7);
      expect(rule.userBPercent).not.toBe(0.3);
    });
  });
});

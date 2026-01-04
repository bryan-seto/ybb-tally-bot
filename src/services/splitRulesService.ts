import { prisma } from '../lib/prisma';

/**
 * Category split rule interface
 */
export interface CategorySplitRule {
  userAPercent: number;
  userBPercent: number;
}

/**
 * Split rules configuration (all categories)
 */
export interface SplitRulesConfig {
  [category: string]: CategorySplitRule;
}

/**
 * Validation error for invalid split percentages
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Global default (when category not found)
 * All categories default to 50-50 unless overridden in database
 */
const GLOBAL_DEFAULT: CategorySplitRule = { userAPercent: 0.5, userBPercent: 0.5 };

/**
 * Category normalization mappings
 * Maps variations to canonical category names
 */
const CATEGORY_MAPPINGS: Record<string, string> = {
  // Groceries variations
  'grocery': 'Groceries',
  'groceries': 'Groceries',
  'GROCERIES': 'Groceries',
  'Grocery': 'Groceries',
  
  // Food variations
  'food': 'Food',
  'FOOD': 'Food',
  'dining': 'Food',
  'restaurant': 'Food',
  
  // Bills variations
  'bills': 'Bills',
  'BILLS': 'Bills',
  'bill': 'Bills',
  'utilities': 'Bills',
  
  // Shopping variations
  'shopping': 'Shopping',
  'SHOPPING': 'Shopping',
  'shop': 'Shopping',
  
  // Travel variations
  'travel': 'Travel',
  'TRAVEL': 'Travel',
  'trip': 'Travel',
  
  // Entertainment variations
  'entertainment': 'Entertainment',
  'ENTERTAINMENT': 'Entertainment',
  'fun': 'Entertainment',
  
  // Transport variations
  'transport': 'Transport',
  'TRANSPORT': 'Transport',
  'transportation': 'Transport',
  'commute': 'Transport',
};

/**
 * Cache entry interface
 */
interface CacheEntry {
  config: SplitRulesConfig;
  timestamp: number;
}

/**
 * Split Rules Service
 * Manages category-based split percentage rules with database persistence
 */
export class SplitRulesService {
  private cache: CacheEntry | null = null;
  private readonly CACHE_TTL_MS = 60 * 1000; // 60 seconds
  private readonly SETTINGS_KEY = 'category_split_rules';
  private readonly EPSILON = 0.001; // For float precision validation

  /**
   * Get split rule for a category
   * Returns: configured rule from database, or global 50-50 default
   * CRITICAL: Never throws - always returns a valid rule (fail-safe to 50-50)
   */
  async getSplitRule(category: string): Promise<CategorySplitRule> {
    console.log(`[DIAGNOSTIC] getSplitRule ENTRY category="${category}"`);
    try {
      console.log('[DIAGNOSTIC] getSplitRule STATE calling getSplitRulesConfig');
      const config = await this.getSplitRulesConfig();
      const configKeys = Object.keys(config);
      console.log(`[DIAGNOSTIC] getSplitRule STATE getSplitRulesConfig result keys=[${configKeys.join(', ')}]`);
      const normalizedCategory = this.normalizeCategory(category);
      console.log(`[DIAGNOSTIC] getSplitRule STATE normalized category="${normalizedCategory}" original="${category}"`);
      
      // Try normalized category first
      if (config[normalizedCategory]) {
        const rule = config[normalizedCategory];
        console.log(`[DIAGNOSTIC] getSplitRule STATE found in config (normalized) userAPercent=${rule.userAPercent} userBPercent=${rule.userBPercent}`);
        console.log(`[DIAGNOSTIC] getSplitRule EXIT userAPercent=${rule.userAPercent} userBPercent=${rule.userBPercent}`);
        return rule;
      }
      
      // Try original category (case-sensitive)
      if (config[category]) {
        const rule = config[category];
        console.log(`[DIAGNOSTIC] getSplitRule STATE found in config (original) userAPercent=${rule.userAPercent} userBPercent=${rule.userBPercent}`);
        console.log(`[DIAGNOSTIC] getSplitRule EXIT userAPercent=${rule.userAPercent} userBPercent=${rule.userBPercent}`);
        return rule;
      }
      
      // Global default: 50-50 for all categories
      console.log(`[DIAGNOSTIC] getSplitRule STATE using GLOBAL_DEFAULT (no match found)`);
      console.log(`[DIAGNOSTIC] getSplitRule EXIT userAPercent=${GLOBAL_DEFAULT.userAPercent} userBPercent=${GLOBAL_DEFAULT.userBPercent}`);
      return GLOBAL_DEFAULT;
    } catch (error) {
      // Defensive: If anything goes wrong, return safe default
      console.error('[DIAGNOSTIC] getSplitRule ERROR', error);
      console.error('[DIAGNOSTIC] getSplitRule ERROR stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.log(`[DIAGNOSTIC] getSplitRule EXIT (error fallback) userAPercent=${GLOBAL_DEFAULT.userAPercent} userBPercent=${GLOBAL_DEFAULT.userBPercent}`);
      return GLOBAL_DEFAULT;
    }
  }

  /**
   * Get all split rules configuration
   * CRITICAL: Fail-safe - always returns valid config, never throws
   * Returns only database-stored rules (no hardcoded defaults)
   */
  async getSplitRulesConfig(): Promise<SplitRulesConfig> {
    console.log('[DIAGNOSTIC] getSplitRulesConfig ENTRY');
    // Check cache first
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL_MS) {
      const cacheKeys = Object.keys(this.cache.config);
      console.log(`[DIAGNOSTIC] getSplitRulesConfig STATE cache hit keys=[${cacheKeys.join(', ')}]`);
      console.log(`[DIAGNOSTIC] getSplitRulesConfig EXIT cache hit keys=[${cacheKeys.join(', ')}]`);
      return this.cache.config;
    }
    console.log('[DIAGNOSTIC] getSplitRulesConfig STATE cache miss');

    try {
      // Fetch from database
      console.log(`[DIAGNOSTIC] getSplitRulesConfig STATE calling db query key="${this.SETTINGS_KEY}"`);
      const setting = await prisma.settings.findUnique({
        where: { key: this.SETTINGS_KEY },
      });

      if (!setting || !setting.value) {
        // No config in DB, return empty object (categories will use 50-50 default)
        console.log('[DIAGNOSTIC] getSplitRulesConfig STATE db query result setting=null');
        const emptyConfig: SplitRulesConfig = {};
        this.cache = { config: emptyConfig, timestamp: Date.now() };
        console.log('[DIAGNOSTIC] getSplitRulesConfig EXIT empty config');
        return emptyConfig;
      }
      console.log('[DIAGNOSTIC] getSplitRulesConfig STATE db query result setting found');

      // Parse JSON with error handling
      let parsedConfig: any;
      try {
        console.log('[DIAGNOSTIC] getSplitRulesConfig STATE parsing JSON');
        parsedConfig = JSON.parse(setting.value);
        const parsedKeys = Object.keys(parsedConfig);
        console.log(`[DIAGNOSTIC] getSplitRulesConfig STATE parsed config keys=[${parsedKeys.join(', ')}]`);
      } catch (parseError) {
        console.error('[DIAGNOSTIC] getSplitRulesConfig ERROR JSON parse failed', parseError);
        // Return empty config on parse error (categories will use 50-50 default)
        const emptyConfig: SplitRulesConfig = {};
        this.cache = { config: emptyConfig, timestamp: Date.now() };
        console.log('[DIAGNOSTIC] getSplitRulesConfig EXIT empty config (parse error)');
        return emptyConfig;
      }

      // Validate and sanitize config (returns only valid rules)
      const validatedConfig = this.validateConfig(parsedConfig);
      const validatedKeys = Object.keys(validatedConfig);
      console.log(`[DIAGNOSTIC] getSplitRulesConfig STATE validated config keys=[${validatedKeys.join(', ')}]`);
      
      // Update cache
      this.cache = { config: validatedConfig, timestamp: Date.now() };
      console.log(`[DIAGNOSTIC] getSplitRulesConfig EXIT keys=[${validatedKeys.join(', ')}]`);
      return validatedConfig;
    } catch (error) {
      console.error('[DIAGNOSTIC] getSplitRulesConfig ERROR', error);
      console.error('[DIAGNOSTIC] getSplitRulesConfig ERROR stack:', error instanceof Error ? error.stack : 'No stack trace');
      // Fail-safe: return empty config (categories will use 50-50 default)
      const emptyConfig: SplitRulesConfig = {};
      this.cache = { config: emptyConfig, timestamp: Date.now() };
      console.log('[DIAGNOSTIC] getSplitRulesConfig EXIT empty config (error fallback)');
      return emptyConfig;
    }
  }

  /**
   * Update split rule for a category
   * Throws ValidationError if percentages are invalid
   */
  async updateSplitRule(category: string, userAPercent: number, userBPercent: number): Promise<void> {
    // Validate percentages
    if (!this.isValidRule({ userAPercent, userBPercent })) {
      throw new ValidationError(
        `Invalid split percentages: ${userAPercent} + ${userBPercent} must equal 1.0 (within epsilon ${this.EPSILON})`
      );
    }

    // Normalize category
    const normalizedCategory = this.normalizeCategory(category);

    // Invalidate cache before update
    this.invalidateCache();

    try {
      // Get current config
      const currentConfig = await this.getSplitRulesConfig();
      
      // Update the rule
      const updatedConfig: SplitRulesConfig = {
        ...currentConfig,
        [normalizedCategory]: { userAPercent, userBPercent },
      };

      // Save to database
      await prisma.settings.upsert({
        where: { key: this.SETTINGS_KEY },
        update: {
          value: JSON.stringify(updatedConfig),
          updatedAt: new Date(),
        },
        create: {
          key: this.SETTINGS_KEY,
          value: JSON.stringify(updatedConfig),
          updatedAt: new Date(),
        },
      });

      // Invalidate cache after update
      this.invalidateCache();
    } catch (error) {
      console.error('❌ [SplitRulesService] Error updating split rule:', error);
      throw error;
    }
  }

  /**
   * Reset to default rules
   */
  async resetToDefaults(): Promise<void> {
    this.invalidateCache();

    try {
      await prisma.settings.delete({
        where: { key: this.SETTINGS_KEY },
      }).catch(() => {
        // Ignore if key doesn't exist
      });

      this.invalidateCache();
    } catch (error) {
      console.error('❌ [SplitRulesService] Error resetting to defaults:', error);
      throw error;
    }
  }

  /**
   * Normalize category name (case-insensitive, handle variations)
   */
  private normalizeCategory(category: string): string {
    if (!category) {
      return 'Other';
    }

    const trimmed = category.trim();
    
    // Check mappings first
    if (CATEGORY_MAPPINGS[trimmed]) {
      return CATEGORY_MAPPINGS[trimmed];
    }

    // Case-insensitive lookup in mappings
    const lowerTrimmed = trimmed.toLowerCase();
    for (const [key, value] of Object.entries(CATEGORY_MAPPINGS)) {
      if (key.toLowerCase() === lowerTrimmed) {
        return value;
      }
    }

    // Capitalize first letter, rest lowercase (for consistency)
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }

  /**
   * Validate and sanitize config structure
   * Returns: Validated config with only valid rules, invalid entries filtered out
   */
  private validateConfig(config: any): SplitRulesConfig {
    if (!config || typeof config !== 'object') {
      return {};
    }

    const validated: SplitRulesConfig = {};

    for (const [category, rule] of Object.entries(config)) {
      if (this.isValidRule(rule as any)) {
        validated[category] = rule as CategorySplitRule;
      } else {
        console.warn(`⚠️ [SplitRulesService] Invalid rule for category "${category}", skipping`);
      }
    }

    return validated;
  }

  /**
   * Check if a rule object is valid
   * CRITICAL: Uses epsilon for float precision check
   */
  private isValidRule(rule: any): rule is CategorySplitRule {
    if (!rule || typeof rule !== 'object') {
      return false;
    }

    const { userAPercent, userBPercent } = rule;

    if (typeof userAPercent !== 'number' || typeof userBPercent !== 'number') {
      return false;
    }

    // Epsilon check: sum must be within 0.001 of 1.0
    const sum = userAPercent + userBPercent;
    const isValid = Math.abs(sum - 1.0) < this.EPSILON;

    // Also check that percentages are in valid range [0, 1]
    const inRange = userAPercent >= 0 && userAPercent <= 1 && userBPercent >= 0 && userBPercent <= 1;

    return isValid && inRange;
  }

  /**
   * Invalidate cache (call after updates)
   */
  invalidateCache(): void {
    this.cache = null;
  }
}


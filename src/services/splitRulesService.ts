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
 * Default split rules (hardcoded fallback)
 */
const DEFAULT_RULES: SplitRulesConfig = {
  'Groceries': { userAPercent: 0.5, userBPercent: 0.5 },
  'Bills': { userAPercent: 0.5, userBPercent: 0.5 },
  'Shopping': { userAPercent: 0.5, userBPercent: 0.5 },
  'Food': { userAPercent: 0.5, userBPercent: 0.5 },
  'Travel': { userAPercent: 0.5, userBPercent: 0.5 },
  'Entertainment': { userAPercent: 0.5, userBPercent: 0.5 },
  'Transport': { userAPercent: 0.5, userBPercent: 0.5 },
};

/**
 * Global default (when category not found)
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
   * Returns: configured rule, or default for category, or global default
   */
  async getSplitRule(category: string): Promise<CategorySplitRule> {
    const config = await this.getSplitRulesConfig();
    const normalizedCategory = this.normalizeCategory(category);
    
    // Try normalized category first
    if (config[normalizedCategory]) {
      return config[normalizedCategory];
    }
    
    // Try original category (case-sensitive)
    if (config[category]) {
      return config[category];
    }
    
    // Try default rules
    if (DEFAULT_RULES[normalizedCategory]) {
      return DEFAULT_RULES[normalizedCategory];
    }
    
    if (DEFAULT_RULES[category]) {
      return DEFAULT_RULES[category];
    }
    
    // Global default
    return GLOBAL_DEFAULT;
  }

  /**
   * Get all split rules configuration
   * CRITICAL: Fail-safe - always returns valid config, never throws
   */
  async getSplitRulesConfig(): Promise<SplitRulesConfig> {
    // Check cache first
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL_MS) {
      return this.cache.config;
    }

    try {
      // Fetch from database
      const setting = await prisma.settings.findUnique({
        where: { key: this.SETTINGS_KEY },
      });

      if (!setting || !setting.value) {
        // No config in DB, return defaults
        const defaultConfig = { ...DEFAULT_RULES };
        this.cache = { config: defaultConfig, timestamp: Date.now() };
        return defaultConfig;
      }

      // Parse JSON with error handling
      let parsedConfig: any;
      try {
        parsedConfig = JSON.parse(setting.value);
      } catch (parseError) {
        console.error('❌ [SplitRulesService] Failed to parse JSON from database:', parseError);
        // Return defaults on parse error
        const defaultConfig = { ...DEFAULT_RULES };
        this.cache = { config: defaultConfig, timestamp: Date.now() };
        return defaultConfig;
      }

      // Validate and sanitize config
      const validatedConfig = this.validateConfig(parsedConfig);
      
      // Merge with defaults (so missing categories use defaults)
      const mergedConfig = { ...DEFAULT_RULES, ...validatedConfig };
      
      // Update cache
      this.cache = { config: mergedConfig, timestamp: Date.now() };
      return mergedConfig;
    } catch (error) {
      console.error('❌ [SplitRulesService] Error fetching config from database:', error);
      // Fail-safe: return defaults
      const defaultConfig = { ...DEFAULT_RULES };
      this.cache = { config: defaultConfig, timestamp: Date.now() };
      return defaultConfig;
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


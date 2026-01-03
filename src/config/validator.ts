import { z } from 'zod';

/**
 * Environment Variable Validator
 * 
 * Validates and normalizes all environment variables using Zod.
 * Fails fast if required variables are missing or invalid.
 */

/**
 * Validate Telegram Bot Token
 * 
 * Performs strict validation to catch placeholder values and invalid formats
 * before any Telegram API calls are made.
 * 
 * @param token - Token to validate
 * @throws Exits process if token is invalid
 */
export function validateTelegramToken(token: string | undefined): void {
  // 1. Missing Check
  if (!token) {
    console.error('❌ CRITICAL: TELEGRAM_BOT_TOKEN is missing.');
    process.exit(1);
  }

  const t = token.trim();

  // 2. Placeholder Check
  const placeholders = ['your_dev_bot_token_here', 'your_bot_token', 'REPLACE_ME'];
  if (placeholders.some(p => t.toLowerCase().includes(p))) {
    console.error(`❌ CRITICAL: Placeholder token detected: "${t}"`);
    console.error('💡 Action: Update .env.local with real credentials.');
    process.exit(1);
  }

  // 3. Format & Length Check
  // Telegram tokens are ID:HASH. ID is digits, Hash is alphanumeric. Total length > 35.
  const pattern = /^\d+:[A-Za-z0-9_-]+$/;
  if (t.length < 35 || !pattern.test(t)) {
    console.error(`❌ CRITICAL: Invalid token format. Value: "${t.substring(0, 10)}..."`);
    process.exit(1);
  }
}

// User ID must be a numeric string (Telegram user IDs are numeric)
const UserIdSchema = z.string().regex(/^\d+$/, {
  message: 'User ID must be a numeric string (e.g., "109284773")',
});

// User name must be non-empty
const UserNameSchema = z.string().min(1, {
  message: 'User name cannot be empty',
});

// Bot token must be non-empty
const BotTokenSchema = z.string().min(1, {
  message: 'Telegram bot token is required',
});

// API key must be non-empty
const ApiKeySchema = z.string().min(1, {
  message: 'API key is required',
});

// Database URL must be a valid URL
const DatabaseUrlSchema = z.string().url({
  message: 'Database URL must be a valid URL',
});

// Port must be a number or numeric string
const PortSchema = z.union([
  z.string().regex(/^\d+$/).transform(Number),
  z.number(),
]).pipe(z.number().int().positive());

// Environment must be one of the valid values
const NodeEnvSchema = z.enum(['development', 'production', 'staging', 'test']).default('development');

// Optional string (empty string becomes undefined)
const OptionalStringSchema = z.string().optional().or(z.literal(''));

/**
 * Main configuration schema
 */
export const ConfigSchema = z.object({
  // Required - User Configuration
  USER_A_ID: UserIdSchema,
  USER_A_NAME: UserNameSchema,
  USER_B_ID: UserIdSchema,
  USER_B_NAME: UserNameSchema,
  
  // Required - Bot Configuration
  TELEGRAM_BOT_TOKEN: BotTokenSchema,
  GEMINI_API_KEY: ApiKeySchema,
  BACKUP_RECIPIENT_ID: UserIdSchema,
  
  // Required - Database
  DATABASE_URL: DatabaseUrlSchema,
  
  // Optional - Server Configuration
  PORT: PortSchema.default(10000),
  NODE_ENV: NodeEnvSchema,
  WEBHOOK_URL: OptionalStringSchema.default(''),
  SENTRY_DSN: OptionalStringSchema.default(''),
  
  // Optional - Additional Users (comma-separated)
  ALLOWED_USER_IDS: z.string().default('').transform((val) => 
    val.split(',').map(id => id.trim()).filter(Boolean)
  ),
});

/**
 * Validated configuration type
 */
export type ValidatedConfig = z.infer<typeof ConfigSchema>;

/**
 * Validate and parse environment variables
 * 
 * @throws {z.ZodError} If validation fails
 */
export function validateConfig(env: NodeJS.ProcessEnv): ValidatedConfig {
  // Sanitize all string values (trim whitespace) before validation
  const sanitize = (val: string | undefined): string | undefined => {
    if (!val) return val;
    return val.trim();
  };

  const rawConfig = {
    USER_A_ID: sanitize(env.USER_A_ID),
    USER_A_NAME: sanitize(env.USER_A_NAME),
    USER_B_ID: sanitize(env.USER_B_ID),
    USER_B_NAME: sanitize(env.USER_B_NAME),
    TELEGRAM_BOT_TOKEN: sanitize(env.TELEGRAM_BOT_TOKEN),
    GEMINI_API_KEY: sanitize(env.GEMINI_API_KEY),
    BACKUP_RECIPIENT_ID: sanitize(env.BACKUP_RECIPIENT_ID),
    DATABASE_URL: sanitize(env.DATABASE_URL),
    PORT: env.PORT,
    NODE_ENV: env.NODE_ENV,
    WEBHOOK_URL: sanitize(env.WEBHOOK_URL),
    SENTRY_DSN: sanitize(env.SENTRY_DSN),
    ALLOWED_USER_IDS: sanitize(env.ALLOWED_USER_IDS),
  };

  try {
    return ConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues.map((issue) => 
        `  - ${issue.path.join('.')}: ${issue.message}`
      ).join('\n');
      
      console.error('❌ Configuration validation failed:\n');
      console.error(errorMessages);
      console.error('\n💡 Please check your .env.local or environment variables.');
      console.error('📖 See README.md for required environment variables.\n');
    }
    throw error;
  }
}


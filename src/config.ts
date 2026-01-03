/**
 * Configuration Module
 * 
 * Robust Environment Variable Loading:
 * 1. Explicitly loads .env.local first (highest priority)
 * 2. Falls back to .env (lower priority)
 * 3. Sanitizes all values (trims whitespace)
 * 4. Validates with strict schema
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { validateConfig, ValidatedConfig, validateTelegramToken } from './config/validator';

// 1. FORCE LOAD SEQUENCE - Additive/Override only (NO DELETE)
const envLocal = path.resolve(process.cwd(), '.env.local');
const envDefault = path.resolve(process.cwd(), '.env');

let loadedFrom: string;

if (fs.existsSync(envLocal)) {
  // .env.local exists - load it with highest priority (override existing)
  dotenv.config({ path: envLocal, override: true });
  loadedFrom = '.env.local';
  console.log('✅ [CONFIG] Loaded environment from .env.local');
  
  // DEBUG: Only show token preview in development mode
  if (process.env.NODE_ENV === 'development') {
    const rawToken = process.env.TELEGRAM_BOT_TOKEN;
    if (rawToken) {
      console.log(`🔹 [DEBUG] TELEGRAM_BOT_TOKEN (raw): ${rawToken.substring(0, 10)}...`);
    }
  }
} else if (fs.existsSync(envDefault)) {
  // .env.local doesn't exist, fall back to .env (additive, won't override existing)
  dotenv.config({ path: envDefault, override: false });
  loadedFrom = '.env';
  console.log('⚠️  [CONFIG] .env.local not found, loaded environment from .env');
} else {
  // Neither file exists - assume variables provided by Host OS/Render
  loadedFrom = 'host';
  console.log('ℹ️  [CONFIG] No .env files found, using host environment variables');
}

// 2. SANITIZATION - Remove whitespace from critical variables
const sanitize = (val: string | undefined): string | undefined => {
  if (!val) return val;
  return val.trim();
};

// Sanitize critical environment variables before validation
if (process.env.TELEGRAM_BOT_TOKEN) {
  process.env.TELEGRAM_BOT_TOKEN = sanitize(process.env.TELEGRAM_BOT_TOKEN)!;
}
if (process.env.USER_A_ID) {
  process.env.USER_A_ID = sanitize(process.env.USER_A_ID)!;
}
if (process.env.USER_B_ID) {
  process.env.USER_B_ID = sanitize(process.env.USER_B_ID)!;
}
if (process.env.BACKUP_RECIPIENT_ID) {
  process.env.BACKUP_RECIPIENT_ID = sanitize(process.env.BACKUP_RECIPIENT_ID)!;
}

// 3. TOKEN VALIDATION - Fail fast if token is invalid or placeholder
// This MUST happen before any Telegram API calls
validateTelegramToken(process.env.TELEGRAM_BOT_TOKEN);

// 4. DIAGNOSTIC OUTPUT - Verify token is loaded correctly (only if validation passed)
const token = process.env.TELEGRAM_BOT_TOKEN!; // Safe to assert non-null after validation
const tokenMasked = `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;

console.log(`[CONFIG] Active environment file: ${loadedFrom}`);
console.log(`[CONFIG] Token loaded: ${tokenMasked} (length: ${token.length})`);
if (process.env.NODE_ENV === 'development') {
  console.log(`[CONFIG] Development mode: Using DEV_BOT_TOKEN from ${loadedFrom}`);
}

// 5. VALIDATE - Now validate full config with sanitized values
const validatedConfig: ValidatedConfig = validateConfig(process.env);

// Export validated configuration
export const CONFIG = {
  TELEGRAM_TOKEN: validatedConfig.TELEGRAM_BOT_TOKEN,
  GEMINI_API_KEY: validatedConfig.GEMINI_API_KEY,
  ALLOWED_USER_IDS: validatedConfig.ALLOWED_USER_IDS,
  DATABASE_URL: validatedConfig.DATABASE_URL,
  PORT: validatedConfig.PORT,
  NODE_ENV: validatedConfig.NODE_ENV,
  WEBHOOK_URL: validatedConfig.WEBHOOK_URL,
  SENTRY_DSN: validatedConfig.SENTRY_DSN,
  BACKUP_RECIPIENT_ID: validatedConfig.BACKUP_RECIPIENT_ID,

  /**
   * Feature Flags
   * Use these to toggle experimental or clashing features.
   * To enable a feature, add the corresponding environment variable to your .env file:
   * e.g., ENABLE_XYZ_FEATURE=true
   */
  FEATURE_FLAGS: {
    // Add new flags here:
    // ENABLE_XYZ_FEATURE: process.env.ENABLE_XYZ_FEATURE === 'true',
  },
};

// User Configuration - From validated config (NO DEFAULTS - fails fast if missing)
export const USER_A_ID: string = validatedConfig.USER_A_ID;
export const USER_B_ID: string = validatedConfig.USER_B_ID;
export const USER_A_NAME: string = validatedConfig.USER_A_NAME;
export const USER_B_NAME: string = validatedConfig.USER_B_NAME;

// Internal Database Role Constants (unchanged - these are database schema values)
export const USER_A_ROLE_KEY = 'Bryan';
export const USER_B_ROLE_KEY = 'HweiYeen';

// Legacy exports for backward compatibility (deprecated - use helper functions instead)
export const USER_IDS = {
  BRYAN: USER_A_ID,
  HWEI_YEEN: USER_B_ID,
};

// Legacy USER_NAMES mapping (deprecated - use helper functions instead)
export const USER_NAMES: { [key: string]: string } = {
  [USER_A_ID]: USER_A_NAME,
  [USER_B_ID]: USER_B_NAME,
};

// BOT_USERS array for database initialization
export const BOT_USERS = [
  { id: BigInt(USER_A_ID), name: USER_A_NAME, role: USER_A_ROLE_KEY },
  { id: BigInt(USER_B_ID), name: USER_B_NAME, role: USER_B_ROLE_KEY },
];

// Helper Functions

/**
 * Get User A's Telegram ID
 */
export function getUserAId(): string {
  return USER_A_ID;
}

/**
 * Get User B's Telegram ID
 */
export function getUserBId(): string {
  return USER_B_ID;
}

/**
 * Get User A's display name
 */
export function getUserAName(): string {
  return USER_A_NAME;
}

/**
 * Get User B's display name
 */
export function getUserBName(): string {
  return USER_B_NAME;
}

/**
 * Get Telegram ID by database role
 * @param role - Database role ('Bryan' or 'HweiYeen')
 * @returns Telegram user ID as string
 */
export function getUserIdByRole(role: 'Bryan' | 'HweiYeen'): string {
  if (role === USER_A_ROLE_KEY) {
    return USER_A_ID;
  }
  if (role === USER_B_ROLE_KEY) {
    return USER_B_ID;
  }
  throw new Error(`Unknown role: ${role}`);
}

/**
 * Get display name by database role
 * @param role - Database role ('Bryan' or 'HweiYeen')
 * @returns Display name as string
 */
export function getUserNameByRole(role: 'Bryan' | 'HweiYeen'): string {
  if (role === USER_A_ROLE_KEY) {
    return USER_A_NAME;
  }
  if (role === USER_B_ROLE_KEY) {
    return USER_B_NAME;
  }
  throw new Error(`Unknown role: ${role}`);
}

/**
 * Get all authorized user IDs as an array
 * @returns Array of authorized Telegram user IDs (as normalized strings)
 */
export function getAllowedUserIds(): string[] {
  return [USER_A_ID, USER_B_ID];
}

/**
 * Get all authorized user IDs including ALLOWED_USER_IDS
 * @returns Array of all authorized Telegram user IDs (as normalized strings)
 */
export function getAuthorizedUsers(): string[] {
  return [USER_A_ID, USER_B_ID, ...CONFIG.ALLOWED_USER_IDS].filter(Boolean);
}

/**
 * Check if a user ID is authorized
 * 
 * Type-safe: Normalizes input to string for consistent comparison.
 * Handles both string and number inputs (Telegram sends numbers).
 * 
 * @param userId - Telegram user ID to check (string or number)
 * @returns true if authorized, false otherwise
 */
export function isAuthorizedUserId(userId: string | number): boolean {
  // Normalize to string for consistent comparison
  // This handles both string ("109284773") and number (109284773) inputs
  const normalizedUserId = String(userId);
  
  // Check primary users (USER_A_ID and USER_B_ID)
  if (normalizedUserId === USER_A_ID || normalizedUserId === USER_B_ID) {
    return true;
  }
  
  // Also check ALLOWED_USER_IDS (useful for testing/admin access)
  if (CONFIG.ALLOWED_USER_IDS.length > 0 && CONFIG.ALLOWED_USER_IDS.includes(normalizedUserId)) {
    return true;
  }
  
  return false;
}

/**
 * Get display name by user ID
 * @param userId - Telegram user ID
 * @returns Display name or 'Unknown' if not found
 */
export function getNameByUserId(userId: string): string {
  if (userId === USER_A_ID) {
    return USER_A_NAME;
  }
  if (userId === USER_B_ID) {
    return USER_B_NAME;
  }
  return 'Unknown';
}

/**
 * Safety guard: Prevents dangerous operations in production
 * @param operationName - Description of the operation being blocked
 * @throws Error if NODE_ENV is 'production'
 */
export function ensureNotProduction(operationName: string): void {
  if (CONFIG.NODE_ENV === 'production') {
    throw new Error(
      `🚨 SAFETY BLOCKED: ${operationName} is not allowed in production environment.\n` +
      `This protects live user data. Use local development environment (NODE_ENV=development) for testing.\n` +
      `Current NODE_ENV: ${CONFIG.NODE_ENV}`
    );
  }
}

// --- DEBUG: CONFIG VERIFICATION ---
console.log('🔍 [CONFIG DIAGNOSTIC] Configuration loaded and validated');
console.log(`✅ USER_A_NAME (Resolved): "${getUserAName()}"`);
console.log(`✅ USER_B_NAME (Resolved): "${getUserBName()}"`);
console.log(`✅ USER_A_ID (Resolved): "${getUserAId()}"`);
console.log(`✅ USER_B_ID (Resolved): "${getUserBId()}"`);
console.log(`✅ BACKUP_RECIPIENT_ID: "${CONFIG.BACKUP_RECIPIENT_ID}"`);
console.log(`✅ Token verified: ${tokenMasked}`);
// ----------------------------------


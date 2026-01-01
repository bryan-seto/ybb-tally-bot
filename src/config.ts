import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  ALLOWED_USER_IDS: (process.env.ALLOWED_USER_IDS || '').split(',').map(id => id.trim()),
  DATABASE_URL: process.env.DATABASE_URL || '',
  PORT: process.env.PORT || 10000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',
  SENTRY_DSN: process.env.SENTRY_DSN || '',

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

// User Configuration - Environment Variables with defaults for backward compatibility
export const USER_A_ID = process.env.USER_A_ID || '109284773';
export const USER_B_ID = process.env.USER_B_ID || '424894363';
export const USER_A_NAME = process.env.USER_A_NAME || 'Bryan';
export const USER_B_NAME = process.env.USER_B_NAME || 'Hwei Yeen';

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
 * @returns Array of authorized Telegram user IDs
 */
export function getAllowedUserIds(): string[] {
  return [USER_A_ID, USER_B_ID];
}

/**
 * Check if a user ID is authorized
 * @param userId - Telegram user ID to check
 * @returns true if authorized, false otherwise
 */
export function isAuthorizedUserId(userId: string): boolean {
  return userId === USER_A_ID || userId === USER_B_ID;
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


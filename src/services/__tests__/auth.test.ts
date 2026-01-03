import { describe, test, expect, beforeEach, vi } from 'vitest';

// Set up environment variables before importing config
beforeEach(() => {
  process.env.USER_A_ID = '109284773';
  process.env.USER_B_ID = '424894363';
  process.env.USER_A_NAME = 'Bryan';
  process.env.USER_B_NAME = 'Hwei Yeen';
  process.env.ALLOWED_USER_IDS = '';
  process.env.BACKUP_RECIPIENT_ID = '109284773';
  process.env.TELEGRAM_BOT_TOKEN = 'test_token_123456:ABC-DEF';
  process.env.GEMINI_API_KEY = 'test_key_12345';
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
  process.env.NODE_ENV = 'test';
});

describe('Authorization Logic', () => {
  // Import after setting env vars
  let isAuthorizedUserId: (userId: string | number) => boolean;
  let getAllowedUserIds: () => string[];

  beforeEach(async () => {
    // Clear module cache to force reload with new env vars
    vi.resetModules();
    const config = await import('../../config');
    isAuthorizedUserId = config.isAuthorizedUserId;
    getAllowedUserIds = config.getAllowedUserIds;
  });

  describe('isAuthorizedUserId - Type Safety', () => {
    test('returns true for valid user ID as string', () => {
      expect(isAuthorizedUserId('109284773')).toBe(true);
    });

    test('returns true for valid user ID as number', () => {
      // Telegram sends user IDs as numbers, so we need to handle this
      expect(isAuthorizedUserId(109284773)).toBe(true);
    });

    test('returns true for second valid user ID as string', () => {
      expect(isAuthorizedUserId('424894363')).toBe(true);
    });

    test('returns true for second valid user ID as number', () => {
      expect(isAuthorizedUserId(424894363)).toBe(true);
    });

    test('returns false for unauthorized ID as string', () => {
      expect(isAuthorizedUserId('999999999')).toBe(false);
    });

    test('returns false for unauthorized ID as number', () => {
      expect(isAuthorizedUserId(999999999)).toBe(false);
    });

    test('normalizes string and number inputs correctly', () => {
      // Both should work the same way
      expect(isAuthorizedUserId('109284773')).toBe(isAuthorizedUserId(109284773));
      expect(isAuthorizedUserId('424894363')).toBe(isAuthorizedUserId(424894363));
    });
  });

  describe('getAllowedUserIds', () => {
    test('returns array of authorized user IDs as strings', () => {
      const ids = getAllowedUserIds();
      expect(ids).toContain('109284773');
      expect(ids).toContain('424894363');
      expect(ids.every(id => typeof id === 'string')).toBe(true);
    });
  });
});


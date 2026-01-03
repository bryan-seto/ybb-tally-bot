import { describe, test, expect } from 'vitest';
import { ConfigSchema, validateConfig } from '../validator';

describe('Config Validator', () => {
  describe('ConfigSchema', () => {
    test('validates correct configuration', () => {
      const validConfig = {
        USER_A_ID: '109284773',
        USER_A_NAME: 'Bryan',
        USER_B_ID: '424894363',
        USER_B_NAME: 'Hwei Yeen',
        TELEGRAM_BOT_TOKEN: '123456:ABC-DEF',
        GEMINI_API_KEY: 'test_key',
        BACKUP_RECIPIENT_ID: '109284773',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        PORT: '10000',
        NODE_ENV: 'development',
      };

      const result = ConfigSchema.parse(validConfig);
      expect(result.USER_A_ID).toBe('109284773');
      expect(result.USER_B_ID).toBe('424894363');
      expect(result.PORT).toBe(10000);
    });

    test('throws error if USER_A_ID is missing', () => {
      const invalidConfig = {
        USER_B_ID: '424894363',
        USER_B_NAME: 'Hwei Yeen',
        TELEGRAM_BOT_TOKEN: 'token',
        GEMINI_API_KEY: 'key',
        BACKUP_RECIPIENT_ID: '109284773',
        DATABASE_URL: 'postgresql://localhost/db',
      };

      expect(() => ConfigSchema.parse(invalidConfig)).toThrow();
    });

    test('throws error if USER_A_ID is not numeric', () => {
      const invalidConfig = {
        USER_A_ID: 'invalid',
        USER_A_NAME: 'Bryan',
        USER_B_ID: '424894363',
        USER_B_NAME: 'Hwei Yeen',
        TELEGRAM_BOT_TOKEN: 'token',
        GEMINI_API_KEY: 'key',
        BACKUP_RECIPIENT_ID: '109284773',
        DATABASE_URL: 'postgresql://localhost/db',
      };

      expect(() => ConfigSchema.parse(invalidConfig)).toThrow(/numeric string/);
    });

    test('throws error if USER_A_NAME is empty', () => {
      const invalidConfig = {
        USER_A_ID: '109284773',
        USER_A_NAME: '',
        USER_B_ID: '424894363',
        USER_B_NAME: 'Hwei Yeen',
        TELEGRAM_BOT_TOKEN: 'token',
        GEMINI_API_KEY: 'key',
        BACKUP_RECIPIENT_ID: '109284773',
        DATABASE_URL: 'postgresql://localhost/db',
      };

      expect(() => ConfigSchema.parse(invalidConfig)).toThrow(/cannot be empty/);
    });

    test('throws error if TELEGRAM_BOT_TOKEN is missing', () => {
      const invalidConfig = {
        USER_A_ID: '109284773',
        USER_A_NAME: 'Bryan',
        USER_B_ID: '424894363',
        USER_B_NAME: 'Hwei Yeen',
        GEMINI_API_KEY: 'key',
        BACKUP_RECIPIENT_ID: '109284773',
        DATABASE_URL: 'postgresql://localhost/db',
      };

      expect(() => ConfigSchema.parse(invalidConfig)).toThrow();
    });

    test('throws error if DATABASE_URL is invalid', () => {
      const invalidConfig = {
        USER_A_ID: '109284773',
        USER_A_NAME: 'Bryan',
        USER_B_ID: '424894363',
        USER_B_NAME: 'Hwei Yeen',
        TELEGRAM_BOT_TOKEN: 'token',
        GEMINI_API_KEY: 'key',
        BACKUP_RECIPIENT_ID: '109284773',
        DATABASE_URL: 'not-a-url',
      };

      expect(() => ConfigSchema.parse(invalidConfig)).toThrow(/valid URL/);
    });

    test('parses ALLOWED_USER_IDS correctly', () => {
      const config = {
        USER_A_ID: '109284773',
        USER_A_NAME: 'Bryan',
        USER_B_ID: '424894363',
        USER_B_NAME: 'Hwei Yeen',
        TELEGRAM_BOT_TOKEN: 'token',
        GEMINI_API_KEY: 'key',
        BACKUP_RECIPIENT_ID: '109284773',
        DATABASE_URL: 'postgresql://localhost/db',
        ALLOWED_USER_IDS: '123,456,789',
      };

      const result = ConfigSchema.parse(config);
      expect(result.ALLOWED_USER_IDS).toEqual(['123', '456', '789']);
    });

    test('defaults ALLOWED_USER_IDS to empty array', () => {
      const config = {
        USER_A_ID: '109284773',
        USER_A_NAME: 'Bryan',
        USER_B_ID: '424894363',
        USER_B_NAME: 'Hwei Yeen',
        TELEGRAM_BOT_TOKEN: 'token',
        GEMINI_API_KEY: 'key',
        BACKUP_RECIPIENT_ID: '109284773',
        DATABASE_URL: 'postgresql://localhost/db',
      };

      const result = ConfigSchema.parse(config);
      expect(result.ALLOWED_USER_IDS).toEqual([]);
    });
  });

  describe('validateConfig', () => {
    test('validates process.env correctly', () => {
      const mockEnv = {
        USER_A_ID: '109284773',
        USER_A_NAME: 'Bryan',
        USER_B_ID: '424894363',
        USER_B_NAME: 'Hwei Yeen',
        TELEGRAM_BOT_TOKEN: 'token',
        GEMINI_API_KEY: 'key',
        BACKUP_RECIPIENT_ID: '109284773',
        DATABASE_URL: 'postgresql://localhost/db',
        NODE_ENV: 'development',
      };

      const result = validateConfig(mockEnv as NodeJS.ProcessEnv);
      expect(result.USER_A_ID).toBe('109284773');
    });

    test('throws descriptive error on validation failure', () => {
      const mockEnv = {
        // Missing USER_A_ID
        USER_B_ID: '424894363',
        USER_B_NAME: 'Hwei Yeen',
      };

      expect(() => validateConfig(mockEnv as NodeJS.ProcessEnv)).toThrow();
    });
  });
});


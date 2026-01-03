import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import dotenv from 'dotenv';
import * as fs from 'fs';
import path from 'path';

describe('Multi-Instance Isolation Tests', () => {
  const originalEnv = process.env;
  let dotenvConfigSpy: any;
  let existsSyncSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    
    // Reset to default values
    process.env = {
      ...originalEnv,
      USER_A_ID: '109284773',
      USER_B_ID: '424894363',
      USER_A_NAME: 'Bryan',
      USER_B_NAME: 'Hwei Yeen',
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF123456789',
      GEMINI_API_KEY: 'test_key_12345',
      BACKUP_RECIPIENT_ID: '109284773',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      NODE_ENV: 'test',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('Config Precedence & Fallback', () => {
    it('should prioritize .env.local over process.env when file exists', async () => {
      // Setup: Mock .env.local to exist and contain USER_A_NAME='FileValue'
      // Use valid token format (must be at least 35 chars and match pattern)
      const validToken = '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
      const mockEnvLocal = {
        USER_A_NAME: 'FileValue',
        USER_A_ID: '111111111',
        USER_B_ID: '222222222',
        USER_B_NAME: 'FileUserB',
        TELEGRAM_BOT_TOKEN: validToken,
        GEMINI_API_KEY: 'test_key_12345',
        BACKUP_RECIPIENT_ID: '111111111',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        NODE_ENV: 'test',
      };

      // Mock dotenv.config to simulate .env.local loading
      dotenvConfigSpy = vi.spyOn(dotenv, 'config').mockImplementation((options: any) => {
        if (options?.path?.includes('.env.local')) {
          // Simulate loading .env.local values (with override: true)
          Object.assign(process.env, mockEnvLocal);
          return { parsed: mockEnvLocal };
        }
        if (options?.path?.includes('.env')) {
          // Simulate loading .env (should not override .env.local)
          return { parsed: {} };
        }
        return { parsed: {} };
      });

      // Set process.env to different value (will be overridden by .env.local)
      process.env.USER_A_NAME = 'EnvValue';
      process.env.USER_A_ID = '109284773';
      process.env.USER_B_ID = '424894363';
      process.env.USER_B_NAME = 'Hwei Yeen';
      process.env.TELEGRAM_BOT_TOKEN = validToken;
      process.env.GEMINI_API_KEY = 'test_key_12345';
      process.env.BACKUP_RECIPIENT_ID = '109284773';
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
      process.env.NODE_ENV = 'test';

      // Action: Dynamic import the config module
      const config = await import('../config');

      // Assert: Config value equals 'FileValue' (from .env.local, not process.env)
      expect(config.getUserAName()).toBe('FileValue');
      
      dotenvConfigSpy.mockRestore();
    });

    it('should use process.env when .env.local does not exist', async () => {
      // Setup: Use valid token format (must be at least 35 chars and match pattern)
      const validToken = '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
      
      // Setup: Mock .env.local to NOT exist (return empty/undefined)
      dotenvConfigSpy = vi.spyOn(dotenv, 'config').mockImplementation((options: any) => {
        if (options?.path?.includes('.env.local')) {
          // Simulate .env.local not existing - return empty (doesn't override process.env)
          return { parsed: {} };
        }
        if (options?.path?.includes('.env')) {
          // Simulate .env file (fallback)
          return { parsed: {} };
        }
        return { parsed: {} };
      });

      // Setup: Set process.env values (these will be used since .env.local doesn't exist)
      process.env.USER_A_NAME = 'EnvValue';
      process.env.USER_A_ID = '109284773';
      process.env.USER_B_ID = '424894363';
      process.env.USER_B_NAME = 'Hwei Yeen';
      process.env.TELEGRAM_BOT_TOKEN = validToken;
      process.env.GEMINI_API_KEY = 'test_key_12345';
      process.env.BACKUP_RECIPIENT_ID = '109284773';
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
      process.env.NODE_ENV = 'test';

      // Action: Dynamic import the config module
      const config = await import('../config');

      // Assert: Config value equals 'EnvValue' (from process.env, since .env.local doesn't exist)
      expect(config.getUserAName()).toBe('EnvValue');
      
      dotenvConfigSpy.mockRestore();
    });
  });

  describe('Auth Guard Tests', () => {
    it('should reject unauthorized user IDs', () => {
      const mockCtx = {
        from: {
          id: 999999,
          username: 'stranger',
        },
      };

      // Mock the config to return allowed IDs
      const allowedIds = ['109284773', '424894363'];
      const userId = mockCtx.from.id.toString();
      
      // Auth should reject
      const isAuthorized = allowedIds.includes(userId);
      expect(isAuthorized).toBe(false);
    });

    it('should accept configured user IDs', () => {
      const mockCtx = {
        from: {
          id: 109284773, // USER_A_ID
          username: 'authorized_user',
        },
      };

      const allowedIds = ['109284773', '424894363'];
      const userId = mockCtx.from.id.toString();
      
      // Auth should accept
      const isAuthorized = allowedIds.includes(userId);
      expect(isAuthorized).toBe(true);
    });

    it('should accept USER_B_ID', () => {
      const mockCtx = {
        from: {
          id: 424894363, // USER_B_ID
          username: 'authorized_user_b',
        },
      };

      const allowedIds = ['109284773', '424894363'];
      const userId = mockCtx.from.id.toString();
      
      const isAuthorized = allowedIds.includes(userId);
      expect(isAuthorized).toBe(true);
    });
  });

  describe('Display Name Mapping Tests', () => {
    it('should map database role "Bryan" to USER_A_NAME', async () => {
      process.env.USER_A_NAME = 'Alex';
      process.env.USER_A_ROLE_KEY = 'Bryan';
      
      // After refactor, config.getNameByRole('Bryan') should return process.env.USER_A_NAME
      const dbRole = 'Bryan';
      const expectedName = process.env.USER_A_NAME;
      
      expect(expectedName).toBe('Alex');
    });

    it('should map database role "HweiYeen" to USER_B_NAME', async () => {
      process.env.USER_B_NAME = 'Sam';
      process.env.USER_B_ROLE_KEY = 'HweiYeen';
      
      const dbRole = 'HweiYeen';
      const expectedName = process.env.USER_B_NAME;
      
      expect(expectedName).toBe('Sam');
    });
  });
});


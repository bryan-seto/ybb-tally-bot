import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Mock fs and dotenv to prevent reading actual files or polluting env
vi.mock('fs');
vi.mock('dotenv');

describe('Config Loading Strategy', () => {
  // Save original env to restore after tests
  const originalEnv = process.env;
  let dotenvConfigSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules(); // CRITICAL: Forces config.ts to re-run top-level code
    
    // Set minimal valid config for validation to pass
    process.env = {
      ...originalEnv,
      USER_A_ID: '109284773',
      USER_B_ID: '424894363',
      USER_A_NAME: 'Bryan',
      USER_B_NAME: 'Hwei Yeen',
      TELEGRAM_BOT_TOKEN: '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      GEMINI_API_KEY: 'test_key_12345',
      BACKUP_RECIPIENT_ID: '109284773',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      NODE_ENV: 'test',
    };
    
    vi.clearAllMocks(); // Clear call history
    
    // Mock dotenv.config to track calls
    dotenvConfigSpy = vi.spyOn(dotenv, 'config').mockReturnValue({ parsed: {} });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  test('Priority 1: Loads .env.local with override: true', async () => {
    // Setup: .env.local exists
    vi.spyOn(fs, 'existsSync').mockImplementation((filePath: string) => {
      return filePath.endsWith('.env.local');
    });

    // Execute
    await import('../config');

    // Assert
    expect(dotenvConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining('.env.local'),
        override: true, // CRITICAL CHECK
      })
    );
  });

  test('Priority 2: Falls back to .env with override: false if local missing', async () => {
    // Setup: .env.local MISSING, .env EXISTS
    vi.spyOn(fs, 'existsSync').mockImplementation((filePath: string) => {
      if (filePath.endsWith('.env.local')) return false;
      if (filePath.endsWith('.env')) return true;
      return false;
    });

    // Execute
    await import('../config');

    // Assert
    expect(dotenvConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining('.env'),
        override: false, // CRITICAL CHECK: Must be additive only
      })
    );
  });

  test('Priority 3: Uses Host variables if no files exist', async () => {
    // Setup: No files exist
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    // Execute
    await import('../config');

    // Assert
    expect(dotenvConfigSpy).not.toHaveBeenCalled(); // Should rely on Render/Host
  });

  test('Security: Debug logs only appear in Development mode', async () => {
    // Setup
    process.env.NODE_ENV = 'development';
    process.env.TELEGRAM_BOT_TOKEN = '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
    vi.spyOn(fs, 'existsSync').mockReturnValue(true); // Force load path
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Execute
    await import('../config');

    // Assert
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[DEBUG]')
    );

    consoleSpy.mockRestore();
  });

  test('Security: Debug logs are SILENT in Production', async () => {
    // Setup
    process.env.NODE_ENV = 'production';
    process.env.TELEGRAM_BOT_TOKEN = '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Execute
    await import('../config');

    // Assert
    const debugCalls = consoleSpy.mock.calls.filter((call) =>
      call[0]?.toString().includes('[DEBUG]')
    );
    expect(debugCalls).toHaveLength(0); // No debug logs in production

    consoleSpy.mockRestore();
  });
});


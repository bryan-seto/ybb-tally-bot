import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../lib/prisma';

// Mock Prisma
vi.mock('../lib/prisma', () => ({
  prisma: {
    $connect: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

// Mock CONFIG to control DATABASE_URL dynamically
vi.mock('../config', () => {
  return {
    CONFIG: {
      get DATABASE_URL() {
        return process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/ybb_tally_bot';
      },
    },
  };
});

describe('Startup Guardrails - Database Pre-Flight Check', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  const originalEnv = process.env;

  beforeEach(() => {
    // Set up spies fresh for each test
    mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      // Throw error to intercept execution flow without killing test runner
      throw new Error(`Process.exit called with code ${code}`);
    });
    
    // Spy on console (don't mock completely, just track calls)
    mockConsoleError = vi.spyOn(console, 'error');
    mockConsoleLog = vi.spyOn(console, 'log');
    
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';
    // Default to localhost for testing the check logic
    process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5432/ybb_tally_bot';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  test('CRITICAL: Process exits if local database connection fails', async () => {
    // Import the function from the utility file
    const { verifyDatabaseConnection } = await import('../utils/databaseVerification');
    
    // Setup: Simulate connection failure
    const dbError = new Error('Connection refused');
    vi.mocked(prisma.$connect).mockRejectedValueOnce(dbError);

    // Execute & Expect Exit
    await expect(verifyDatabaseConnection()).rejects.toThrow('Process.exit called with code 1');

    // Assertions
    expect(prisma.$connect).toHaveBeenCalled();
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('LOCAL DB NOT RUNNING')
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('Success: Proceeds if local database connects', async () => {
    // Import the function from the utility file
    const { verifyDatabaseConnection } = await import('../utils/databaseVerification');
    
    // Setup: Simulate successful connection
    vi.mocked(prisma.$connect).mockResolvedValueOnce(undefined);
    // Simulate simple query success
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ '?column?': 1 }]);

    // Execute
    await verifyDatabaseConnection();

    // Assertions
    expect(prisma.$connect).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
    // Check that console.log was called (we spy on it, not mock it completely)
    const logCalls = mockConsoleLog.mock.calls.map(call => call[0]?.toString() || '');
    expect(logCalls.some(msg => msg.includes('Local database connection verified'))).toBe(true);
    expect(mockExit).not.toHaveBeenCalled();
  });

  test('Skip: Does not check remote databases', async () => {
    // Setup: Remote database URL
    const originalDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://user:pass@db.supabase.co:5432/db';
    
    // Reset modules to reload CONFIG with new DATABASE_URL
    vi.resetModules();
    
    // Re-mock CONFIG with the new URL (must be done before import)
    vi.doMock('../config', () => ({
      CONFIG: {
        DATABASE_URL: 'postgresql://user:pass@db.supabase.co:5432/db',
      },
    }));
    
    const { verifyDatabaseConnection } = await import('../utils/databaseVerification');

    // Execute
    await verifyDatabaseConnection();

    // Assertions
    // Should NOT try to connect or query
    expect(prisma.$connect).not.toHaveBeenCalled();
    const logCalls = mockConsoleLog.mock.calls.map(call => call[0]?.toString() || '');
    // Debug: show what was actually logged
    if (!logCalls.some(msg => msg.includes('Using remote database'))) {
      console.log('Actual log calls:', logCalls);
    }
    expect(logCalls.some(msg => msg.includes('Using remote database') || msg.includes('remote database'))).toBe(true);
    
    // Restore
    process.env.DATABASE_URL = originalDbUrl;
  });
});


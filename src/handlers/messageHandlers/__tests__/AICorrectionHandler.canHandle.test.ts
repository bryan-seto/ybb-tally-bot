import { describe, it, expect, vi } from 'vitest';

// Mock transitive imports that call process.exit() at module load time.
// AICorrectionHandler -> CorrectionActionExecutor -> config.ts (exits on missing token)
// AICorrectionHandler -> prisma (DB connection at import time)
vi.mock('../../../config', () => ({
  USER_A_ROLE_KEY: 'user_a',
  USER_B_ROLE_KEY: 'user_b',
  config: {
    TELEGRAM_BOT_TOKEN: 'fake_token_for_tests',
    USER_A_ID: '111',
    USER_A_NAME: 'Bryan',
    USER_B_ID: '222',
    USER_B_NAME: 'HY',
    GEMINI_API_KEY: 'fake_gemini_key',
    BACKUP_RECIPIENT_ID: '333',
    DATABASE_URL: 'postgresql://localhost/testdb',
  },
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: {},
}));

import { AICorrectionHandler } from '../AICorrectionHandler';

function makeHandler(botUsername?: string): AICorrectionHandler {
  const stub = {} as any;
  return new AICorrectionHandler(
    stub, // expenseService
    stub, // aiService
    stub, // historyService
    stub, // sessionManager
    botUsername ? () => botUsername : undefined,
  );
}

describe('AICorrectionHandler.canHandle()', () => {
  const session = {};

  // Acceptance criteria ---------------------------------------------------

  it('ignores a message that mentions another user but not the bot', () => {
    const handler = makeHandler('YBBTally_Bot');
    // Use a generic other-user handle (not the bot) to confirm the guard works
    expect(handler.canHandle('@OtherUser hey lets eat', session)).toBe(false);
  });

  it('fires when the bot is tagged at the start of the message', () => {
    const handler = makeHandler('YBBTally_Bot');
    expect(handler.canHandle('@YBBTally_Bot split pad thai 50-50', session)).toBe(true);
  });

  it('fires when the bot is tagged anywhere in the message (not just start)', () => {
    const handler = makeHandler('YBBTally_Bot');
    expect(handler.canHandle('hey @YBBTally_Bot split venchi 50-50', session)).toBe(true);
  });

  // Edge cases ------------------------------------------------------------

  it('returns false when no getBotUsername getter is injected', () => {
    const handler = makeHandler(undefined);
    expect(handler.canHandle('@YBBTally_Bot split something', session)).toBe(false);
  });

  it('returns false for empty text', () => {
    const handler = makeHandler('YBBTally_Bot');
    expect(handler.canHandle('', session)).toBe(false);
  });

  it('returns false for a plain message with no @ at all', () => {
    const handler = makeHandler('YBBTally_Bot');
    expect(handler.canHandle('split pad thai 50-50', session)).toBe(false);
  });

  it('returns false when only a partial username prefix appears', () => {
    const handler = makeHandler('YBBTally_Bot');
    expect(handler.canHandle('@YBBTally', session)).toBe(false);
  });

  it('is case-sensitive — lowercase tag does not match the canonical username', () => {
    const handler = makeHandler('YBBTally_Bot');
    expect(handler.canHandle('@ybbtally_bot split tea 50-50', session)).toBe(false);
  });
});

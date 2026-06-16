/**
 * Tests for assertWebhook (webhook watchdog utility).
 *
 * Pure-function tests — no Prisma, no Telegram token, no config import.
 * Uses dependency injection to avoid the config.ts import-time trap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config BEFORE importing jobs — jobs.ts imports CONFIG which triggers config.ts
// validation at module load time (process.exit if token missing). Mock it out.
vi.mock('../config', () => ({
  CONFIG: {
    NODE_ENV: 'production',
    WEBHOOK_URL: 'https://ybb-tally-bot-production.up.railway.app',
    TELEGRAM_TOKEN: '123456789:test_token_for_tests_only_xxxxxxxxxxxxx',
    BACKUP_RECIPIENT_ID: '109284773',
  },
  USER_NAMES: {},
  USER_IDS: {},
  BOT_USERS: [],
  getAllowedUserIds: () => [],
  isAuthorizedUserId: () => false,
  getUserIdByRole: () => BigInt(0),
  getNameByUserId: () => 'Unknown',
  getUserNameByRole: () => 'Unknown',
}));

// Also mock transportMode so we don't need real env
vi.mock('../utils/transportMode', () => ({
  shouldUseWebhook: () => true,
}));

import { assertWebhook } from '../jobs';

describe('assertWebhook', () => {
  const CORRECT_URL = 'https://ybb-tally-bot-production.up.railway.app/webhook';
  const STALE_URL = 'https://ybb-tally-bot.onrender.com/webhook';

  function makeTelegram(currentUrl: string | undefined) {
    return {
      getWebhookInfo: vi.fn().mockResolvedValue({ url: currentUrl }),
      setWebhook: vi.fn().mockResolvedValue(true),
    };
  }

  it('returns corrected=false when webhook is already correct', async () => {
    const telegram = makeTelegram(CORRECT_URL);

    const result = await assertWebhook(
      () => telegram,
      () => CORRECT_URL,
    );

    expect(result.corrected).toBe(false);
    expect(result.was).toBe(CORRECT_URL);
    expect(result.now).toBe(CORRECT_URL);
    expect(telegram.setWebhook).not.toHaveBeenCalled();
  });

  it('corrects a stale webhook and returns corrected=true', async () => {
    const telegram = makeTelegram(STALE_URL);

    const result = await assertWebhook(
      () => telegram,
      () => CORRECT_URL,
    );

    expect(result.corrected).toBe(true);
    expect(result.was).toBe(STALE_URL);
    expect(result.now).toBe(CORRECT_URL);
    expect(telegram.setWebhook).toHaveBeenCalledOnce();
    expect(telegram.setWebhook).toHaveBeenCalledWith(CORRECT_URL, { drop_pending_updates: false });
  });

  it('handles undefined url (no webhook set) by setting the correct one', async () => {
    const telegram = makeTelegram(undefined);

    const result = await assertWebhook(
      () => telegram,
      () => CORRECT_URL,
    );

    expect(result.corrected).toBe(true);
    expect(result.was).toBe('');
    expect(result.now).toBe(CORRECT_URL);
    expect(telegram.setWebhook).toHaveBeenCalledOnce();
  });

  it('propagates errors from getWebhookInfo', async () => {
    const telegram = {
      getWebhookInfo: vi.fn().mockRejectedValue(new Error('Telegram API down')),
      setWebhook: vi.fn(),
    };

    await expect(
      assertWebhook(
        () => telegram,
        () => CORRECT_URL,
      ),
    ).rejects.toThrow('Telegram API down');

    expect(telegram.setWebhook).not.toHaveBeenCalled();
  });

  it('propagates errors from setWebhook', async () => {
    const telegram = {
      getWebhookInfo: vi.fn().mockResolvedValue({ url: STALE_URL }),
      setWebhook: vi.fn().mockRejectedValue(new Error('Rate limited')),
    };

    await expect(
      assertWebhook(
        () => telegram,
        () => CORRECT_URL,
      ),
    ).rejects.toThrow('Rate limited');
  });
});

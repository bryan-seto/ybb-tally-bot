import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Telegraf } from 'telegraf';
import { YBBTallyBot } from '../bot';
import { prisma } from '../lib/prisma';
import * as Sentry from '@sentry/node';
import { USER_IDS } from '../config';

const mockTelegrafInstance = {
  use: vi.fn(),
  command: vi.fn(),
  on: vi.fn(),
  catch: vi.fn(),
  telegram: {
    setMyCommands: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({}),
  },
  launch: vi.fn().mockResolvedValue({}),
};

// Mock dependencies
vi.mock('telegraf', () => {
  return {
    Telegraf: vi.fn().mockImplementation(function() {
      return mockTelegrafInstance;
    }),
    session: vi.fn(() => (ctx: any, next: any) => next()),
    Markup: {
      inlineKeyboard: vi.fn(() => ({})),
      keyboard: vi.fn(() => ({ resize: vi.fn() })),
      button: {
        callback: vi.fn(),
      },
    },
  };
});

vi.mock('../lib/prisma', () => ({
  prisma: {
    settings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    systemLog: {
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  withScope: vi.fn((callback) => callback({ setTag: vi.fn(), setContext: vi.fn(), setUser: vi.fn() })),
  captureException: vi.fn(),
}));

vi.mock('../services/ai');
vi.mock('../services/analyticsService');
vi.mock('../services/expenseService');
vi.mock('../services/historyService');
vi.mock('../services/backupService');

describe('Safety System - Global Error Handler', () => {
  let bot: YBBTallyBot;

  beforeEach(() => {
    vi.clearAllMocks();
    bot = new YBBTallyBot('token', 'key', '123');
  });

  it('should capture exception in Sentry and notify founder on error', async () => {
    // Get the catch handler
    const catchHandler = mockTelegrafInstance.catch.mock.calls[0][0];
    
    const mockError = new Error('Test crash');
    const mockCtx = {
      updateType: 'message',
      update: {},
      from: { id: 123, first_name: 'TestUser', username: 'testuser' },
      chat: { type: 'group', title: 'Test Group', id: -1001 },
      reply: vi.fn().mockResolvedValue({}),
    };

    await catchHandler(mockError, mockCtx);

    // 1. Verify Sentry
    expect(Sentry.captureException).toHaveBeenCalledWith(mockError);

    // 2. Verify Founder Notification
    expect(mockTelegrafInstance.telegram.sendMessage).toHaveBeenCalledWith(
      USER_IDS.BRYAN,
      expect.stringContaining('BOT ERROR ALERT'),
      expect.objectContaining({ parse_mode: 'HTML' })
    );

    // 3. Verify User Apology
    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Temporary Glitch'),
      expect.objectContaining({ parse_mode: 'HTML' })
    );

    // 4. Verify Group registration for fix
    expect(prisma.settings.findUnique).toHaveBeenCalledWith({ where: { key: 'broken_groups' } });
    expect(prisma.settings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'broken_groups' },
      create: { key: 'broken_groups', value: '-1001' }
    }));
  });
});

describe('Safety System - /fixed Broadcast Command', () => {
  let bot: YBBTallyBot;

  beforeEach(() => {
    vi.clearAllMocks();
    bot = new YBBTallyBot('token', 'key', '123');
  });

  it('should only allow founder to trigger /fixed', async () => {
    // Find the /fixed command handler
    const fixedCall = mockTelegrafInstance.command.mock.calls.find((call: any) => call[0] === 'fixed');
    const handler = fixedCall[1];

    const mockCtx = {
      from: { id: 999 }, // Not founder
      reply: vi.fn(),
    };

    await handler(mockCtx);
    expect(prisma.settings.findUnique).not.toHaveBeenCalled();
  });

  it('should broadcast resolution message to all broken groups', async () => {
    const fixedCall = mockTelegrafInstance.command.mock.calls.find((call: any) => call[0] === 'fixed');
    const handler = fixedCall[1];

    const mockCtx = {
      from: { id: USER_IDS.BRYAN },
      reply: vi.fn().mockResolvedValue({}),
    };

    vi.mocked(prisma.settings.findUnique).mockResolvedValue({ key: 'broken_groups', value: 'group1,group2' } as any);

    await handler(mockCtx);

    // Verify messages sent to both groups
    expect(mockTelegrafInstance.telegram.sendMessage).toHaveBeenCalledWith('group1', expect.stringContaining('Issue Resolved'), expect.anything());
    expect(mockTelegrafInstance.telegram.sendMessage).toHaveBeenCalledWith('group2', expect.stringContaining('Issue Resolved'), expect.anything());

    // Verify database cleared
    expect(prisma.settings.update).toHaveBeenCalledWith({
      where: { key: 'broken_groups' },
      data: { value: '' }
    });
    expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('Successfully broadcasted'));
  });
});

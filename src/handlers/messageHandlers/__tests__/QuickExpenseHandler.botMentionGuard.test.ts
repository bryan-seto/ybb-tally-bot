import { describe, it, expect, vi } from 'vitest';

// Mock transitive imports that call process.exit() at module load time
vi.mock('../../../config', () => ({
  USER_A_ROLE_KEY: 'user_a',
  USER_B_ROLE_KEY: 'user_b',
  getUserAName: () => 'Bryan',
  getUserBName: () => 'HY',
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

vi.mock('../../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../../services/expenseService', () => ({ ExpenseService: class {} }));
vi.mock('../../../services/ai', () => ({ AIService: class {} }));
vi.mock('../../../services/historyService', () => ({ HistoryService: class {} }));
vi.mock('../../../services/splitRulesService', () => ({ SplitRulesService: class {} }));
vi.mock('../../../utils/quickExpenseParser', () => ({ parseQuickExpense: vi.fn() }));
vi.mock('../../../utils/fxFormat', () => ({ formatFxAmountString: vi.fn() }));

import { QuickExpenseHandler } from '../QuickExpenseHandler';
import { SessionManager } from '../SessionManager';

function makeHandler(botUsername?: string): QuickExpenseHandler {
  const stub = {} as any;
  const sm = new SessionManager();
  return new QuickExpenseHandler(
    stub, stub, stub, sm,
    botUsername ? () => botUsername : undefined,
    undefined, stub
  );
}

describe('QuickExpenseHandler.canHandle() — bot mention guard', () => {
  const session = {};

  // The critical regression case from smoke test 3:
  // "hey @bryan_dev_tally_bot split venchi 50-50"
  // QEH should NOT handle this — AICorrectionHandler owns @bot messages.

  it('does not handle a message with bot username mid-sentence', () => {
    const h = makeHandler('bryan_dev_tally_bot');
    expect(h.canHandle('hey @bryan_dev_tally_bot split venchi 50-50', session)).toBe(false);
  });

  it('does not handle a message starting with bot username', () => {
    const h = makeHandler('bryan_dev_tally_bot');
    expect(h.canHandle('@bryan_dev_tally_bot split pad thai 50-50', session)).toBe(false);
  });

  it('does not handle bot mention even when text looks like an expense', () => {
    // "hey @bot 20 coffee" — looks like expense (letters+numbers) but has bot tag
    const h = makeHandler('bryan_dev_tally_bot');
    expect(h.canHandle('hey @bryan_dev_tally_bot 20 coffee', session)).toBe(false);
  });

  // Normal expense messages should still be handled
  it('still handles a normal quick expense (no bot mention)', () => {
    const h = makeHandler('bryan_dev_tally_bot');
    expect(h.canHandle('20 coffee', session)).toBe(true);
  });

  it('still handles description-first expense (no bot mention)', () => {
    const h = makeHandler('bryan_dev_tally_bot');
    expect(h.canHandle('split coffee 4.50', session)).toBe(true);
  });

  // Safety: if no getBotUsername injected, should not break normal behaviour
  it('still handles expense when no getBotUsername is injected', () => {
    const h = makeHandler(undefined);
    expect(h.canHandle('20 coffee', session)).toBe(true);
  });

  it('ignores non-bot @mention (still handles as expense if pattern matches)', () => {
    // "@OtherUser hey lets eat" — no number pattern, should not match expense anyway
    const h = makeHandler('bryan_dev_tally_bot');
    expect(h.canHandle('@OtherUser hey lets eat', session)).toBe(false); // no digits, already guarded by startsWith @
  });
});

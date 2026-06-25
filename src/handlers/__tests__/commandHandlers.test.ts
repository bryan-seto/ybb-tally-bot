import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the recurring command parsing logic
// This characterization test ensures the regex logic from bot.ts works correctly

describe('Recurring Command Parser', () => {
  describe('parseRecurringCommand', () => {
    // Helper function that mimics the parsing logic from bot.ts
    const parseRecurringCommand = (commandText: string) => {
      const commandMatch = commandText.match(/^\/recurring\s+add\s+(.+)$/i);
      
      if (!commandMatch) {
        return null;
      }
      
      const restOfCommand = commandMatch[1].trim();
      
      // Parse: "Description" amount day payer
      // Handle both regular quotes (") and smart quotes ("")
      const quotedMatchRegular = restOfCommand.match(/^"([^"]+)"\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\w+)$/i);
      const quotedMatchSmart = restOfCommand.match(/^[""]([^""]+)[""]\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\w+)$/i);
      const quotedMatch = quotedMatchRegular || quotedMatchSmart;
      const unquotedMatch = restOfCommand.match(/^(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\w+)$/i);
      
      let description: string = '';
      let amountStr: string = '';
      let dayStr: string = '';
      let payerStr: string = '';
      
      if (quotedMatch) {
        [, description, amountStr, dayStr, payerStr] = quotedMatch;
      } else if (unquotedMatch) {
        [, description, amountStr, dayStr, payerStr] = unquotedMatch;
      } else {
        // Fallback: try to parse manually
        const parts = restOfCommand.split(/\s+/);
        if (parts.length >= 4) {
          if (parts[0].startsWith('"') || parts[0].startsWith('"')) {
            let descEnd = 0;
            for (let i = 0; i < parts.length; i++) {
              if (parts[i].endsWith('"') || parts[i].endsWith('"')) {
                descEnd = i;
                break;
              }
            }
            description = parts.slice(0, descEnd + 1).join(' ').replace(/^[""]|[""]$/g, '');
            if (descEnd + 1 < parts.length) amountStr = parts[descEnd + 1];
            if (descEnd + 2 < parts.length) dayStr = parts[descEnd + 2];
            if (descEnd + 3 < parts.length) payerStr = parts[descEnd + 3];
          } else {
            description = parts[0];
            amountStr = parts[1];
            dayStr = parts[2];
            payerStr = parts[3];
          }
        } else {
          return null;
        }
      }
      
      return {
        description: description?.trim() || '',
        amount: parseFloat(amountStr?.trim() || ''),
        dayOfMonth: parseInt(dayStr?.trim() || ''),
        payer: payerStr?.trim().toLowerCase() || '',
      };
    };

    it('should parse quoted description with regular quotes', () => {
      const result = parseRecurringCommand('/recurring add "Internet Bill" 50 15 bryan');
      
      expect(result).not.toBeNull();
      expect(result?.description).toBe('Internet Bill');
      expect(result?.amount).toBe(50);
      expect(result?.dayOfMonth).toBe(15);
      expect(result?.payer).toBe('bryan');
    });

    it('should parse quoted description with smart quotes', () => {
      const result = parseRecurringCommand('/recurring add "Internet Bill" 50 15 bryan');
      
      expect(result).not.toBeNull();
      expect(result?.description).toBe('Internet Bill');
      expect(result?.amount).toBe(50);
      expect(result?.dayOfMonth).toBe(15);
      expect(result?.payer).toBe('bryan');
    });

    it('should parse unquoted single-word description', () => {
      const result = parseRecurringCommand('/recurring add Netflix 15.99 1 hweiyeen');
      
      expect(result).not.toBeNull();
      expect(result?.description).toBe('Netflix');
      expect(result?.amount).toBe(15.99);
      expect(result?.dayOfMonth).toBe(1);
      expect(result?.payer).toBe('hweiyeen');
    });

    it('should parse description with multiple words in quotes', () => {
      const result = parseRecurringCommand('/recurring add "Monthly Gym Membership" 100.50 5 bryan');
      
      expect(result).not.toBeNull();
      expect(result?.description).toBe('Monthly Gym Membership');
      expect(result?.amount).toBe(100.50);
      expect(result?.dayOfMonth).toBe(5);
      expect(result?.payer).toBe('bryan');
    });

    it('should handle different day values', () => {
      const result1 = parseRecurringCommand('/recurring add "Test" 10 1 bryan');
      expect(result1?.dayOfMonth).toBe(1);
      
      const result31 = parseRecurringCommand('/recurring add "Test" 10 31 bryan');
      expect(result31?.dayOfMonth).toBe(31);
    });

    it('should handle decimal amounts', () => {
      const result = parseRecurringCommand('/recurring add "Test" 99.99 15 bryan');
      
      expect(result).not.toBeNull();
      expect(result?.amount).toBe(99.99);
    });

    it('should handle case-insensitive payer names', () => {
      const resultBryan = parseRecurringCommand('/recurring add "Test" 10 15 BRYAN');
      expect(resultBryan?.payer).toBe('bryan');
      
      const resultHweiYeen = parseRecurringCommand('/recurring add "Test" 10 15 HweiYeen');
      expect(resultHweiYeen?.payer).toBe('hweiyeen');
    });

    it('should return null for invalid format (missing parameters)', () => {
      const result = parseRecurringCommand('/recurring add "Test" 10');
      expect(result).toBeNull();
    });

    it('should return null for commands without add', () => {
      const result = parseRecurringCommand('/recurring list');
      expect(result).toBeNull();
    });

    it('should handle extra spaces between parameters', () => {
      const result = parseRecurringCommand('/recurring add "Test"  50  15  bryan');
      
      expect(result).not.toBeNull();
      expect(result?.description).toBe('Test');
      expect(result?.amount).toBe(50);
      expect(result?.dayOfMonth).toBe(15);
      expect(result?.payer).toBe('bryan');
    });
  });
});

// ─── Fix 1 regression: escapeMd helper ────────────────────────────────────
// These tests FAIL before the fix (markdownUtils does not exist yet)
// and PASS after the fix is applied.
describe('escapeMd', () => {
  let escapeMd: (s: string) => string;
  beforeEach(async () => {
    const mod = await import('../../utils/markdownUtils');
    escapeMd = mod.escapeMd;
  });

  it('escapes unbalanced asterisk (AMAZE* case)', () => {
    expect(escapeMd('AMAZE* KLOOK TRAVEL SINGAPORE SGP')).toBe('AMAZE\\* KLOOK TRAVEL SINGAPORE SGP');
  });

  it('escapes underscore', () => {
    expect(escapeMd('hello_world')).toBe('hello\\_world');
  });

  it('escapes backtick', () => {
    expect(escapeMd('`code`')).toBe('\\`code\\`');
  });

  it('escapes opening square bracket (Telegram Markdown v1 only requires [)', () => {
    // Telegram Markdown v1 only needs '[' escaped, not ']'
    expect(escapeMd('[link](url)')).toBe('\\[link](url)');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeMd('cold storage groceries')).toBe('cold storage groceries');
    expect(escapeMd('pho')).toBe('pho');
    expect(escapeMd('20 coffee')).toBe('20 coffee');
  });

  it('escapes backslash', () => {
    expect(escapeMd('back\\\\slash')).toBe('back\\\\\\\\slash');
  });

  // ── U-7…U-14: QA plan hardening cases ──────────────────────────────────

  // U-7: empty string guard
  it('returns empty string unchanged', () => {
    expect(escapeMd('')).toBe('');
  });

  // U-8: all four special chars combined — no double-escape in a single pass
  it('escapes all four specials in one string without double-escaping', () => {
    expect(escapeMd('a*b_c`d[e')).toBe('a\\*b\\_c\\`d\\[e');
  });

  // U-9: backslash-first ordering — an already-escaped asterisk must not double-escape
  it('backslash-first ordering: \\* input → \\\\\\* (backslash escaped, then asterisk escaped)', () => {
    // Input: \*  (backslash then asterisk)
    // Expected: \\* (escaped backslash, then escaped asterisk)
    expect(escapeMd('\\*')).toBe('\\\\\\*');
  });

  // U-10: Markdown v1 scope — does NOT escape MarkdownV2-only chars
  it('does not escape ] ) ~ > # + = | { } ! . - (v1 scope only)', () => {
    const v2Only = '])(~>#+=|{}.!-';
    expect(escapeMd(v2Only)).toBe(v2Only);
  });
});



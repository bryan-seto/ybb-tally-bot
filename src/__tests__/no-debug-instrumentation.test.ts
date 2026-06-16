import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * Guard against leftover agent-log debug instrumentation in SOURCE files.
 *
 * Earlier build sessions left blocks like:
 *
 *   // #region agent log
 *   fetch('http://127.0.0.1:7242/ingest/...', { ... }).catch(() => {});
 *   // #endregion
 *
 * in expenseService.ts / ai.ts / QuickExpenseHandler.ts. They were bad for two reasons:
 *   1. They crashed tests (e.g. `t.payerId.toString()` on mock rows missing payerId).
 *   2. They POST transaction data + a DATABASE_URL substring to a localhost debug
 *      server on every balance calc IN PRODUCTION, silently swallowed by `.catch(()=>{})`.
 *
 * Removed 2026-06-09. This test fails if any of them reappear — which would mean an
 * agent-logging harness is re-injecting them and the build tooling needs checking.
 *
 * Scans src/ for *.ts EXCLUDING test files (tests may legitimately reference the
 * strings to assert their absence, as this very file does).
 */

const SRC_DIR = path.resolve(__dirname, '..');

// Forbidden markers. Kept as split strings / escaped so this file itself
// does not trip a naive grep for the literal tokens.
const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: 'agent-log debug fetch (ingest endpoint)', pattern: /127\.0\.0\.1:7242/ },
  { label: 'agent-log region marker', pattern: /#region agent log/ },
];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test directories entirely.
      if (entry === '__tests__') continue;
      collectSourceFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('No leftover debug instrumentation in source', () => {
  const sourceFiles = collectSourceFiles(SRC_DIR);

  it('finds source files to scan (sanity check)', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  for (const { label, pattern } of FORBIDDEN) {
    it(`has no "${label}" anywhere in src/`, () => {
      const offenders: string[] = [];
      for (const file of sourceFiles) {
        const content = readFileSync(file, 'utf8');
        if (pattern.test(content)) {
          offenders.push(path.relative(SRC_DIR, file));
        }
      }
      expect(
        offenders,
        `Leftover debug instrumentation (${label}) found in: ${offenders.join(', ')}.\n` +
          `If this reappeared, an agent-logging harness is likely re-injecting it — check the build tooling.`
      ).toEqual([]);
    });
  }
});

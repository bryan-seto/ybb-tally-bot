import { describe, it, expect, vi } from 'vitest';

/**
 * TDD: expenseService guard tests (RED before implementation)
 *
 * Two guards being added to createSmartExpense() and recordAISavedTransactions():
 *  1. FX-invariant: reject writes where currency != 'SGD' but fxRate is null/1
 *     (THIS is the real catastrophic-inflation failure mode, per skill notes)
 *  2. Large-amount soft-warn threshold: the service should surface a flag so the
 *     caller can confirm; it must NOT hard-block (legitimate large expenses exist).
 *
 * Both guards are tested in isolation via the exported pure helper functions.
 * The full service integration is covered by existing expenseService tests.
 */
import { validateFxInvariant, isAboveLargeAmountThreshold } from '../../services/expenseServiceGuards';

// ── FX-invariant guard ──────────────────────────────────────────────────────

describe('validateFxInvariant()', () => {
  it('passes for SGD with null fxRate (domestic expense)', () => {
    expect(() => validateFxInvariant('SGD', null, 100)).not.toThrow();
  });

  it('passes for SGD with fxRate=1 (domestic edge case)', () => {
    expect(() => validateFxInvariant('SGD', 1, 100)).not.toThrow();
  });

  it('passes for foreign currency with a real fxRate', () => {
    expect(() => validateFxInvariant('MYR', 3.12, 100)).not.toThrow();
  });

  it('throws when currency is non-SGD and fxRate is null', () => {
    expect(() => validateFxInvariant('IDR', null, 50000))
      .toThrow(/FX guard/);
  });

  it('throws when currency is non-SGD and fxRate === 1 (1:1 fallback poison)', () => {
    expect(() => validateFxInvariant('VND', 1, 500000))
      .toThrow(/FX guard/);
  });

  it('throws when currency is non-SGD and fxRate === 0', () => {
    expect(() => validateFxInvariant('JPY', 0, 5000))
      .toThrow(/FX guard/);
  });

  it('is case-insensitive for currency code', () => {
    // lowercase 'sgd' should be treated as domestic
    expect(() => validateFxInvariant('sgd', null, 100)).not.toThrow();
    // lowercase foreign still throws
    expect(() => validateFxInvariant('myr', null, 100)).toThrow(/FX guard/);
  });
});

// ── Large-amount soft-warn ──────────────────────────────────────────────────

describe('isAboveLargeAmountThreshold()', () => {
  it('returns false for normal expense amounts', () => {
    expect(isAboveLargeAmountThreshold(99)).toBe(false);
    expect(isAboveLargeAmountThreshold(654.64)).toBe(false); // hotel
    expect(isAboveLargeAmountThreshold(4999.99)).toBe(false);
  });

  it('returns false at exactly the threshold', () => {
    expect(isAboveLargeAmountThreshold(5000)).toBe(false);
  });

  it('returns true above the threshold', () => {
    expect(isAboveLargeAmountThreshold(5000.01)).toBe(true);
    expect(isAboveLargeAmountThreshold(9999)).toBe(true);
    expect(isAboveLargeAmountThreshold(999_999)).toBe(true);
  });

  it('respects a custom threshold override', () => {
    expect(isAboveLargeAmountThreshold(3000, 2500)).toBe(true);
    expect(isAboveLargeAmountThreshold(2500, 2500)).toBe(false);
  });
});

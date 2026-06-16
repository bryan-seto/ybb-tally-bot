/**
 * TDD tests for quickExpenseParser — foreign currency extension.
 * Tests the NEW currency-prefix patterns on top of existing SGD behaviour.
 *
 * Covers:
 *  - Currency code prefix: "VND 50000 pho"
 *  - Currency symbol prefix: "₫50000 pho", "¥1200 ramen", "RM 50 petrol"
 *  - Comma-separated amounts: "VND 500,000 hotel", "500,000 VND hotel"
 *  - Zero-decimal currencies: VND / JPY (no .xx)
 *  - Trailing currency suffix: "50000 VND pho"
 *  - Existing SGD patterns still work unchanged
 *  - ParsedExpense.currency field present
 */

import { describe, it, expect } from 'vitest';
import { parseQuickExpense } from '../quickExpenseParser';

describe('quickExpenseParser — foreign currency', () => {

  // ── Existing SGD behaviour unchanged ───────────────────────────────────
  describe('existing SGD patterns (must not regress)', () => {
    it('"15.50 coffee" → amount 15.50, currency SGD (default)', () => {
      const r = parseQuickExpense('15.50 coffee');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(15.50);
      expect(r!.description).toBe('coffee');
      expect(r!.currency).toBe('SGD');
    });

    it('"$5 coffee" → amount 5, currency SGD', () => {
      const r = parseQuickExpense('$5 coffee');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(5);
      expect(r!.currency).toBe('SGD');
    });

    it('"coffee 5" → amount 5, currency SGD', () => {
      const r = parseQuickExpense('coffee 5');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(5);
      expect(r!.currency).toBe('SGD');
    });
  });

  // ── VND ─────────────────────────────────────────────────────────────────
  describe('VND', () => {
    it('"VND 50000 pho" → amount 50000, currency VND', () => {
      const r = parseQuickExpense('VND 50000 pho');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(50000);
      expect(r!.currency).toBe('VND');
      expect(r!.description).toBe('pho');
      expect(r!.category).toBe('Food');
    });

    it('"vnd 50000 pho" (lowercase) → currency VND', () => {
      const r = parseQuickExpense('vnd 50000 pho');
      expect(r).not.toBeNull();
      expect(r!.currency).toBe('VND');
    });

    it('"₫50000 pho" (symbol) → currency VND', () => {
      const r = parseQuickExpense('₫50000 pho');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(50000);
      expect(r!.currency).toBe('VND');
    });

    it('"VND 500,000 hotel" (commas) → amount 500000', () => {
      const r = parseQuickExpense('VND 500,000 hotel');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(500000);
      expect(r!.currency).toBe('VND');
      expect(r!.category).toBe('Travel');
    });

    it('"VND 2,000,000 resort" (multiple commas) → amount 2000000', () => {
      const r = parseQuickExpense('VND 2,000,000 resort');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(2000000);
      expect(r!.currency).toBe('VND');
    });

    it('"50000 VND pho" (suffix) → amount 50000, currency VND', () => {
      const r = parseQuickExpense('50000 VND pho');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(50000);
      expect(r!.currency).toBe('VND');
    });
  });

  // ── MYR ──────────────────────────────────────────────────────────────────
  describe('MYR', () => {
    it('"MYR 50 petrol" → amount 50, currency MYR', () => {
      const r = parseQuickExpense('MYR 50 petrol');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(50);
      expect(r!.currency).toBe('MYR');
      expect(r!.category).toBe('Transport');
    });

    it('"RM 50 petrol" (Ringgit symbol shorthand) → currency MYR', () => {
      const r = parseQuickExpense('RM 50 petrol');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(50);
      expect(r!.currency).toBe('MYR');
    });

    it('"MYR 150.50 dinner" (with decimals) → amount 150.50', () => {
      const r = parseQuickExpense('MYR 150.50 dinner');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(150.50);
      expect(r!.currency).toBe('MYR');
    });
  });

  // ── JPY ──────────────────────────────────────────────────────────────────
  describe('JPY', () => {
    it('"JPY 1200 ramen" → amount 1200, currency JPY', () => {
      const r = parseQuickExpense('JPY 1200 ramen');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(1200);
      expect(r!.currency).toBe('JPY');
      expect(r!.category).toBe('Food');
    });

    it('"¥1200 ramen" (yen symbol) → currency JPY', () => {
      const r = parseQuickExpense('¥1200 ramen');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(1200);
      expect(r!.currency).toBe('JPY');
    });

    it('"¥ 1,200 ramen" (yen symbol + space + comma) → amount 1200', () => {
      const r = parseQuickExpense('¥ 1,200 ramen');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(1200);
      expect(r!.currency).toBe('JPY');
    });
  });

  // ── THB ──────────────────────────────────────────────────────────────────
  describe('THB', () => {
    it('"THB 200 pad thai" → amount 200, currency THB', () => {
      const r = parseQuickExpense('THB 200 pad thai');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(200);
      expect(r!.currency).toBe('THB');
      expect(r!.description).toBe('pad thai');
    });
  });

  // ── USD ──────────────────────────────────────────────────────────────────
  describe('USD', () => {
    it('"USD 20 coffee" → currency USD', () => {
      const r = parseQuickExpense('USD 20 coffee');
      expect(r).not.toBeNull();
      expect(r!.currency).toBe('USD');
    });
  });

  // ── IDR ──────────────────────────────────────────────────────────────────
  describe('IDR', () => {
    it('"IDR 50000 nasi goreng" → currency IDR', () => {
      const r = parseQuickExpense('IDR 50000 nasi goreng');
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(50000);
      expect(r!.currency).toBe('IDR');
    });
  });

  // ── Currency normalisation ────────────────────────────────────────────────
  describe('currency code normalisation', () => {
    it('normalises "DONG" to VND', () => {
      const r = parseQuickExpense('DONG 50000 pho');
      expect(r).not.toBeNull();
      expect(r!.currency).toBe('VND');
    });

    it('normalises "RINGGIT" to MYR', () => {
      const r = parseQuickExpense('RINGGIT 50 food');
      expect(r).not.toBeNull();
      expect(r!.currency).toBe('MYR');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('unknown 3-letter code prefix still parses (currency field = the code)', () => {
      // "EUR 20 coffee" should work even though EUR isn't a primary travel currency
      const r = parseQuickExpense('EUR 20 coffee');
      expect(r).not.toBeNull();
      expect(r!.currency).toBe('EUR');
    });

    it('amount-only with currency still returns null (no description)', () => {
      const r = parseQuickExpense('VND 50000');
      expect(r).toBeNull();
    });

    it('plain text without numbers still returns null', () => {
      const r = parseQuickExpense('VND pho');
      expect(r).toBeNull();
    });
  });
});

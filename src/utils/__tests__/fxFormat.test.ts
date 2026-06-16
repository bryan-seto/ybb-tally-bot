import { describe, it, expect } from 'vitest';
import {
  formatOriginalAmount,
  formatFxRate,
  formatFxAmountString,
} from '../fxFormat';

describe('fxFormat utilities', () => {
  describe('formatOriginalAmount', () => {
    it('shows whole numbers for zero-decimal currencies', () => {
      expect(formatOriginalAmount(50000, 'VND')).toBe('VND 50,000');
      expect(formatOriginalAmount(1200, 'JPY')).toBe('JPY 1,200');
      expect(formatOriginalAmount(15000, 'KRW')).toBe('KRW 15,000');
      expect(formatOriginalAmount(100000, 'IDR')).toBe('IDR 100,000');
    });

    it('shows 2dp for standard currencies', () => {
      expect(formatOriginalAmount(50.0, 'MYR')).toBe('MYR 50.00');
      expect(formatOriginalAmount(35.5, 'USD')).toBe('USD 35.50');
      expect(formatOriginalAmount(10.99, 'GBP')).toBe('GBP 10.99');
    });

    it('rounds zero-decimal currencies correctly', () => {
      expect(formatOriginalAmount(49999.6, 'VND')).toBe('VND 50,000');
    });
  });

  describe('formatFxRate', () => {
    it('uses 4 significant figures (no fixed dp rule)', () => {
      expect(formatFxRate(0.3162)).toBe('0.3162');
      expect(formatFxRate(0.7412)).toBe('0.7412');
      // 0.001 → toPrecision(4) = "0.001000" → parseFloat → "0.001"
      expect(formatFxRate(0.001)).toBe('0.001');
    });

    it('uses 6dp for very small rates (JPY, VND)', () => {
      expect(formatFxRate(0.008759)).toBe('0.008759');
      expect(formatFxRate(0.000052)).toBe('0.000052');
    });

    it('falls back to exponential notation for extremely small rates', () => {
      // toPrecision(4) on 1.234e-7 → "1.234e-7"
      expect(formatFxRate(0.0000001234)).toMatch(/e/);
    });
  });

  describe('formatFxAmountString', () => {
    it('SGD: returns plain S$X.XX', () => {
      expect(formatFxAmountString(45.0, 'SGD', null, null)).toBe('S$45.00');
      expect(formatFxAmountString(45.0, 'SGD', undefined, undefined)).toBe('S$45.00');
    });

    it('non-SGD with full FX data: shows original → SGD (@ rate)', () => {
      // JPY 1200 at 0.008759 → S$10.51
      expect(formatFxAmountString(10.51, 'JPY', 1200, 0.008759)).toBe(
        'JPY 1,200 → S$10.51 (@ 0.008759)',
      );
    });

    it('non-SGD with full FX data: MYR', () => {
      expect(formatFxAmountString(15.83, 'MYR', 50.0, 0.3162)).toBe(
        'MYR 50.00 → S$15.83 (@ 0.3162)',
      );
    });

    it('non-SGD with full FX data: VND', () => {
      expect(formatFxAmountString(2.45, 'VND', 50000, 0.000049)).toBe(
        'VND 50,000 → S$2.45 (@ 0.000049)',
      );
    });

    it('non-SGD without fxRate: omits the rate section', () => {
      expect(formatFxAmountString(10.51, 'JPY', 1200, null)).toBe(
        'JPY 1,200 → S$10.51',
      );
    });

    it('non-SGD without originalAmount: falls back to plain S$', () => {
      // Old record that predates FX storage
      expect(formatFxAmountString(10.51, 'JPY', null, null)).toBe('S$10.51');
      expect(formatFxAmountString(10.51, 'JPY', undefined, null)).toBe('S$10.51');
    });
  });
});

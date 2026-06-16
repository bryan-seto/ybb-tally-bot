/**
 * FX display formatting utilities
 *
 * Shared by QuickExpenseHandler, photoHandler, and historyService so that
 * all surfaces render amounts identically: "JPY 1,200 → S$10.51 (@ 0.008759)"
 */

/** Currencies that are conventionally displayed as integers (no decimal places). */
const NO_DECIMAL_CURRENCIES = new Set(['JPY', 'VND', 'KRW', 'IDR', 'HUF']);

/**
 * Format the original foreign currency amount with appropriate decimal places.
 *
 * Examples:
 *   VND 50,000 / JPY 1,200 / MYR 50.00 / USD 35.50
 */
export function formatOriginalAmount(amount: number, currency: string): string {
  if (NO_DECIMAL_CURRENCIES.has(currency)) {
    return `${currency} ${Math.round(amount).toLocaleString('en-US')}`;
  }
  return `${currency} ${amount.toFixed(2)}`;
}

/**
 * Format an FX rate to 4 significant figures, stripping trailing zeros.
 *
 * Examples:
 *   0.3162   → "0.3162"    (MYR — 4 sig figs, 4dp)
 *   0.008759 → "0.008759"  (JPY — 4 sig figs, 6dp)
 *   0.000052 → "0.000052"  (VND — 2 sig figs shown as-is)
 *   1.234e-7 → "1.234e-7"  (extreme case — kept in exponent notation)
 */
export function formatFxRate(rate: number): string {
  const str = rate.toPrecision(4);
  // toPrecision switches to exponential for very large/small numbers — keep as-is
  if (str.includes('e')) return str;
  // Strip trailing zeros: "0.001000" → "0.001", "0.3162" stays "0.3162"
  return parseFloat(str).toString();
}

/**
 * Build a full FX-aware amount string for display in messages.
 *
 * Non-SGD with FX data:  "JPY 1,200 → S$10.51 (@ 0.008759)"
 * Non-SGD without data:  "S$10.51"   (edge case: old record with no originalAmount)
 * SGD:                   "S$45.00"
 */
export function formatFxAmountString(
  amountSGD: number,
  currency: string,
  originalAmount: number | null | undefined,
  fxRate: number | null | undefined,
): string {
  if (currency !== 'SGD' && originalAmount != null) {
    const origStr = formatOriginalAmount(originalAmount, currency);
    const rateStr = fxRate != null ? ` (@ ${formatFxRate(fxRate)})` : '';
    return `${origStr} → S$${amountSGD.toFixed(2)}${rateStr}`;
  }
  return `S$${amountSGD.toFixed(2)}`;
}

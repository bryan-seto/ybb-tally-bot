/**
 * expenseServiceGuards.ts
 *
 * Pure guard functions extracted from expenseService so they can be:
 *   1. Unit-tested in isolation (no DB, no Prisma, no mocks needed)
 *   2. Imported by createSmartExpense() and recordAISavedTransactions()
 *
 * DEFAULT_LARGE_AMOUNT_THRESHOLD_SGD:
 *   Surfaced as a soft-warn (NOT a hard reject). The caller decides what to do
 *   (prompt user for confirmation, log a warning, etc.).
 *   Intentionally conservative at $5,000 SGD — covers hotel bookings ($654),
 *   flights, appliances, etc. while flagging clearly anomalous values.
 *   Override via LARGE_EXPENSE_WARN_SGD env var (parsed at startup in config.ts).
 */
export const DEFAULT_LARGE_AMOUNT_THRESHOLD_SGD = 5_000;

/**
 * FX-invariant guard.
 *
 * The documented catastrophic-inflation failure mode (skill: "FX silent 1:1 fallback")
 * is: a foreign-currency amount stored with fxRate=null or fxRate=1, producing
 * amountSGD = raw foreign amount (e.g. 50,000 IDR stored as $50,000 SGD).
 *
 * Throws if currency is non-SGD AND fxRate is null, 0, or 1.
 * SGD rows are always valid regardless of fxRate.
 */
export function validateFxInvariant(
  currency: string,
  fxRate: number | null | undefined,
  amountSGD: number
): void {
  const normalised = currency.toUpperCase();
  if (normalised === 'SGD') return; // domestic — always fine

  const rate = fxRate ?? null;
  if (rate === null || rate === 0 || rate === 1) {
    throw new Error(
      `FX guard: refusing to write ${normalised} transaction with ` +
      `fxRate=${rate} (1:1 or missing). ` +
      `This would store amountSGD=${amountSGD} as if it were already SGD, ` +
      `causing catastrophic balance inflation. ` +
      `Ensure fxRateService.convertToSGD() ran successfully before saving.`
    );
  }
}

/**
 * Large-amount soft-warn.
 *
 * Returns true if amountSGD exceeds the threshold (default $5,000 SGD).
 * Callers should surface a confirmation step rather than hard-blocking.
 * Pass a custom threshold to override (e.g. from config.LARGE_EXPENSE_WARN_SGD).
 */
export function isAboveLargeAmountThreshold(
  amountSGD: number,
  threshold: number = DEFAULT_LARGE_AMOUNT_THRESHOLD_SGD
): boolean {
  return amountSGD > threshold;
}

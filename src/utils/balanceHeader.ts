/**
 * Pure balance-header formatting helper.
 *
 * Extracted from bot.ts getRandomBalanceHeader() so the dashboard-header copy
 * (FEAT-2: subject-inclusive "X owes $Y to Z") can be unit-tested without
 * instantiating the full Telegraf bot.
 *
 * HY's request (2026-01-10): the dashboard header must say WHO owes whom,
 * not just "To even out: $X to Bryan".
 */

export interface BalanceHeaderInput {
  netOutstanding: number;
  whoOwes: 'Bryan' | 'HweiYeen' | null;
}

/**
 * Build the dashboard balance header line.
 *
 * @param balance     net balance result from ExpenseService.calculateNetBalance()
 * @param bryanName   display name for the Bryan role
 * @param hweiYeenName display name for the HweiYeen role
 * @returns a single-line header string including the subject (who owes whom)
 */
export function formatBalanceHeader(
  balance: BalanceHeaderInput,
  bryanName: string,
  hweiYeenName: string
): string {
  // Settled state — no outstanding balance
  if (balance.netOutstanding === 0) {
    return '🎉 All settled! Balance is $0.00';
  }

  const amount = balance.netOutstanding.toFixed(2);

  if (balance.whoOwes === 'HweiYeen') {
    return `⚖️ ${hweiYeenName} owes $${amount} to ${bryanName}`;
  } else if (balance.whoOwes === 'Bryan') {
    return `⚖️ ${bryanName} owes $${amount} to ${hweiYeenName}`;
  }

  // Fallback (should not normally happen when netOutstanding > 0)
  return '💰 Balance Status';
}

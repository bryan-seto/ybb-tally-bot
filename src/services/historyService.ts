import { prisma } from '../lib/prisma';
import { formatDate } from '../utils/dateHelpers';
import { formatFxAmountString } from '../utils/fxFormat';
import { escapeMd } from '../utils/markdownUtils';

export interface TransactionListItem {
  id: bigint;
  date: Date;
  merchant: string;
  amount: number;
  currency: string;
  status: 'settled' | 'unsettled';
  category: string;
  description: string;
  paidBy: string;
  originalAmount?: number | null;
  fxRate?: number | null;
}

export interface TransactionDetail extends TransactionListItem {
  payerId: bigint;
  payerRole: string;
  splitType?: string;
  bryanPercentage?: number;
  hweiYeenPercentage?: number;
  originalAmount?: number | null;
  fxRate?: number | null;
}

export class HistoryService {
  /**
   * Get recent transactions with pagination
   */
  async getRecentTransactions(limit: number = 20, offset: number = 0): Promise<TransactionListItem[]> {
    const transactions = await prisma.transaction.findMany({
      include: {
        payer: true,
      },
      orderBy: {
        createdAt: 'desc', // Sort by when it was recorded, not transaction date
      },
      take: limit,
      skip: offset,
    });

    return transactions.map(t => ({
      id: t.id,
      date: t.date,
      merchant: t.description || 'No description',
      amount: t.amountSGD,
      currency: t.currency,
      originalAmount: t.originalAmount ?? null,
      fxRate: t.fxRate ?? null,
      status: (t.isSettled || t.category === 'Settlement' || t.category === 'Payment') ? 'settled' : 'unsettled',
      category: t.category || 'Other',
      description: t.description || 'No description',
      paidBy: t.payer.name,
    }));
  }

  /**
   * Get total count of transactions
   */
  async getTotalTransactionCount(): Promise<number> {
    return await prisma.transaction.count();
  }

  /**
   * Format a Prisma transaction model (with payer relation) into TransactionDetail
   */
  formatTransactionModel(rawTx: any): TransactionDetail {
    if (!rawTx || !rawTx.payer) {
      throw new Error('Transaction must include payer relation');
    }

    return {
      id: rawTx.id,
      date: rawTx.date,
      merchant: rawTx.description || 'No description',
      amount: rawTx.amountSGD,
      currency: rawTx.currency,
      status: (rawTx.isSettled || rawTx.category === 'Settlement' || rawTx.category === 'Payment') ? 'settled' : 'unsettled',
      category: rawTx.category || 'Other',
      description: rawTx.description || 'No description',
      paidBy: rawTx.payer.name,
      payerId: rawTx.payerId,
      payerRole: rawTx.payer.role,
      splitType: rawTx.splitType || undefined,
      bryanPercentage: rawTx.bryanPercentage ?? undefined,
      hweiYeenPercentage: rawTx.hweiYeenPercentage ?? undefined,
      originalAmount: rawTx.originalAmount ?? null,
      fxRate: rawTx.fxRate ?? null,
    };
  }

  /**
   * Get transaction by ID
   */
  async getTransactionById(id: bigint): Promise<TransactionDetail | null> {
    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: {
        payer: true,
      },
    });

    if (!transaction) {
      return null;
    }

    return this.formatTransactionModel(transaction);
  }

  /**
   * Format status emoji
   */
  getStatusEmoji(status: 'settled' | 'unsettled'): string {
    return status === 'settled' ? '✅' : '🔴';
  }

  /**
   * Escape Markdown v1 special characters for Telegram Markdown (parse_mode: 'Markdown').
   * Delegates to the shared escapeMd utility from markdownUtils.ts.
   * Note: In Telegram Markdown v1, backslash-escaping IS supported for * _ ` [
   */
  private escapeMarkdown(text: string): string {
    return escapeMd(text);
  }

  /**
   * Format amount string based on currency (for list items in activity feed).
   * Uses fxFormat so foreign items show "JPY 1,200 → S$10.51 (@ 0.008759)"
   * instead of the old (broken) "JPY 9.61".
   */
  private formatAmountString(amount: number, currency: string, originalAmount?: number | null, fxRate?: number | null): string {
    return formatFxAmountString(amount, currency, originalAmount, fxRate);
  }

  /**
   * Format amount string for detail view (includes currency prefix for SGD).
   */
  private formatAmountStringForDetail(amount: number, currency: string, originalAmount?: number | null, fxRate?: number | null): string {
    return formatFxAmountString(amount, currency, originalAmount, fxRate);
  }

  /**
   * Format transaction list item
   */
  formatTransactionListItem(tx: TransactionListItem): string {
    const statusEmoji = this.getStatusEmoji(tx.status);
    const amountStr = this.formatAmountString(tx.amount, tx.currency, tx.originalAmount, tx.fxRate);
    
    // Escape merchant name to prevent Markdown parsing errors
    const merchant = this.escapeMarkdown(tx.merchant);
    
    return `/${tx.id} ${statusEmoji} *${merchant}* - ${amountStr}`;
  }

  /**
   * Get status text from status
   */
  private getStatusText(status: 'settled' | 'unsettled'): string {
    return status === 'settled' ? 'Settled' : 'Unsettled';
  }

  /**
   * Format split details for transaction
   * Note: FULL split type is intentionally not displayed (per original comment)
   */
  private formatSplitDetails(tx: TransactionDetail): string {
    if (tx.splitType === 'FIFTY_FIFTY') {
      return '⚖️ **Split:** 50% / 50%';
    }

    if (tx.bryanPercentage !== undefined && tx.hweiYeenPercentage !== undefined) {
      const bryanPercent = Math.round(tx.bryanPercentage * 100);
      const hweiYeenPercent = Math.round(tx.hweiYeenPercentage * 100);
      return `⚖️ **Split:** ${bryanPercent}% (Bryan) / ${hweiYeenPercent}% (HY)`;
    }

    return '';
  }

  /**
   * 🧠 CYNOSURE LOGIC: THE TRUTH TELLER
   * Calculates the exact net debt vector.
   * "Who owes whom, and exactly how much?"
   */
  private formatBalanceImpact(tx: TransactionDetail): string {
    // 1. Safety Checks
    if (!tx.payerRole) {
      return '⚠️ Error: Payer data missing';
    }
    if (tx.status === 'settled') {
      return '✅ Settled (No active debt)';
    }

    // 2. The Constants
    const AMOUNT = Number(tx.amount);
    const BRYAN_PCT = tx.bryanPercentage ?? 0.5; // Default fallback
    const HY_PCT = tx.hweiYeenPercentage ?? 0.5; // Default fallback

    // 3. The Ledger (Who paid what vs Who consumed what)
    // We use the immutable 'role' field to identify the payer
    const bryanPaid = tx.payerRole === 'Bryan' ? AMOUNT : 0;
    const hyPaid = tx.payerRole === 'HweiYeen' ? AMOUNT : 0;

    const bryanConsumed = AMOUNT * BRYAN_PCT;
    const hyConsumed = AMOUNT * HY_PCT;

    // 4. The Net Vector (Positive = Owed Money, Negative = Paid too much)
    const bryanNet = bryanConsumed - bryanPaid;
    const hyNet = hyConsumed - hyPaid;

    // 5. The Verdict
    // Case A: Wash (Paid for self)
    if (Math.abs(bryanNet) < 0.01 && Math.abs(hyNet) < 0.01) {
      return '✅ No debt created (Paid for own expense)';
    }

    // Case B: Debt exists
    if (bryanNet > 0.01) {
      return `🔴 👉 Bryan owes Hwei Yeen $${bryanNet.toFixed(2)}`;
    } else if (hyNet > 0.01) {
      return `🔴 👉 Hwei Yeen owes Bryan $${hyNet.toFixed(2)}`;
    }

    return '';
  }

  /**
   * Format transaction detail card
   */
  formatTransactionDetail(tx: TransactionDetail): string {
    const statusEmoji = this.getStatusEmoji(tx.status);
    const statusText = this.getStatusText(tx.status);
    const dateStr = formatDate(tx.date, 'dd MMM yyyy, hh:mm a');

    // Amount display: delegate to shared FX formatter
    // Non-SGD with data: "JPY 1,200 → S$10.51 (@ 0.008759)"
    // SGD or old record:  "S$45.00"
    const amountStr = this.formatAmountStringForDetail(tx.amount, tx.currency, tx.originalAmount, tx.fxRate);

    const splitDetails = this.formatSplitDetails(tx);
    const balanceImpact = this.formatBalanceImpact(tx);

    // Format percentages for display
    const bryanPercent = Math.round((tx.bryanPercentage ?? 0.5) * 100);
    const hyPercent = Math.round((tx.hweiYeenPercentage ?? 0.5) * 100);

    return `💳 **Transaction Details**\n\n` +
      `${statusEmoji} **Status:** ${statusText}\n` +
      `📅 **Date:** ${dateStr}\n` +
      `🏪 **Merchant:** ${escapeMd(tx.merchant)}\n` +
      `💰 **Amount:** ${amountStr}\n` +
      `📂 **Category:** ${escapeMd(tx.category)}\n` +
      `👤 **Paid By:** ${escapeMd(tx.paidBy)}\n` +
      (splitDetails ? `${splitDetails}\n` : `⚖️ **Split:** ${bryanPercent}% Bryan / ${hyPercent}% HY\n`) +
      `⚖️ **BALANCE IMPACT**\n${balanceImpact}\n` +
      `📝 **Description:** ${escapeMd(tx.description)}`;
  }
}


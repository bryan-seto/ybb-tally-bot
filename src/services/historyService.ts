import { prisma } from '../lib/prisma';
import { formatDate } from '../utils/dateHelpers';

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
}

export interface TransactionDetail extends TransactionListItem {
  payerId: bigint;
  payerRole: string;
  splitType?: string;
  bryanPercentage?: number;
  hweiYeenPercentage?: number;
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
      status: t.isSettled ? 'settled' : 'unsettled',
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
      status: rawTx.isSettled ? 'settled' : 'unsettled',
      category: rawTx.category || 'Other',
      description: rawTx.description || 'No description',
      paidBy: rawTx.payer.name,
      payerId: rawTx.payerId,
      payerRole: rawTx.payer.role,
      splitType: rawTx.splitType || undefined,
      bryanPercentage: rawTx.bryanPercentage ?? undefined,
      hweiYeenPercentage: rawTx.hweiYeenPercentage ?? undefined,
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
   * Escape Markdown special characters
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
  }

  /**
   * Format amount string based on currency (for list items)
   */
  private formatAmountString(amount: number, currency: string): string {
    if (currency === 'SGD') {
      return `$${amount.toFixed(2)}`;
    }
    return `${currency} ${amount.toFixed(2)}`;
  }

  /**
   * Format amount string for detail view (includes currency prefix for SGD)
   */
  private formatAmountStringForDetail(amount: number, currency: string): string {
    if (currency === 'SGD') {
      return `SGD $${amount.toFixed(2)}`;
    }
    return `${currency} ${amount.toFixed(2)}`;
  }

  /**
   * Format transaction list item
   */
  formatTransactionListItem(tx: TransactionListItem): string {
    const statusEmoji = this.getStatusEmoji(tx.status);
    const amountStr = this.formatAmountString(tx.amount, tx.currency);
    
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
   * Format transaction detail card
   */
  formatTransactionDetail(tx: TransactionDetail): string {
    const statusEmoji = this.getStatusEmoji(tx.status);
    const statusText = this.getStatusText(tx.status);
    const dateStr = formatDate(tx.date, 'dd MMM yyyy, hh:mm a');
    const amountStr = this.formatAmountStringForDetail(tx.amount, tx.currency);
    const splitDetails = this.formatSplitDetails(tx);

    return `💳 **Transaction Details**\n\n` +
      `${statusEmoji} **Status:** ${statusText}\n` +
      `📅 **Date:** ${dateStr}\n` +
      `🏪 **Merchant:** ${tx.merchant}\n` +
      `💰 **Amount:** ${amountStr}\n` +
      `📂 **Category:** ${tx.category}\n` +
      `👤 **Paid By:** ${tx.paidBy}\n` +
      (splitDetails ? `${splitDetails}\n` : '') +
      `📝 **Description:** ${tx.description}`;
  }
}


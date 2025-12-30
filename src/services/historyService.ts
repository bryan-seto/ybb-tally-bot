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

    return {
      id: transaction.id,
      date: transaction.date,
      merchant: transaction.description || 'No description',
      amount: transaction.amountSGD,
      currency: transaction.currency,
      status: transaction.isSettled ? 'settled' : 'unsettled',
      category: transaction.category || 'Other',
      description: transaction.description || 'No description',
      paidBy: transaction.payer.name,
      payerId: transaction.payerId,
      payerRole: transaction.payer.role,
      splitType: transaction.splitType || undefined,
      bryanPercentage: transaction.bryanPercentage ?? undefined,
      hweiYeenPercentage: transaction.hweiYeenPercentage ?? undefined,
    };
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
   * Format transaction list item
   */
  formatTransactionListItem(tx: TransactionListItem): string {
    const statusEmoji = this.getStatusEmoji(tx.status);
    const amountStr = tx.currency === 'SGD' 
      ? `$${tx.amount.toFixed(2)}`
      : `${tx.currency} ${tx.amount.toFixed(2)}`;
    
    // Escape merchant name to prevent Markdown parsing errors
    const merchant = this.escapeMarkdown(tx.merchant);
    
    return `/${tx.id} ${statusEmoji} *${merchant}* - ${amountStr}`;
  }

  /**
   * Format transaction detail card
   */
  formatTransactionDetail(tx: TransactionDetail): string {
    const statusEmoji = this.getStatusEmoji(tx.status);
    const statusText = tx.status === 'settled' ? 'Settled' : 'Unsettled';
    const dateStr = formatDate(tx.date, 'dd MMM yyyy, hh:mm a');
    const amountStr = tx.currency === 'SGD'
      ? `SGD $${tx.amount.toFixed(2)}`
      : `${tx.currency} ${tx.amount.toFixed(2)}`;

    // Format split details (skip FULL split type)
    let splitDetails = '';
    if (tx.splitType === 'FIFTY_FIFTY') {
      splitDetails = '⚖️ **Split:** 50% / 50%';
    } else if (tx.bryanPercentage !== undefined && tx.hweiYeenPercentage !== undefined) {
      const bryanPercent = Math.round(tx.bryanPercentage * 100);
      const hweiYeenPercent = Math.round(tx.hweiYeenPercentage * 100);
      splitDetails = `⚖️ **Split:** ${bryanPercent}% (Bryan) / ${hweiYeenPercent}% (HY)`;
    }
    // Note: FULL split type is intentionally not displayed

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


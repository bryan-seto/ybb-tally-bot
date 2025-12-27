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
        date: 'desc',
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
    };
  }

  /**
   * Format status emoji
   */
  getStatusEmoji(status: 'settled' | 'unsettled'): string {
    return status === 'settled' ? '✅' : '🔴';
  }

  /**
   * Format transaction list item
   */
  formatTransactionListItem(tx: TransactionListItem): string {
    const statusEmoji = this.getStatusEmoji(tx.status);
    const amountStr = tx.currency === 'SGD' 
      ? `$${tx.amount.toFixed(2)}`
      : `${tx.currency} ${tx.amount.toFixed(2)}`;
    
    return `/${tx.id} ${statusEmoji} *${tx.merchant}* - ${amountStr}`;
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

    return `💳 **Transaction Details**\n\n` +
      `${statusEmoji} **Status:** ${statusText}\n` +
      `📅 **Date:** ${dateStr}\n` +
      `🏪 **Merchant:** ${tx.merchant}\n` +
      `💰 **Amount:** ${amountStr}\n` +
      `📂 **Category:** ${tx.category}\n` +
      `👤 **Paid By:** ${tx.paidBy}\n` +
      `📝 **Description:** ${tx.description}`;
  }
}


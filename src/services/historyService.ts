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
   * Get recent expenses for a group with pagination
   */
  async getGroupExpenses(groupId: bigint, limit: number = 20, offset: number = 0): Promise<TransactionListItem[]> {
    const expenses = await prisma.expense.findMany({
      where: { groupId },
      include: {
        group: {
          include: {
            members: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    });

    return expenses.map(e => {
      // Get payer name
      let payerName = 'Unknown';
      if (e.payerType === 'real') {
        const payer = e.group.members.find(m => m.id === e.payerId);
        payerName = payer?.name || 'Unknown';
      }

      return {
        id: e.id,
        date: e.date,
        merchant: e.description || 'No description',
        amount: e.amountSGD,
        currency: e.currency,
        status: e.isSettled ? 'settled' : 'unsettled',
        category: e.category || 'Other',
        description: e.description || 'No description',
        paidBy: payerName,
      };
    });
  }

  /**
   * Get total count of expenses for a group
   */
  async getGroupExpenseCount(groupId: bigint): Promise<number> {
    return await prisma.expense.count({
      where: { groupId },
    });
  }

  /**
   * Get expense by ID
   */
  async getExpenseById(id: bigint): Promise<TransactionDetail | null> {
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        group: {
          include: {
            members: true,
          },
        },
      },
    });

    if (!expense) {
      return null;
    }

    let payerName = 'Unknown';
    if (expense.payerType === 'real') {
      const payer = expense.group.members.find(m => m.id === expense.payerId);
      payerName = payer?.name || 'Unknown';
    }

    return {
      id: expense.id,
      date: expense.date,
      merchant: expense.description || 'No description',
      amount: expense.amountSGD,
      currency: expense.currency,
      status: expense.isSettled ? 'settled' : 'unsettled',
      category: expense.category || 'Other',
      description: expense.description || 'No description',
      paidBy: payerName,
      payerId: expense.payerId,
      payerRole: 'Unknown', // Not applicable for new system
    };
  }

  // Legacy methods for backward compatibility
  async getRecentTransactions(limit: number = 20, offset: number = 0): Promise<TransactionListItem[]> {
    const transactions = await prisma.transaction.findMany({
      include: {
        payer: true,
      },
      orderBy: {
        createdAt: 'desc',
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

  async getTotalTransactionCount(): Promise<number> {
    return await prisma.transaction.count();
  }

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
      payerRole: transaction.payer.role || 'Unknown',
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
   * Format transaction list item (plain text, no markdown)
   * Format: /21 🔴 MERCHANT - $12.08
   */
  formatTransactionListItem(tx: TransactionListItem): string {
    const statusEmoji = this.getStatusEmoji(tx.status);
    const amountStr = tx.currency === 'SGD' 
      ? `$${tx.amount.toFixed(2)}`
      : `${tx.currency} ${tx.amount.toFixed(2)}`;
    
    // Escape special characters for Telegram (parentheses, hyphens, etc.)
    // Telegram uses backslash escaping for special chars in plain text
    const merchant = tx.merchant
      .replace(/\\/g, '\\\\')  // Escape backslashes first
      .replace(/[()\-]/g, '\\$&');  // Escape parentheses and hyphens
    
    return `/${tx.id} ${statusEmoji} ${merchant} - ${amountStr}`;
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


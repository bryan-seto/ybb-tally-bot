import { getStartOfMonth, getEndOfMonth, getMonthsAgo, formatDate } from '../utils/dateHelpers';
import { prisma } from '../lib/prisma';

export class ExpenseService {
  /**
   * Calculate outstanding balance between users
   * Returns: { bryanOwes: number, hweiYeenOwes: number }
   */
  async calculateOutstandingBalance(): Promise<{
    bryanOwes: number;
    hweiYeenOwes: number;
  }> {
    // Get users
    const bryan = await prisma.user.findFirst({
      where: { role: 'Bryan' },
    });
    const hweiYeen = await prisma.user.findFirst({
      where: { role: 'HweiYeen' },
    });

    if (!bryan || !hweiYeen) {
      return { bryanOwes: 0, hweiYeenOwes: 0 };
    }

    // Get all unsettled transactions
    const transactions = await prisma.transaction.findMany({
      where: {
        isSettled: false,
      },
    });

    let bryanPaid = 0;
    let hweiYeenPaid = 0;
    let totalAmount = 0;

    transactions.forEach((t) => {
      totalAmount += t.amountSGD;
      if (t.payerId === bryan.id) {
        bryanPaid += t.amountSGD;
      } else if (t.payerId === hweiYeen.id) {
        hweiYeenPaid += t.amountSGD;
      }
    });

    // 70/30 split: Bryan 70%, HweiYeen 30%
    const bryanShare = totalAmount * 0.7;
    const hweiYeenShare = totalAmount * 0.3;

    const bryanOwes = Math.max(0, bryanShare - bryanPaid);
    const hweiYeenOwes = Math.max(0, hweiYeenShare - hweiYeenPaid);

    return { bryanOwes, hweiYeenOwes };
  }

  /**
   * Get monthly report data
   */
  async getMonthlyReport(monthOffset: number = 1): Promise<{
    totalSpend: number;
    bryanPaid: number;
    hweiYeenPaid: number;
    transactionCount: number;
    topCategories: { category: string; amount: number }[];
  }> {
    const reportDate = getMonthsAgo(monthOffset);
    const start = getStartOfMonth(reportDate);
    const end = getEndOfMonth(reportDate);

    // Query all transactions first to debug
    const allTransactions = await prisma.transaction.findMany({
      include: {
        payer: true,
      },
      orderBy: {
        date: 'desc',
      },
      take: 10, // Get last 10 for debugging
    });

    console.log('Sample transactions:', allTransactions.map(t => ({
      id: t.id.toString(),
      date: t.date.toISOString(),
      amount: t.amountSGD,
    })));

    // Query transactions - use a more flexible date range to handle timezone issues
    // Convert dates to UTC for comparison since Prisma stores dates in UTC
    const startUTC = new Date(start.getTime());
    const endUTC = new Date(end.getTime());
    
    // Add a small buffer to handle timezone edge cases
    endUTC.setHours(23, 59, 59, 999);

    const transactions = await prisma.transaction.findMany({
      where: {
        date: {
          gte: startUTC,
          lte: endUTC,
        },
      },
      include: {
        payer: true,
      },
    });

    console.log('Monthly report query:', {
      monthOffset,
      reportDate: reportDate.toISOString(),
      start: startUTC.toISOString(),
      end: endUTC.toISOString(),
      foundTransactions: transactions.length,
      transactionDates: transactions.map(t => t.date.toISOString()),
    });

    const totalSpend = transactions.reduce((sum, t) => sum + t.amountSGD, 0);
    const bryanPaid = transactions
      .filter((t) => t.payer.role === 'Bryan')
      .reduce((sum, t) => sum + t.amountSGD, 0);
    const hweiYeenPaid = transactions
      .filter((t) => t.payer.role === 'HweiYeen')
      .reduce((sum, t) => sum + t.amountSGD, 0);

    // Top categories
    const categoryMap: { [key: string]: number } = {};
    transactions.forEach((t) => {
      const cat = t.category || 'Other';
      categoryMap[cat] = (categoryMap[cat] || 0) + t.amountSGD;
    });

    const topCategories = Object.entries(categoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    return {
      totalSpend,
      bryanPaid,
      hweiYeenPaid,
      transactionCount: transactions.length,
      topCategories,
    };
  }

  /**
   * Format outstanding balance message
   */
  async getOutstandingBalanceMessage(): Promise<string> {
    const balance = await this.calculateOutstandingBalance();

    if (balance.bryanOwes === 0 && balance.hweiYeenOwes === 0) {
      return '✅ All expenses are settled! No outstanding balance.';
    }

    let message = '💰 **Outstanding (amount owed):**\n';
    
    if (balance.bryanOwes > 0 && balance.hweiYeenOwes > 0) {
      // Both owe each other (shouldn't happen with 70/30 split, but handle it)
      message += `Sir Bryan owes: SGD $${balance.bryanOwes.toFixed(2)}\n`;
      message += `Madam Hwei Yeen owes: SGD $${balance.hweiYeenOwes.toFixed(2)}\n`;
    } else if (balance.bryanOwes > 0) {
      message += `Sir Bryan owes Madam Hwei Yeen SGD $${balance.bryanOwes.toFixed(2)}\n`;
    } else if (balance.hweiYeenOwes > 0) {
      message += `Madam Hwei Yeen owes Sir Bryan SGD $${balance.hweiYeenOwes.toFixed(2)}\n`;
    }

    return message;
  }
}






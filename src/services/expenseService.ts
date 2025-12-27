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
    let bryanShare = 0;
    let hweiYeenShare = 0;

    transactions.forEach((t) => {
      if (t.payerId === bryan.id) {
        bryanPaid += t.amountSGD;
      } else if (t.payerId === hweiYeen.id) {
        hweiYeenPaid += t.amountSGD;
      }
      
      // Use custom split if available, otherwise default to 70/30
      // @ts-ignore - These fields may need to be added to the schema
      const bryanPercent = (t as any).bryanPercentage ?? 0.7;
      // @ts-ignore
      const hweiYeenPercent = (t as any).hweiYeenPercentage ?? 0.3;
      
      bryanShare += t.amountSGD * bryanPercent;
      hweiYeenShare += t.amountSGD * hweiYeenPercent;
    });

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
    bryanCategories: { category: string; amount: number }[];
    hweiYeenCategories: { category: string; amount: number }[];
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
    const bryanTransactions = transactions.filter((t) => t.payer.role === 'Bryan');
    const hweiYeenTransactions = transactions.filter((t) => t.payer.role === 'HweiYeen');
    
    const bryanPaid = bryanTransactions.reduce((sum, t) => sum + t.amountSGD, 0);
    const hweiYeenPaid = hweiYeenTransactions.reduce((sum, t) => sum + t.amountSGD, 0);

    // Top categories (overall)
    const categoryMap: { [key: string]: number } = {};
    transactions.forEach((t) => {
      const cat = t.category || 'Other';
      categoryMap[cat] = (categoryMap[cat] || 0) + t.amountSGD;
    });

    const topCategories = Object.entries(categoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Bryan's categories - calculate his share of all transactions by category
    const bryanCategoryMap: { [key: string]: number } = {};
    transactions.forEach((t) => {
      const cat = t.category || 'Other';
      // Use custom split if available, otherwise default to 70%
      // @ts-ignore - These fields may need to be added to the schema
      const bryanPercent = (t as any).bryanPercentage ?? 0.7;
      const bryanShare = t.amountSGD * bryanPercent;
      bryanCategoryMap[cat] = (bryanCategoryMap[cat] || 0) + bryanShare;
    });

    const bryanCategories = Object.entries(bryanCategoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Hwei Yeen's categories - calculate her share of all transactions by category
    const hweiYeenCategoryMap: { [key: string]: number } = {};
    transactions.forEach((t) => {
      const cat = t.category || 'Other';
      // Use custom split if available, otherwise default to 30%
      // @ts-ignore - These fields may need to be added to the schema
      const hweiYeenPercent = (t as any).hweiYeenPercentage ?? 0.3;
      const hweiYeenShare = t.amountSGD * hweiYeenPercent;
      hweiYeenCategoryMap[cat] = (hweiYeenCategoryMap[cat] || 0) + hweiYeenShare;
    });

    const hweiYeenCategories = Object.entries(hweiYeenCategoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    return {
      totalSpend,
      bryanPaid,
      hweiYeenPaid,
      transactionCount: transactions.length,
      topCategories,
      bryanCategories,
      hweiYeenCategories,
    };
  }

  /**
   * Calculate amount owed from a single transaction
   * Returns: { bryanOwes: number, hweiYeenOwes: number }
   */
  calculateTransactionOwed(
    amount: number, 
    payerRole: 'Bryan' | 'HweiYeen',
    bryanPercentage?: number,
    hweiYeenPercentage?: number
  ): {
    bryanOwes: number;
    hweiYeenOwes: number;
  } {
    // Use custom split if provided, otherwise default to 70/30
    const bryanPercent = bryanPercentage ?? 0.7;
    const hweiYeenPercent = hweiYeenPercentage ?? 0.3;
    
    const bryanShare = amount * bryanPercent;
    const hweiYeenShare = amount * hweiYeenPercent;

    let bryanOwes = 0;
    let hweiYeenOwes = 0;

    if (payerRole === 'Bryan') {
      // Bryan paid, so HweiYeen owes Bryan her share
      hweiYeenOwes = hweiYeenShare;
    } else {
      // HweiYeen paid, so Bryan owes HweiYeen his share
      bryanOwes = bryanShare;
    }

    return { bryanOwes, hweiYeenOwes };
  }

  /**
   * Format transaction-specific amount owed message
   */
  getTransactionOwedMessage(
    amount: number, 
    payerRole: 'Bryan' | 'HweiYeen',
    bryanPercentage?: number,
    hweiYeenPercentage?: number
  ): string {
    const owed = this.calculateTransactionOwed(amount, payerRole, bryanPercentage, hweiYeenPercentage);
    
    if (owed.bryanOwes > 0) {
      return `From this transaction: Bryan owes Hwei Yeen SGD $${owed.bryanOwes.toFixed(2)}`;
    } else if (owed.hweiYeenOwes > 0) {
      return `From this transaction: Hwei Yeen owes Bryan SGD $${owed.hweiYeenOwes.toFixed(2)}`;
    }
    
    return '';
  }

  /**
   * Get all pending (unsettled) transactions
   */
  async getAllPendingTransactions(): Promise<Array<{
    id: bigint;
    amount: number;
    currency: string;
    category: string;
    description: string;
    date: Date;
    payerName: string;
    payerRole: string;
    bryanOwes: number;
    hweiYeenOwes: number;
  }>> {
    const transactions = await prisma.transaction.findMany({
      where: {
        isSettled: false,
      },
      include: {
        payer: true,
      },
      orderBy: {
        date: 'desc',
      },
    });

    return transactions.map(t => {
      // @ts-ignore - These fields may need to be added to the schema
      const bryanPercent = (t as any).bryanPercentage;
      // @ts-ignore
      const hweiYeenPercent = (t as any).hweiYeenPercentage;
      const owed = this.calculateTransactionOwed(
        t.amountSGD, 
        t.payer.role as 'Bryan' | 'HweiYeen',
        bryanPercent,
        hweiYeenPercent
      );
      return {
        id: t.id,
        amount: t.amountSGD,
        currency: t.currency,
        category: t.category || 'Other',
        description: t.description || 'No description',
        date: t.date,
        payerName: t.payer.name,
        payerRole: t.payer.role,
        bryanOwes: owed.bryanOwes,
        hweiYeenOwes: owed.hweiYeenOwes,
      };
    });
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
      message += `Bryan owes: SGD $${balance.bryanOwes.toFixed(2)}\n`;
      message += `Hwei Yeen owes: SGD $${balance.hweiYeenOwes.toFixed(2)}\n`;
    } else if (balance.bryanOwes > 0) {
      message += `Bryan owes Hwei Yeen SGD $${balance.bryanOwes.toFixed(2)}\n`;
    } else if (balance.hweiYeenOwes > 0) {
      message += `Hwei Yeen owes Bryan SGD $${balance.hweiYeenOwes.toFixed(2)}\n`;
    }

    return message;
  }
}






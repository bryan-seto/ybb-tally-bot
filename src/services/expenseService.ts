import { getStartOfMonth, getEndOfMonth, getMonthsAgo, formatDate } from '../utils/dateHelpers';
import { prisma } from '../lib/prisma';
import { getUserNameByRole, USER_A_ROLE_KEY, USER_B_ROLE_KEY } from '../config';
import { SplitRulesService } from './splitRulesService';
import { analyticsBus, AnalyticsEventType } from '../events/analyticsBus';

export class ExpenseService {
  private splitRulesService: SplitRulesService;

  constructor(splitRulesService?: SplitRulesService) {
    // Allow injection for testing, or create default instance
    this.splitRulesService = splitRulesService || new SplitRulesService();
  }
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
      
      // Use custom split if available, otherwise default to 50/50
      const bryanPercent = t.bryanPercentage ?? 0.5;
      const hweiYeenPercent = t.hweiYeenPercentage ?? 0.5;
      
      bryanShare += t.amountSGD * bryanPercent;
      hweiYeenShare += t.amountSGD * hweiYeenPercent;
    });

    const bryanOwes = Math.max(0, bryanShare - bryanPaid);
    const hweiYeenOwes = Math.max(0, hweiYeenShare - hweiYeenPaid);

    return { bryanOwes, hweiYeenOwes };
  }

  /**
   * Calculate detailed balance with weighted averages
   * Returns detailed balance information including net amounts and weighted percentages
   */
  async calculateDetailedBalance(): Promise<{
    bryanPaid: number;
    hweiYeenPaid: number;
    bryanShare: number;
    hweiYeenShare: number;
    totalSpending: number;
    avgBryanPercent: number;
    avgHweiYeenPercent: number;
    bryanNet: number;
    hweiYeenNet: number;
  }> {
    // Get users
    const bryan = await prisma.user.findFirst({
      where: { role: 'Bryan' },
    });
    const hweiYeen = await prisma.user.findFirst({
      where: { role: 'HweiYeen' },
    });

    if (!bryan || !hweiYeen) {
      // Return zeros with default percentages when users not found
      return {
        bryanPaid: 0,
        hweiYeenPaid: 0,
        bryanShare: 0,
        hweiYeenShare: 0,
        totalSpending: 0,
        avgBryanPercent: 50,
        avgHweiYeenPercent: 50,
        bryanNet: 0,
        hweiYeenNet: 0,
      };
    }

    // Get all unsettled transactions
    const transactions = await prisma.transaction.findMany({
      where: {
        isSettled: false,
      },
      include: {
        payer: true,
      },
    });

    let bryanPaid = 0;
    let hweiYeenPaid = 0;
    let bryanShare = 0;
    let hweiYeenShare = 0;
    let totalAmount = 0;
    let weightedBryanPercent = 0;
    let weightedHweiYeenPercent = 0;

    transactions.forEach((t) => {
      if (t.payerId === bryan.id) {
        bryanPaid += t.amountSGD;
      } else if (t.payerId === hweiYeen.id) {
        hweiYeenPaid += t.amountSGD;
      }

      const bryanPercent = t.bryanPercentage ?? 0.5;
      const hweiYeenPercent = t.hweiYeenPercentage ?? 0.5;

      bryanShare += t.amountSGD * bryanPercent;
      hweiYeenShare += t.amountSGD * hweiYeenPercent;

      totalAmount += t.amountSGD;
      weightedBryanPercent += t.amountSGD * bryanPercent;
      weightedHweiYeenPercent += t.amountSGD * hweiYeenPercent;
    });

    const avgBryanPercent = totalAmount > 0 ? (weightedBryanPercent / totalAmount) * 100 : 50;
    const avgHweiYeenPercent = totalAmount > 0 ? (weightedHweiYeenPercent / totalAmount) * 100 : 50;
    const totalSpending = bryanPaid + hweiYeenPaid;
    const bryanNet = bryanPaid - bryanShare;
    const hweiYeenNet = hweiYeenPaid - hweiYeenShare;

    return {
      bryanPaid,
      hweiYeenPaid,
      bryanShare,
      hweiYeenShare,
      totalSpending,
      avgBryanPercent,
      avgHweiYeenPercent,
      bryanNet,
      hweiYeenNet,
    };
  }

  /**
   * Get detailed balance message with full summary
   */
  async getDetailedBalanceMessage(): Promise<string> {
    const balance = await this.calculateDetailedBalance();

    const userAName = getUserNameByRole(USER_A_ROLE_KEY);
    const userBName = getUserNameByRole(USER_B_ROLE_KEY);
    
    let message = `💰 **Balance Summary**\n\n`;
    message += `Total Paid by ${userAName} (Unsettled): SGD $${balance.bryanPaid.toFixed(2)}\n`;
    message += `Total Paid by ${userBName} (Unsettled): SGD $${balance.hweiYeenPaid.toFixed(2)}\n`;
    message += `Total Group Spending: SGD $${balance.totalSpending.toFixed(2)}\n\n`;
    message += `**Split Calculation (${balance.avgBryanPercent.toFixed(0)}/${balance.avgHweiYeenPercent.toFixed(0)}):**\n`;
    message += `${userAName}'s share (${balance.avgBryanPercent.toFixed(0)}%): SGD $${balance.bryanShare.toFixed(2)}\n`;
    message += `${userBName}'s share (${balance.avgHweiYeenPercent.toFixed(0)}%): SGD $${balance.hweiYeenShare.toFixed(2)}\n\n`;

    if (balance.bryanNet > 0) {
      message += `👉 ${userBName} owes ${userAName}: SGD $${balance.bryanNet.toFixed(2)}`;
    } else if (balance.hweiYeenNet > 0) {
      message += `👉 ${userAName} owes ${userBName}: SGD $${balance.hweiYeenNet.toFixed(2)}`;
    } else if (balance.bryanNet < 0) {
      message += `👉 ${userAName} owes ${userBName}: SGD $${Math.abs(balance.bryanNet).toFixed(2)}`;
    } else if (balance.hweiYeenNet < 0) {
      message += `👉 ${userBName} owes ${userAName}: SGD $${Math.abs(balance.hweiYeenNet).toFixed(2)}`;
    } else {
      message += `✅ All settled!`;
    }

    return message;
  }

  /**
   * Format monthly report message with category percentages
   */
  formatMonthlyReportMessage(
    report: {
      totalSpend: number;
      bryanPaid: number;
      hweiYeenPaid: number;
      transactionCount: number;
      topCategories: { category: string; amount: number }[];
      bryanCategories: { category: string; amount: number }[];
      hweiYeenCategories: { category: string; amount: number }[];
    },
    monthName: string,
    chartUrl: string
  ): string {
    const userAName = getUserNameByRole(USER_A_ROLE_KEY);
    const userBName = getUserNameByRole(USER_B_ROLE_KEY);
    
    const message =
      `📊 **Monthly Report - ${monthName}**\n\n` +
      `Total Spend: SGD $${report.totalSpend.toFixed(2)}\n` +
      `Transactions: ${report.transactionCount}\n\n` +
      `**Top Categories - ${userAName}:**\n` +
      (report.bryanCategories.length > 0
        ? report.bryanCategories
            .map((c) => {
              const percentage = report.bryanPaid > 0 
                ? Math.round((c.amount / report.bryanPaid) * 100) 
                : 0;
              return `${c.category}: SGD $${c.amount.toFixed(2)} (${percentage}%)`;
            })
            .join('\n')
        : 'No categories found') +
      `\n\n**Top Categories - ${userBName}:**\n` +
      (report.hweiYeenCategories.length > 0
        ? report.hweiYeenCategories
            .map((c) => {
              const percentage = report.hweiYeenPaid > 0 
                ? Math.round((c.amount / report.hweiYeenPaid) * 100) 
                : 0;
              return `${c.category}: SGD $${c.amount.toFixed(2)} (${percentage}%)`;
            })
            .join('\n')
        : 'No categories found') +
      `\n\n[View Chart](${chartUrl})`;

    return message;
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
      // Use custom split if available, otherwise default to 50%
      const bryanPercent = t.bryanPercentage ?? 0.5;
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
      // Use custom split if available, otherwise default to 50%
      const hweiYeenPercent = t.hweiYeenPercentage ?? 0.5;
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
    // Use custom split if provided, otherwise default to 50/50
    const bryanPercent = bryanPercentage ?? 0.5;
    const hweiYeenPercent = hweiYeenPercentage ?? 0.5;
    
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
      // Convert null to undefined for TypeScript compatibility
      const bryanPercent = t.bryanPercentage ?? undefined;
      const hweiYeenPercent = t.hweiYeenPercentage ?? undefined;
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

    // Guard clause: Happy path - all settled
    if (balance.bryanOwes === 0 && balance.hweiYeenOwes === 0) {
      return '✅ All expenses are settled! No outstanding balance.';
    }

    const userAName = getUserNameByRole(USER_A_ROLE_KEY);
    const userBName = getUserNameByRole(USER_B_ROLE_KEY);
    
    // Guard clause: Both owe each other (edge case)
    if (balance.bryanOwes > 0 && balance.hweiYeenOwes > 0) {
      return '💰 **Outstanding (amount owed):**\n' +
        `${userAName} owes: SGD $${balance.bryanOwes.toFixed(2)}\n` +
        `${userBName} owes: SGD $${balance.hweiYeenOwes.toFixed(2)}\n`;
    }

    // Guard clause: User A owes User B
    if (balance.bryanOwes > 0) {
      return '💰 **Outstanding (amount owed):**\n' +
        `${userAName} owes ${userBName} SGD $${balance.bryanOwes.toFixed(2)}\n`;
    }

    // Guard clause: User B owes User A
    if (balance.hweiYeenOwes > 0) {
      return '💰 **Outstanding (amount owed):**\n' +
        `${userBName} owes ${userAName} SGD $${balance.hweiYeenOwes.toFixed(2)}\n`;
    }

    // Fallback (should never reach here, but for safety)
    return '💰 **Outstanding (amount owed):**\n';
  }

  /**
   * Create a smart expense with category-based split rules
   * Returns: { transaction, balanceMessage }
   */
  async createSmartExpense(
    userId: bigint,
    amount: number,
    category: string,
    description: string
  ): Promise<{
    transaction: any;
    balanceMessage: string;
  }> {
    console.log('[DEBUG] createSmartExpense args:', { 
      userId: userId.toString(), 
      amount, 
      category, 
      description 
    });
    
    // Get split rule from service (configurable, database-backed)
    console.log('[DEBUG] createSmartExpense: Looking up split rule for category:', category);
    const splitRule = await this.splitRulesService.getSplitRule(category);
    console.log('[DEBUG] createSmartExpense: Split rule result:', splitRule);
    
    // Map generic userA/userB to domain-specific bryan/hwei
    const split = {
      bryan: splitRule.userAPercent,
      hwei: splitRule.userBPercent,
    };

    // Look up the user/payer
    console.log('[DEBUG] createSmartExpense: Looking up user:', userId.toString());
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    console.log('[DEBUG] createSmartExpense: User lookup result:', user ? { id: user.id.toString(), name: user.name, role: user.role } : 'NOT FOUND');

    if (!user) {
      throw new Error(`User with id ${userId} not found`);
    }

    // Create the transaction
    const transactionData = {
      amountSGD: amount,
      currency: 'SGD',
      category: category || 'Other',
      description: description || 'No description',
      payerId: userId,
      date: new Date(),
      bryanPercentage: split.bryan,
      hweiYeenPercentage: split.hwei,
    };
    console.log('[DEBUG] createSmartExpense: Creating transaction with data:', {
      ...transactionData,
      payerId: transactionData.payerId.toString(),
      date: transactionData.date.toISOString()
    });
    const transaction = await prisma.transaction.create({
      data: transactionData,
      include: {
        payer: true,
      },
    });
    console.log('[DEBUG] createSmartExpense: Transaction created successfully:', {
      id: transaction.id.toString(),
      amount: transaction.amountSGD,
      category: transaction.category
    });

    // Emit analytics event
    analyticsBus.emit(AnalyticsEventType.TRANSACTION_CREATED, {
      userId,
      transactionId: transaction.id,
      amount: transaction.amountSGD,
      category: transaction.category || 'Other',
      description: transaction.description,
    });

    // Get the updated balance message
    const balanceMessage = await this.getOutstandingBalanceMessage();

    return { transaction, balanceMessage };
  }

  /**
   * Get a fun confirmation message based on category
   * Returns a randomized emoji/text string
   */
  getFunConfirmation(category: string): string {
    const confirmations: Record<string, string[]> = {
      'Food': ['Yum! 🍜', 'Delicious! 🍕', 'Bon appétit! 🍽️', 'Tasty! 🥘'],
      'Bills': ['💸 Money flies!', '💰 Bills paid!', '💳 Charged!', '📄 Documented!'],
      'Travel': ['✈️ Adventure awaits!', '🌍 Exploring!', '🎒 Packed!', '🗺️ Journey logged!'],
      'Groceries': ['🛒 Stocked up!', '🥬 Fresh groceries!', '📦 Supplies added!', '🍎 Healthy choice!'],
      'Shopping': ['🛍️ Shopping spree!', '💼 Purchase logged!', '🎁 New item!', '✨ Added to collection!'],
      'Transport': ['🚗 On the move!', '🚇 Commute logged!', '🚌 Trip recorded!', '🛵 Ride saved!'],
      'Entertainment': ['🎬 Fun times!', '🎮 Game on!', '🎭 Entertainment logged!', '🎪 Enjoyment saved!'],
      'Medical': ['🏥 Health expense!', '💊 Medical logged!', '🩺 Care recorded!', '❤️ Wellness tracked!'],
      'Other': ['✅ Recorded!', '📝 Saved!', '💼 Logged!', '✨ Added!'],
    };

    const options = confirmations[category] || confirmations['Other'];
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * Automatically record transactions extracted by AI
   */
  async recordAISavedTransactions(receiptData: any, userId: bigint) {
    // Ensure user exists in User table before creating transactions
    // The userId comes from ctx.from.id (the person who sent the photo)
    // Only USER_A_ID and USER_B_ID are initialized in the database
    // If someone else (like BACKUP_RECIPIENT_ID) sends a photo, their userId won't exist
    // So we check if the user exists, and if not, use Bryan (USER_A) as the default payer
    let payerId = userId;
    try {
      const userExists = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      
      if (!userExists) {
        // User doesn't exist - find first available user (fallback to USER_A/Bryan)
        const defaultUser = await prisma.user.findFirst({
          where: { role: 'Bryan' },
          select: { id: true },
        });
        if (defaultUser) {
          payerId = defaultUser.id;
          console.log(`[ExpenseService] User ${userId} not found in database, using default user (Bryan) as payer`);
        } else {
          throw new Error(`User ${userId} does not exist and no default user found`);
        }
      }
    } catch (error) {
      console.error('Error checking/creating user:', error);
      throw error;
    }
    
    const savedTransactions: Array<{
      id: bigint;
      createdAt: Date;
      updatedAt: Date;
      amountSGD: number;
      currency: string;
      category: string | null;
      description: string | null;
      payerId: bigint;
      date: Date;
      isSettled: boolean;
      bryanPercentage: number | null;
      hweiYeenPercentage: number | null;
      payer: {
        id: bigint;
        name: string;
        role: string;
        createdAt: Date;
        updatedAt: Date;
      };
    }> = [];
    
    // Ensure we have a list of transactions to process
    const items = receiptData.transactions || (receiptData.total ? [{
      amount: receiptData.total,
      merchant: receiptData.merchant || 'Unknown Merchant',
      category: receiptData.category || 'Other',
      date: receiptData.date
    }] : []);

    for (const item of items) {
      // Get split rule for this category
      const splitRuleForItem = await this.splitRulesService.getSplitRule(item.category || 'Other');
      
      const tx = await prisma.transaction.create({
        data: {
          amountSGD: item.amount,
          currency: 'SGD',
          category: item.category || 'Other',
          description: item.merchant || 'Unknown Merchant',
          payerId: payerId,
          date: item.date ? new Date(item.date) : new Date(),
          bryanPercentage: splitRuleForItem.userAPercent,
          hweiYeenPercentage: splitRuleForItem.userBPercent,
        },
        include: {
          payer: true
        }
      });
      savedTransactions.push(tx);

      // Emit analytics event for each transaction
      analyticsBus.emit(AnalyticsEventType.TRANSACTION_CREATED, {
        userId,
        transactionId: tx.id,
        amount: tx.amountSGD,
        category: tx.category || 'Other',
        description: tx.description,
      });
    }

    // Get the updated balance message
    const balanceMessage = await this.getOutstandingBalanceMessage();
    
    return { savedTransactions, balanceMessage };
  }
}






import { getStartOfMonth, getEndOfMonth, getMonthsAgo, formatDate } from '../utils/dateHelpers';
import { prisma } from '../lib/prisma';

export class ExpenseService {
  /**
   * Calculate outstanding balance for a group
   * Returns balances for all members showing who owes whom
   */
  async calculateGroupBalance(groupId: bigint): Promise<{
    memberBalances: Array<{
      userId: bigint;
      userName: string;
      paid: number;
      owes: number;
      isOwed: number;
      netBalance: number; // positive = others owe them, negative = they owe others
    }>;
    totalSpending: number;
  }> {
    // Get all unsettled expenses for this group
    const expenses = await prisma.expense.findMany({
      where: {
        groupId,
        isSettled: false,
      },
      include: {
        splits: {
          include: {
            debtor: true,
            virtualDebtor: true,
          },
        },
        group: {
          include: {
            members: true,
          },
        },
      },
    });

    // Initialize balance tracking for all members
    const memberMap = new Map<bigint, {
      userId: bigint;
      userName: string;
      paid: number;
      owes: number;
      isOwed: number;
    }>();

    // Initialize all group members
    const group = expenses[0]?.group;
    if (group) {
      group.members.forEach(member => {
        memberMap.set(member.id, {
          userId: member.id,
          userName: member.name,
          paid: 0,
          owes: 0,
          isOwed: 0,
        });
      });
    }

    // Calculate balances
    expenses.forEach(expense => {
      // Track what the payer paid
      if (expense.payerType === 'real') {
        const payer = memberMap.get(expense.payerId);
        if (payer) {
          payer.paid += expense.amountSGD;
        }
      }

      // Track what each debtor owes
      expense.splits.forEach(split => {
        const debtorId = split.debtorId || split.virtualDebtorId;
        if (!debtorId) return;

        const debtor = memberMap.get(debtorId);
        if (debtor) {
          // If this debtor is the payer, they don't owe themselves
          if (expense.payerType === 'real' && expense.payerId === debtorId) {
            // Payer doesn't owe their own share
            // But others owe the payer
            // This is handled below
          } else {
            // This debtor owes their share
            debtor.owes += split.amount;
            
            // The payer is owed this amount
            if (expense.payerType === 'real') {
              const payer = memberMap.get(expense.payerId);
              if (payer) {
                payer.isOwed += split.amount;
              }
            }
          }
        }
      });
    });

    // Calculate net balance and format
    const memberBalances = Array.from(memberMap.values()).map(member => ({
      ...member,
      netBalance: member.isOwed - member.owes, // positive = others owe them
    }));

    const totalSpending = expenses.reduce((sum, e) => sum + e.amountSGD, 0);

    return {
      memberBalances: memberBalances.sort((a, b) => b.netBalance - a.netBalance),
      totalSpending,
    };
  }

  /**
   * Get monthly report for a group
   */
  async getGroupMonthlyReport(groupId: bigint, monthOffset: number = 1): Promise<{
    totalSpend: number;
    expenseCount: number;
    topCategories: { category: string; amount: number }[];
    memberSpending: Array<{
      userId: bigint;
      userName: string;
      paid: number;
      share: number;
      categories: { category: string; amount: number }[];
    }>;
  }> {
    const reportDate = getMonthsAgo(monthOffset);
    const start = getStartOfMonth(reportDate);
    const end = getEndOfMonth(reportDate);
    end.setHours(23, 59, 59, 999);

    const expenses = await prisma.expense.findMany({
      where: {
        groupId,
        date: {
          gte: start,
          lte: end,
        },
      },
      include: {
        splits: {
          include: {
            debtor: true,
            virtualDebtor: true,
          },
        },
        group: {
          include: {
            members: true,
          },
        },
      },
    });

    const totalSpend = expenses.reduce((sum, e) => sum + e.amountSGD, 0);

    // Top categories (overall)
    const categoryMap: { [key: string]: number } = {};
    expenses.forEach((e) => {
      const cat = e.category || 'Other';
      categoryMap[cat] = (categoryMap[cat] || 0) + e.amountSGD;
    });

    const topCategories = Object.entries(categoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Member spending breakdown
    const memberMap = new Map<bigint, {
      userId: bigint;
      userName: string;
      paid: number;
      share: number;
      categoryMap: { [key: string]: number };
    }>();

    // Initialize all group members
    const group = expenses[0]?.group;
    if (group) {
      group.members.forEach(member => {
        memberMap.set(member.id, {
          userId: member.id,
          userName: member.name,
          paid: 0,
          share: 0,
          categoryMap: {},
        });
      });
    }

    // Calculate member spending
    expenses.forEach(expense => {
      // Track what payer paid
      if (expense.payerType === 'real') {
        const payer = memberMap.get(expense.payerId);
        if (payer) {
          payer.paid += expense.amountSGD;
          const cat = expense.category || 'Other';
          payer.categoryMap[cat] = (payer.categoryMap[cat] || 0) + expense.amountSGD;
        }
      }

      // Track each member's share
      expense.splits.forEach(split => {
        const debtorId = split.debtorId || split.virtualDebtorId;
        if (!debtorId) return;

        const debtor = memberMap.get(debtorId);
        if (debtor) {
          debtor.share += split.amount;
          const cat = expense.category || 'Other';
          debtor.categoryMap[cat] = (debtor.categoryMap[cat] || 0) + split.amount;
        }
      });
    });

    const memberSpending = Array.from(memberMap.values()).map(member => ({
      userId: member.userId,
      userName: member.userName,
      paid: member.paid,
      share: member.share,
      categories: Object.entries(member.categoryMap)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
    }));

    return {
      totalSpend,
      expenseCount: expenses.length,
      topCategories,
      memberSpending,
    };
  }

  /**
   * Get all pending (unsettled) expenses for a group
   */
  async getGroupPendingExpenses(groupId: bigint): Promise<Array<{
    id: bigint;
    amount: number;
    currency: string;
    category: string;
    description: string;
    date: Date;
    payerName: string;
    splitCount: number;
  }>> {
    const expenses = await prisma.expense.findMany({
      where: {
        groupId,
        isSettled: false,
      },
      include: {
        splits: true,
        group: {
          include: {
            members: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
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
        amount: e.amountSGD,
        currency: e.currency,
        category: e.category || 'Other',
        description: e.description || 'No description',
        date: e.date,
        payerName,
        splitCount: e.splits.length,
      };
    });
  }

  /**
   * Format group balance message
   */
  async getGroupBalanceMessage(groupId: bigint): Promise<string> {
    const balance = await this.calculateGroupBalance(groupId);

    if (balance.memberBalances.length === 0) {
      return '✅ No expenses recorded yet.';
    }

    let message = `💰 **Balance Summary**\n\n`;
    message += `Total Group Spending: SGD $${balance.totalSpending.toFixed(2)}\n\n`;

    // Show individual balances
    message += `**Individual Balances:**\n`;
    balance.memberBalances.forEach(member => {
      if (Math.abs(member.netBalance) > 0.01) {
        if (member.netBalance > 0) {
          message += `• ${member.userName}: Owed SGD $${member.netBalance.toFixed(2)}\n`;
        } else {
          message += `• ${member.userName}: Owes SGD $${Math.abs(member.netBalance).toFixed(2)}\n`;
        }
      } else {
        message += `• ${member.userName}: Settled ✅\n`;
      }
    });

    message += `\n**Who owes whom:**\n\n`;

    // Show who owes whom (simplified - show net balances)
    const debtors = balance.memberBalances.filter(m => m.netBalance < -0.01);
    const creditors = balance.memberBalances.filter(m => m.netBalance > 0.01);

    if (debtors.length === 0 && creditors.length === 0) {
      message += `✅ All settled!`;
      return message;
    }

    // Match debtors to creditors
    const sortedDebtors = [...debtors].sort((a, b) => a.netBalance - b.netBalance); // Most negative first
    const sortedCreditors = [...creditors].sort((a, b) => b.netBalance - a.netBalance); // Most positive first

    let debtorIndex = 0;
    let creditorIndex = 0;
    const debtorBalances = sortedDebtors.map(d => ({ ...d, remaining: Math.abs(d.netBalance) }));
    const creditorBalances = sortedCreditors.map(c => ({ ...c, remaining: c.netBalance }));

    while (debtorIndex < debtorBalances.length && creditorIndex < creditorBalances.length) {
      const debtor = debtorBalances[debtorIndex];
      const creditor = creditorBalances[creditorIndex];
      
      if (debtor.remaining < 0.01) {
        debtorIndex++;
        continue;
      }
      if (creditor.remaining < 0.01) {
        creditorIndex++;
        continue;
      }
      
      const amount = Math.min(debtor.remaining, creditor.remaining);
      
      if (amount > 0.01) {
        message += `👉 ${debtor.userName} owes ${creditor.userName}: SGD $${amount.toFixed(2)}\n`;
        
        debtor.remaining -= amount;
        creditor.remaining -= amount;
      } else {
        break;
      }
    }

    return message;
  }

  // Legacy methods for backward compatibility (VIP users)
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
      const bryanPercent = t.bryanPercentage ?? 0.7;
      const hweiYeenPercent = t.hweiYeenPercentage ?? 0.3;
      
      bryanShare += t.amountSGD * bryanPercent;
      hweiYeenShare += t.amountSGD * hweiYeenPercent;
    });

    const bryanOwes = Math.max(0, bryanShare - bryanPaid);
    const hweiYeenOwes = Math.max(0, hweiYeenShare - hweiYeenPaid);

    return { bryanOwes, hweiYeenOwes };
  }

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

    const startUTC = new Date(start.getTime());
    const endUTC = new Date(end.getTime());
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

    // Bryan's categories
    const bryanCategoryMap: { [key: string]: number } = {};
    transactions.forEach((t) => {
      const cat = t.category || 'Other';
      const bryanPercent = t.bryanPercentage ?? 0.7;
      const bryanShare = t.amountSGD * bryanPercent;
      bryanCategoryMap[cat] = (bryanCategoryMap[cat] || 0) + bryanShare;
    });

    const bryanCategories = Object.entries(bryanCategoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Hwei Yeen's categories
    const hweiYeenCategoryMap: { [key: string]: number } = {};
    transactions.forEach((t) => {
      const cat = t.category || 'Other';
      const hweiYeenPercent = t.hweiYeenPercentage ?? 0.3;
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

  calculateTransactionOwed(
    amount: number, 
    payerRole: 'Bryan' | 'HweiYeen',
    bryanPercentage?: number,
    hweiYeenPercentage?: number
  ): {
    bryanOwes: number;
    hweiYeenOwes: number;
  } {
    const bryanPercent = bryanPercentage ?? 0.7;
    const hweiYeenPercent = hweiYeenPercentage ?? 0.3;
    
    const bryanShare = amount * bryanPercent;
    const hweiYeenShare = amount * hweiYeenPercent;

    let bryanOwes = 0;
    let hweiYeenOwes = 0;

    if (payerRole === 'Bryan') {
      hweiYeenOwes = hweiYeenShare;
    } else {
      bryanOwes = bryanShare;
    }

    return { bryanOwes, hweiYeenOwes };
  }

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
        payerRole: t.payer.role || 'Unknown',
        bryanOwes: owed.bryanOwes,
        hweiYeenOwes: owed.hweiYeenOwes,
      };
    });
  }

  async getOutstandingBalanceMessage(): Promise<string> {
    const balance = await this.calculateOutstandingBalance();

    if (balance.bryanOwes === 0 && balance.hweiYeenOwes === 0) {
      return '✅ All expenses are settled! No outstanding balance.';
    }

    let message = '💰 **Outstanding (amount owed):**\n';
    
    if (balance.bryanOwes > 0 && balance.hweiYeenOwes > 0) {
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

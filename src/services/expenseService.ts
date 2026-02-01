import { formatDate } from '../utils/dateHelpers';
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
   * Calculate net outstanding balance using pure tabulation approach
   * Uses ALL transactions (expenses + payments) regardless of settled status
   * Returns: { bryanOwes: number, hweiYeenOwes: number, netOutstanding: number, whoOwes: 'Bryan' | 'HweiYeen' | null }
   */
  async calculateNetBalance(): Promise<{
    bryanOwes: number;
    hweiYeenOwes: number;
    netOutstanding: number;
    whoOwes: 'Bryan' | 'HweiYeen' | null;
    whoIsOwed: 'Bryan' | 'HweiYeen' | null;
  }> {
    // #region agent log
    const dbUrl = process.env.DATABASE_URL || 'NOT_SET';
    const dbUrlMasked = dbUrl.includes('@') ? dbUrl.split('@')[1] : dbUrl.substring(0, 50);
    fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/expenseService.ts:19',message:'calculateNetBalance: Entry',data:{databaseUrl:dbUrlMasked,nodeEnv:process.env.NODE_ENV},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    // Get users
    const bryan = await prisma.user.findFirst({
      where: { role: 'Bryan' },
    });
    const hweiYeen = await prisma.user.findFirst({
      where: { role: 'HweiYeen' },
    });

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/expenseService.ts:33',message:'calculateNetBalance: User lookup result',data:{bryanFound:!!bryan,bryanId:bryan?.id?.toString(),hweiYeenFound:!!hweiYeen,hweiYeenId:hweiYeen?.id?.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion

    if (!bryan || !hweiYeen) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/expenseService.ts:35',message:'calculateNetBalance: Users not found, returning zeros',data:{bryanFound:!!bryan,hweiYeenFound:!!hweiYeen},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      return { 
        bryanOwes: 0, 
        hweiYeenOwes: 0, 
        netOutstanding: 0,
        whoOwes: null,
        whoIsOwed: null
      };
    }

    // Get ALL transactions (expenses + payments) - pure tabulation approach
    // Note: transactionType field will be added via migration, for now we check category
    const allTransactions = await prisma.transaction.findMany({});
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/expenseService.ts:46',message:'calculateNetBalance: Transaction query result',data:{transactionCount:allTransactions.length,transactions:allTransactions.map(t=>({id:t.id.toString(),amountSGD:t.amountSGD,category:t.category,payerId:t.payerId.toString(),bryanPercent:t.bryanPercentage,hweiYeenPercent:t.hweiYeenPercentage})),databaseUrl:process.env.DATABASE_URL?.substring(0,30)+'...'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    let bryanPaid = 0;
    let hweiYeenPaid = 0;
    let bryanShare = 0;
    let hweiYeenShare = 0;
    let bryanPayments = 0;
    let hweiYeenPayments = 0;

    allTransactions.forEach((t) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/expenseService.ts:55',message:'calculateNetBalance: Processing transaction',data:{txId:t.id.toString(),amountSGD:t.amountSGD,category:t.category,payerId:t.payerId.toString(),bryanId:bryan.id.toString(),hweiYeenId:hweiYeen.id.toString(),bryanPercent:t.bryanPercentage,hweiYeenPercent:t.hweiYeenPercentage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      // Check if this is a payment transaction (category = 'Settlement' or 'Payment')
      const isPayment = t.category === 'Settlement' || t.category === 'Payment';
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/expenseService.ts:57',message:'calculateNetBalance: Transaction classification',data:{txId:t.id.toString(),category:t.category,isPayment},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      if (isPayment) {
        // Payment transactions reduce balance
        if (t.payerId === bryan.id) {
          bryanPayments += Number(t.amountSGD);
        } else if (t.payerId === hweiYeen.id) {
          hweiYeenPayments += Number(t.amountSGD);
        }
      } else {
        // Expense transactions - calculate based on split
        const txAmount = Number(t.amountSGD);
        const bryanPercent = t.bryanPercentage ?? 0.5;
        const hweiYeenPercent = t.hweiYeenPercentage ?? 0.5;
        const bryanShareForTx = txAmount * bryanPercent;
        const hweiYeenShareForTx = txAmount * hweiYeenPercent;
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/expenseService.ts:70',message:'calculateNetBalance: Expense calculation',data:{txId:t.id.toString(),txAmount,bryanPercent,hweiYeenPercent,bryanShareForTx,hweiYeenShareForTx,payerId:t.payerId.toString(),bryanId:bryan.id.toString(),hweiYeenId:hweiYeen.id.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        
        if (t.payerId === bryan.id) {
          bryanPaid += txAmount;
        } else if (t.payerId === hweiYeen.id) {
          hweiYeenPaid += txAmount;
        }
      
        bryanShare += bryanShareForTx;
        hweiYeenShare += hweiYeenShareForTx;
      }
    });

    // Calculate net amounts from expenses only (before payments)
    // Positive net = person overpaid (other person owes them)
    // Negative net = person underpaid (they owe the other person)
    const bryanNetBeforePayments = bryanPaid - bryanShare;
    const hweiYeenNetBeforePayments = hweiYeenPaid - hweiYeenShare;

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/expenseService.ts:88',message:'calculateNetBalance: Before payments calculation',data:{bryanPaid,bryanShare,bryanNetBeforePayments,hweiYeenPaid,hweiYeenShare,hweiYeenNetBeforePayments,bryanPayments,hweiYeenPayments},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    // Apply payments to net amounts
    // CRITICAL FIX: The formula was inverted! When Bryan pays, his debt should DECREASE (net becomes less negative)
    // So we should ADD payments to reduce debt, not subtract them
    // The correct formula: bryanNet = bryanNetBeforePayments + bryanPayments - hweiYeenPayments
    // When Bryan pays $X: his net improves by $X (ADD payments to reduce debt)
    // When HweiYeen pays $Y to Bryan: Bryan's net improves by $Y (SUBTRACT what HweiYeen paid, which is ADD to Bryan)
    let bryanNet: number;
    let hweiYeenNet: number;
    
    // Bryan's net after payments: ADD what he paid (reduces debt), SUBTRACT what HweiYeen paid to him (reduces credit)
    bryanNet = bryanNetBeforePayments + bryanPayments - hweiYeenPayments;
    
    // HweiYeen's net after payments: ADD what she paid (reduces debt), SUBTRACT what Bryan paid to her (reduces credit)
    hweiYeenNet = hweiYeenNetBeforePayments + hweiYeenPayments - bryanPayments;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/expenseService.ts:104',message:'calculateNetBalance: After payments calculation',data:{bryanNet,hweiYeenNet},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    // Calculate outstanding balances:
    // Net represents: positive = person is owed money, negative = person owes money
    // In a two-person system, we need to find who owes whom
    // CRITICAL FIX: The outstanding balance should be based on the net position, not the difference
    // If bryanNet is positive, Bryan is owed money (hweiYeen owes bryanNet)
    // If bryanNet is negative, Bryan owes money (bryanOwes = |bryanNet|)
    // Since bryanNet + hweiYeenNet = 0 (they sum to zero in a two-person system),
    // we can use either net value to determine the balance
    let bryanOwes = 0;
    let hweiYeenOwes = 0;
    
    // Use bryanNet to determine outstanding balances
    // bryanNet > 0 means Bryan is owed money, so HweiYeen owes |bryanNet|
    // bryanNet < 0 means Bryan owes money, so bryanOwes = |bryanNet|
    if (bryanNet > 0) {
      // Bryan is owed money - HweiYeen owes Bryan
      hweiYeenOwes = bryanNet;
    } else if (bryanNet < 0) {
      // Bryan owes money
      bryanOwes = Math.abs(bryanNet);
    }
    // If bryanNet === 0, both are zero (all settled)

    // Calculate net outstanding (difference)
    const netOutstanding = Math.abs(bryanOwes - hweiYeenOwes);
    
    // Determine who owes whom
    let whoOwes: 'Bryan' | 'HweiYeen' | null = null;
    let whoIsOwed: 'Bryan' | 'HweiYeen' | null = null;
    
    if (bryanOwes > hweiYeenOwes) {
      whoOwes = 'Bryan';
      whoIsOwed = 'HweiYeen';
    } else if (hweiYeenOwes > bryanOwes) {
      whoOwes = 'HweiYeen';
      whoIsOwed = 'Bryan';
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/expenseService.ts:144',message:'calculateNetBalance: Final result',data:{bryanOwes,hweiYeenOwes,netOutstanding,whoOwes,whoIsOwed},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    return { 
      bryanOwes, 
      hweiYeenOwes, 
      netOutstanding,
      whoOwes,
      whoIsOwed
    };
  }

  /**
   * Calculate outstanding balance between users (legacy method - kept for backward compatibility)
   * Now uses calculateNetBalance internally
   * Returns: { bryanOwes: number, hweiYeenOwes: number }
   */
  async calculateOutstandingBalance(): Promise<{
    bryanOwes: number;
    hweiYeenOwes: number;
  }> {
    const netBalance = await this.calculateNetBalance();
    return {
      bryanOwes: netBalance.bryanOwes,
      hweiYeenOwes: netBalance.hweiYeenOwes
    };
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
   * FIXED: Calculates balance in-memory by adding new transactions to existing balance
   * to avoid race condition where balance query doesn't see newly created transactions
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

    // FIX: Wrap all transaction creates in a single Prisma transaction
    // This ensures all transactions are committed atomically before balance calculation
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        // Get split rule for this category
        const splitRuleForItem = await this.splitRulesService.getSplitRule(item.category || 'Other');
        
        const createdTx = await tx.transaction.create({
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
        
        savedTransactions.push(createdTx);

        // Emit analytics event for each transaction
        analyticsBus.emit(AnalyticsEventType.TRANSACTION_CREATED, {
          userId,
          transactionId: createdTx.id,
          amount: createdTx.amountSGD,
          category: createdTx.category || 'Other',
          description: createdTx.description,
        });
      }
    });

    // FIX: Calculate balance AFTER all transactions are committed
    // The Prisma transaction above ensures all creates are committed atomically
    // Now the balance query will see all newly created transactions
    const updatedBalance = await this.calculateNetBalance();

    // Generate balance message from updated balance
    const balanceMessage = this.formatOutstandingBalanceMessage(updatedBalance);
    
    return { savedTransactions, balanceMessage };
  }

  /**
   * Format outstanding balance message from balance data
   * Extracted from getOutstandingBalanceMessage for reuse
   */
  private formatOutstandingBalanceMessage(balance: {
    bryanOwes: number;
    hweiYeenOwes: number;
  }): string {
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
   * Record a payment transaction with state validation and ACID transaction
   * Re-fetches balance before committing to prevent race conditions
   * Returns the payment transaction and new balance state
   */
  async recordPayment(
    payerId: bigint,
    amount: number,
    description: string = 'Settlement payment'
  ): Promise<{
    payment: any;
    newBalance: {
      bryanOwes: number;
      hweiYeenOwes: number;
      netOutstanding: number;
      whoOwes: 'Bryan' | 'HweiYeen' | null;
      whoIsOwed: 'Bryan' | 'HweiYeen' | null;
    };
    wasSettled: boolean;
  }> {
    // Step 1: Re-fetch current balance (state validation)
    const currentBalance = await this.calculateNetBalance();
    
    // Step 2: Get payer user to determine who owes
    const payer = await prisma.user.findUnique({
      where: { id: payerId },
    });
    
    if (!payer) {
      throw new Error(`User with id ${payerId} not found`);
    }
    
    // Step 3: Determine who owes and validate payment amount
    const payerRole = payer.role as 'Bryan' | 'HweiYeen';
    let userOwes = 0;
    
    if (payerRole === 'Bryan') {
      userOwes = currentBalance.bryanOwes;
    } else {
      userOwes = currentBalance.hweiYeenOwes;
    }
    
    // State validation: Check if amount is still valid
    // Use a small tolerance (0.01) for floating-point precision issues
    // Allow payment if amount is within tolerance of what's owed (for exact full settlements)
    const TOLERANCE = 0.01;
    if (amount > userOwes + TOLERANCE) {
      throw new Error(`Payment amount ($${amount.toFixed(2)}) exceeds outstanding balance ($${userOwes.toFixed(2)}). Balance may have changed. Please try again.`);
    }
    
    // Clamp amount to userOwes to handle floating-point precision issues
    // If amount is very close to userOwes (within tolerance), use userOwes
    const actualAmount = Math.abs(amount - userOwes) <= TOLERANCE ? userOwes : amount;
    
    if (actualAmount <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }
    
    // Step 4: Record payment and update settlement status in ACID transaction
    // Use actualAmount instead of amount to handle floating-point precision
    return await prisma.$transaction(async (tx) => {
      // Create payment transaction
      const payment = await tx.transaction.create({
        data: {
          amountSGD: actualAmount,
          currency: 'SGD',
          category: 'Settlement',
          description: description,
          payerId: payerId,
          date: new Date(),
          // Note: transactionType field will be added via migration
          // For now, using category='Settlement' to distinguish payments
          isSettled: false, // Payment transactions don't need settled flag
          bryanPercentage: null, // Payments don't have splits
          hweiYeenPercentage: null,
        },
        include: {
          payer: true,
        },
      });
      
      // Re-calculate balance with new payment included
      // We need to recalculate within transaction using the same tx client
      const bryan = await tx.user.findFirst({ where: { role: 'Bryan' } });
      const hweiYeen = await tx.user.findFirst({ where: { role: 'HweiYeen' } });
      
      if (!bryan || !hweiYeen) {
        throw new Error('Users not found');
      }
      
      // Get all transactions including the new payment
      const allTransactions = await tx.transaction.findMany({});
      
      let bryanPaid = 0;
      let hweiYeenPaid = 0;
      let bryanShare = 0;
      let hweiYeenShare = 0;
      let bryanPayments = 0;
      let hweiYeenPayments = 0;

      allTransactions.forEach((t) => {
        const isPayment = t.category === 'Settlement' || t.category === 'Payment';
        
        if (isPayment) {
          if (t.payerId === bryan.id) {
            bryanPayments += Number(t.amountSGD);
          } else if (t.payerId === hweiYeen.id) {
            hweiYeenPayments += Number(t.amountSGD);
          }
        } else {
          if (t.payerId === bryan.id) {
            bryanPaid += Number(t.amountSGD);
          } else if (t.payerId === hweiYeen.id) {
            hweiYeenPaid += Number(t.amountSGD);
          }
          
          const bryanPercent = t.bryanPercentage ?? 0.5;
          const hweiYeenPercent = t.hweiYeenPercentage ?? 0.5;
          
          bryanShare += Number(t.amountSGD) * bryanPercent;
          hweiYeenShare += Number(t.amountSGD) * hweiYeenPercent;
        }
      });

      // Calculate net amounts from expenses only (before payments)
      const bryanNetBeforePayments = bryanPaid - bryanShare;
      const hweiYeenNetBeforePayments = hweiYeenPaid - hweiYeenShare;
      
      // Apply payments to net amounts
      // CRITICAL FIX: The formula was inverted! When Bryan pays, his debt should DECREASE (net becomes less negative)
      // So we should ADD payments to reduce debt, not subtract them
      // The correct formula: bryanNet = bryanNetBeforePayments + bryanPayments - hweiYeenPayments
      // When Bryan pays $X: his net improves by $X (ADD payments to reduce debt)
      // When HweiYeen pays $Y to Bryan: Bryan's net improves by $Y (SUBTRACT what HweiYeen paid, which is ADD to Bryan)
      let bryanNet: number;
      let hweiYeenNet: number;
      
      // Bryan's net after payments: ADD what he paid (reduces debt), SUBTRACT what HweiYeen paid to him (reduces credit)
      bryanNet = bryanNetBeforePayments + bryanPayments - hweiYeenPayments;
      
      // HweiYeen's net after payments: ADD what she paid (reduces debt), SUBTRACT what Bryan paid to her (reduces credit)
      hweiYeenNet = hweiYeenNetBeforePayments + hweiYeenPayments - bryanPayments;
      
      // Calculate outstanding balances using direct net position (same logic as calculateNetBalance)
      // CRITICAL FIX: Use bryanNet directly instead of netDifference to avoid double-counting
      let bryanOwes = 0;
      let hweiYeenOwes = 0;
      
      // Use bryanNet to determine outstanding balances
      // bryanNet > 0 means Bryan is owed money, so HweiYeen owes |bryanNet|
      // bryanNet < 0 means Bryan owes money, so bryanOwes = |bryanNet|
      if (bryanNet > 0) {
        // Bryan is owed money - HweiYeen owes Bryan
        hweiYeenOwes = bryanNet;
      } else if (bryanNet < 0) {
        // Bryan owes money
        bryanOwes = Math.abs(bryanNet);
      }
      // If bryanNet === 0, both are zero (all settled)

      const netOutstanding = Math.abs(bryanOwes - hweiYeenOwes);
      
      let whoOwes: 'Bryan' | 'HweiYeen' | null = null;
      let whoIsOwed: 'Bryan' | 'HweiYeen' | null = null;
      
      if (bryanOwes > hweiYeenOwes) {
        whoOwes = 'Bryan';
        whoIsOwed = 'HweiYeen';
      } else if (hweiYeenOwes > bryanOwes) {
        whoOwes = 'HweiYeen';
        whoIsOwed = 'Bryan';
      }
      
      const newBalance = {
        bryanOwes,
        hweiYeenOwes,
        netOutstanding,
        whoOwes,
        whoIsOwed
      };
      
      // Step 5: If balance reaches $0, mark all expense transactions as settled
      let wasSettled = false;
      if (netOutstanding === 0) {
        // Mark all expense transactions (exclude Settlement/Payment transactions) as settled
        // Use OR with expense categories, or check if category is NULL (defaults to expense)
        const expenseCategories = ['Food', 'Transport', 'Groceries', 'Shopping', 'Bills', 'Utilities', 'Medical', 'Travel', 'Entertainment', 'Other'];
        const result = await tx.transaction.updateMany({
          where: {
            AND: [
              {
                OR: [
                  { category: { in: expenseCategories } },
                  { category: null }, // Handle transactions with no category (treated as expenses)
                ],
              },
              { category: { not: 'Settlement' } },
              { category: { not: 'Payment' } },
            ],
            isSettled: false,
          },
          data: {
            isSettled: true,
          },
        });
        wasSettled = result.count > 0;
      }
      
      // Emit analytics event
      analyticsBus.emit(AnalyticsEventType.TRANSACTION_CREATED, {
        userId: payerId,
        transactionId: payment.id,
        amount: payment.amountSGD,
        category: payment.category || 'Settlement',
        description: payment.description,
      });
      
      return {
        payment,
        newBalance,
        wasSettled
      };
    });
  }
}






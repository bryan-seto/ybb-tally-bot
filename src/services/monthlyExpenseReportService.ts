import { prisma } from '../lib/prisma';
import { getUserNameByRole, USER_A_ROLE_KEY, USER_B_ROLE_KEY } from '../config';
import { getEndOfPreviousMonth, getMonthsAgo, getStartOfMonth, formatDate, getNow, getDayOfMonth, getEndOfDay } from '../utils/dateHelpers';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

/**
 * Service for generating monthly expense reports
 */
export class MonthlyExpenseReportService {
  /**
   * Format currency amount with commas
   * @param amount - Amount to format
   * @returns Formatted string (e.g., "1,234.56")
   */
  private formatCurrency(amount: number): string {
    return amount.toLocaleString('en-SG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * Format month name (e.g., "Oct 2023")
   * @param date - Date to format
   * @returns Formatted month string
   */
  private formatMonthName(date: Date): string {
    const zonedDate = toZonedTime(date, 'Asia/Singapore');
    return format(zonedDate, 'MMM yyyy');
  }

  /**
   * Get expense report for the previous 5 fully completed months
   * @deprecated - Cron job removed. This method is kept for backward compatibility but is no longer used.
   * @returns Formatted message string ready for Telegram
   */
  async getLast5MonthsReport(): Promise<string> {
    // Calculate date range: previous 5 fully completed months
    // endDate: Last millisecond of previous month
    const endDate = getEndOfPreviousMonth();
    
    // startDate: First millisecond of the month 4 months prior to endDate
    // (Going back 4 months from end month gives us the 5th month in the range)
    // Example: If endDate is Feb 28, going back 4 months gives us Oct, so range is Oct-Feb (5 months)
    const fourMonthsAgoFromEnd = getMonthsAgo(4, endDate);
    const startDate = getStartOfMonth(fourMonthsAgoFromEnd);

    // Query transactions within date range
    const transactions = await prisma.transaction.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        payer: true,
      },
    });

    // Aggregate totals by payer role
    let bryanTotal = 0;
    let hweiYeenTotal = 0;

    for (const transaction of transactions) {
      const amount = transaction.amountSGD;
      const payerRole = transaction.payer.role;

      if (payerRole === USER_A_ROLE_KEY) {
        bryanTotal += amount;
      } else if (payerRole === USER_B_ROLE_KEY) {
        hweiYeenTotal += amount;
      }
    }

    const grandTotal = bryanTotal + hweiYeenTotal;

    // Get display names from environment variables
    const bryanName = getUserNameByRole(USER_A_ROLE_KEY);
    const hweiYeenName = getUserNameByRole(USER_B_ROLE_KEY);

    // Format period string
    const startMonthName = this.formatMonthName(startDate);
    const endMonthName = this.formatMonthName(endDate);
    const period = `${startMonthName} - ${endMonthName}`;

    // Build message
    let message = `📊 **5-Month Expense Summary**\n\n`;
    message += `**Period:** ${period}\n\n`;

    // Handle empty transactions
    if (transactions.length === 0) {
      message += `No expenses recorded.`;
      return message;
    }

    // Add totals
    message += `• **${bryanName}:** SGD $${this.formatCurrency(bryanTotal)}\n`;
    message += `• **${hweiYeenName}:** SGD $${this.formatCurrency(hweiYeenTotal)}\n`;
    message += `• **Total:** SGD $${this.formatCurrency(grandTotal)}`;

    return message;
  }

  /**
   * Get detailed month-by-month expense report for the last 3 months
   * Smart date detection: If day === 1, shows previous 3 full months.
   * If day > 1, shows 2 full months + current partial month.
   * @returns Formatted message string ready for Telegram with monthly breakdown
   */
  async getDetailedMonthlyReport(): Promise<string> {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2d51ec0e-ae8f-48f8-a307-06b6f8c21e39',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'monthlyExpenseReportService.ts:112',message:'getDetailedMonthlyReport: Entry',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const now = getNow();
    const currentDay = getDayOfMonth(now);
    const isFirstOfMonth = currentDay === 1;

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2d51ec0e-ae8f-48f8-a307-06b6f8c21e39',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'monthlyExpenseReportService.ts:115',message:'getDetailedMonthlyReport: Date calculation',data:{now:now.toISOString(),currentDay,isFirstOfMonth},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    let endDate: Date;
    let startDate: Date;
    let isCurrentMonthPartial = false;

    if (isFirstOfMonth) {
      // Previous 3 full months
      endDate = getEndOfPreviousMonth();
      const twoMonthsAgoFromEnd = getMonthsAgo(2, endDate);
      startDate = getStartOfMonth(twoMonthsAgoFromEnd);
    } else {
      // Day > 1: 2 Full Months + 1 Partial (Current) Month
      endDate = getEndOfDay(now);
      const twoMonthsAgo = getMonthsAgo(2, now);
      startDate = getStartOfMonth(twoMonthsAgo);
      isCurrentMonthPartial = true;
    }

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2d51ec0e-ae8f-48f8-a307-06b6f8c21e39',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'monthlyExpenseReportService.ts:133',message:'getDetailedMonthlyReport: Date range BEFORE query',data:{startDate:startDate.toISOString(),endDate:endDate.toISOString(),startDateSGT:toZonedTime(startDate,'Asia/Singapore').toISOString(),endDateSGT:toZonedTime(endDate,'Asia/Singapore').toISOString(),isCurrentMonthPartial},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    // Query transactions within date range
    const transactions = await prisma.transaction.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        payer: true,
      },
    });

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2d51ec0e-ae8f-48f8-a307-06b6f8c21e39',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'monthlyExpenseReportService.ts:145',message:'getDetailedMonthlyReport: Query result',data:{transactionCount:transactions.length,transactionIds:transactions.map(t=>t.id.toString()),transactionDates:transactions.map(t=>({id:t.id.toString(),dateUTC:t.date.toISOString(),dateSGT:toZonedTime(t.date,'Asia/Singapore').toISOString(),amount:t.amountSGD,payerRole:t.payer.role})),totalAmount:transactions.reduce((sum,t)=>sum+t.amountSGD,0)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    // Group transactions by month
    interface MonthData {
      monthKey: string; // "2025-01" for sorting
      monthName: string; // "Jan 2025"
      isPartial: boolean;
      bryanTotal: number;
      hweiYeenTotal: number;
    }

    const monthMap = new Map<string, MonthData>();

    for (const transaction of transactions) {
      const txDate = toZonedTime(transaction.date, 'Asia/Singapore');
      const monthKey = format(txDate, 'yyyy-MM'); // "2025-01"
      const monthName = format(txDate, 'MMM yyyy'); // "Jan 2025"

      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2d51ec0e-ae8f-48f8-a307-06b6f8c21e39',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'monthlyExpenseReportService.ts:158',message:'getDetailedMonthlyReport: Processing transaction',data:{txId:transaction.id.toString(),dateUTC:transaction.date.toISOString(),dateSGT:txDate.toISOString(),monthKey,monthName,amount:transaction.amountSGD,payerRole:transaction.payer.role,bryanPercent:transaction.bryanPercentage,hweiYeenPercent:transaction.hweiYeenPercentage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          monthKey,
          monthName,
          isPartial: isCurrentMonthPartial && format(now, 'yyyy-MM') === monthKey,
          bryanTotal: 0,
          hweiYeenTotal: 0,
        });
      }

      const monthData = monthMap.get(monthKey)!;
      const amount = transaction.amountSGD;
      
      // Calculate each person's share based on split percentages
      // Default to 50/50 if percentages are null
      const bryanPercent = transaction.bryanPercentage ?? 0.5;
      const hweiYeenPercent = transaction.hweiYeenPercentage ?? 0.5;
      
      const bryanShare = amount * bryanPercent;
      const hweiYeenShare = amount * hweiYeenPercent;

      // #region agent log
      const beforeBryan = monthData.bryanTotal;
      const beforeHweiYeen = monthData.hweiYeenTotal;
      // #endregion

      // Add each person's share to their total (not based on who paid)
      monthData.bryanTotal += bryanShare;
      monthData.hweiYeenTotal += hweiYeenShare;

      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2d51ec0e-ae8f-48f8-a307-06b6f8c21e39',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'monthlyExpenseReportService.ts:195',message:'getDetailedMonthlyReport: Added shares by split percentage',data:{txId:transaction.id.toString(),amount,bryanShare,hweiYeenShare,beforeBryan,afterBryan:monthData.bryanTotal,beforeHweiYeen,afterHweiYeen:monthData.hweiYeenTotal,monthKey,bryanPercent,hweiYeenPercent},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
    }

    // Sort months chronologically (oldest to newest)
    const sortedMonths = Array.from(monthMap.values()).sort((a, b) => 
      a.monthKey.localeCompare(b.monthKey)
    );

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2d51ec0e-ae8f-48f8-a307-06b6f8c21e39',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'monthlyExpenseReportService.ts:185',message:'getDetailedMonthlyReport: Monthly totals BEFORE formatting',data:{months:sortedMonths.map(m=>({month:m.monthName,bryan:m.bryanTotal,hweiYeen:m.hweiYeenTotal,total:m.bryanTotal+m.hweiYeenTotal})),grandTotalBryan:sortedMonths.reduce((sum,m)=>sum+m.bryanTotal,0),grandTotalHweiYeen:sortedMonths.reduce((sum,m)=>sum+m.hweiYeenTotal,0)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    // Get display names from environment variables
    const bryanName = getUserNameByRole(USER_A_ROLE_KEY);
    const hweiYeenName = getUserNameByRole(USER_B_ROLE_KEY);

    // Build message
    let message = `📊 **3-Month Expense Summary**\n\n`;

    // Add warning if current month is partial
    if (isCurrentMonthPartial) {
      message += `⚠️ **Note:** Current month is not yet complete. This report includes expenses up to today.\n\n`;
    }

    // Handle empty transactions
    if (sortedMonths.length === 0) {
      message += `No expenses recorded.`;
      return message;
    }

    // Add monthly breakdown
    for (const monthData of sortedMonths) {
      const monthLabel = monthData.isPartial 
        ? `**${monthData.monthName} (partial):**`
        : `**${monthData.monthName}:**`;
      
      message += `${monthLabel}\n`;
      message += `• **${bryanName}:** SGD $${this.formatCurrency(monthData.bryanTotal)}\n`;
      message += `• **${hweiYeenName}:** SGD $${this.formatCurrency(monthData.hweiYeenTotal)}\n`;
      message += `• **Total:** SGD $${this.formatCurrency(monthData.bryanTotal + monthData.hweiYeenTotal)}\n\n`;
    }

    return message;
  }
}

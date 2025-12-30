import cron from 'node-cron';
import { prisma } from './lib/prisma';
import { YBBTallyBot } from './bot';
import { ExpenseService } from './services/expenseService';
import { RecurringExpenseService } from './services/recurringExpenseService';
import { getDayOfMonth, getNow, formatDate, getMonthsAgo } from './utils/dateHelpers';
import QuickChart from 'quickchart-js';
import { CONFIG, USER_IDS } from './config';

export function setupJobs(bot: YBBTallyBot, expenseService: ExpenseService) {
  const recurringExpenseService = new RecurringExpenseService(expenseService);

  // Recurring expenses at 09:00 Asia/Singapore time = 01:00 UTC
  cron.schedule('0 1 * * *', async () => {
    try {
      const today = getDayOfMonth();
      const recurringExpenses = await prisma.recurringExpense.findMany({
        where: { dayOfMonth: today, isActive: true },
        include: { payer: true },
      });

      if (recurringExpenses.length === 0) {
        return; // No recurring expenses to process today
      }

      // Process all recurring expenses using the shared service method
      const savedTransactions = [];
      for (const expense of recurringExpenses) {
        try {
          const result = await recurringExpenseService.processSingleRecurringExpense(expense.id);
          savedTransactions.push(result.transaction);
        } catch (error: any) {
          console.error(`Error processing recurring expense ${expense.id}:`, error);
          // Continue processing other expenses even if one fails
        }
      }

      if (savedTransactions.length === 0) {
        return; // No transactions were successfully created
      }

      // Get balance message after all transactions are created
      const balanceMessage = await expenseService.getOutstandingBalanceMessage();

      // Build the standard format message
      let summary = `✅ **Recorded ${savedTransactions.length} expense${savedTransactions.length > 1 ? 's' : ''}:**\n`;
      
      savedTransactions.forEach(tx => {
        summary += `• **${tx.description}**: SGD $${tx.amountSGD.toFixed(2)} (${tx.category})\n`;
      });

      summary += `\n${balanceMessage}`;

      await bot.sendToPrimaryGroup(summary, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error processing recurring expenses:', error);
    }
  });

  // Monthly report on 1st of month at 09:00 Asia/Singapore time = 01:00 UTC
  cron.schedule('0 1 1 * *', async () => {
    try {
      const report = await expenseService.getMonthlyReport(1);
      const reportDate = getMonthsAgo(1);
      const monthName = formatDate(reportDate, 'MMMM yyyy');
      await bot.sendToPrimaryGroup(`📊 Monthly Report - ${monthName}: Total Spend SGD $${report.totalSpend.toFixed(2)}`);
    } catch (error) {
      console.error('Error sending monthly report:', error);
    }
  });

  // Daily backup at 02:00 Asia/Singapore time = 18:00 UTC (previous day)
  cron.schedule('0 18 * * *', async () => {
    try {
      await bot.sendBackupToUser(Number(USER_IDS.BRYAN));
    } catch (error) {
      console.error('Error in daily backup job:', error);
    }
  });
}


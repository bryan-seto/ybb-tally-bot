import cron from 'node-cron';
import { prisma } from './lib/prisma';
import { YBBTallyBot } from './bot';
import { ExpenseService } from './services/expenseService';
import { AnalyticsService } from './services/analyticsService';
import { getDayOfMonth, getNow, formatDate, getMonthsAgo } from './utils/dateHelpers';
import QuickChart from 'quickchart-js';
import { CONFIG, USER_IDS } from './config';

export function setupJobs(bot: YBBTallyBot, expenseService: ExpenseService, analyticsService: AnalyticsService) {
  // Daily stats at midnight (00:00) Asia/Singapore time = 16:00 UTC
  cron.schedule('0 16 * * *', async () => {
    try {
      await analyticsService.calculateDailyStats();
      console.log('Daily stats calculated');
    } catch (error) {
      console.error('Error calculating daily stats:', error);
    }
  });

  // Recurring expenses at 09:00 Asia/Singapore time = 01:00 UTC
  cron.schedule('0 1 * * *', async () => {
    try {
      const today = getDayOfMonth();
      const recurringExpenses = await prisma.recurringExpense.findMany({
        where: { dayOfMonth: today, isActive: true },
        include: { payer: true },
      });

      for (const expense of recurringExpenses) {
        await prisma.transaction.create({
          data: {
            amountSGD: expense.amountOriginal,
            currency: 'SGD',
            category: 'Bills',
            description: expense.description,
            payerId: expense.payerId,
            date: getNow(),
            splitType: 'FULL',
          },
        });
        
        await bot.sendToPrimaryGroup(`💰 Recurring Expense Processed: ${expense.description} - SGD $${expense.amountOriginal.toFixed(2)}`);
      }
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


import dotenv from 'dotenv';
import cron from 'node-cron';
import http from 'http';
import { PrismaClient } from '@prisma/client';
import { YBBTallyBot } from './bot';
import { AnalyticsService } from './services/analyticsService';
import { ExpenseService } from './services/expenseService';
import { getDayOfMonth, getNow, getMonthsAgo, getStartOfMonth, formatDate } from './utils/dateHelpers';
import QuickChart from 'quickchart-js';

dotenv.config();

// --- RENDER KEEP-ALIVE (MOVE THIS TO THE TOP) ---
// We start the web server FIRST so Render sees us immediately
const port = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
});
// '0.0.0.0' forces it to listen on all addresses (Required for Render)
server.listen(Number(port), '0.0.0.0', () => {
    console.log(`Keep-alive server listening on port ${port}`);
});

// --- YOUR BOT CODE STARTS BELOW HERE ---

const prisma = new PrismaClient();
const analyticsService = new AnalyticsService();
const expenseService = new ExpenseService();

// Validate environment variables
const requiredEnvVars = [
  'TELEGRAM_BOT_TOKEN',
  'GEMINI_API_KEY',
  'ALLOWED_USER_IDS',
  'DATABASE_URL',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Initialize bot
const bot = new YBBTallyBot(
  process.env.TELEGRAM_BOT_TOKEN!,
  process.env.GEMINI_API_KEY!,
  process.env.ALLOWED_USER_IDS!
);

/**
 * Initialize database - create users if they don't exist
 */
async function initializeDatabase(): Promise<void> {
  try {
    // Check if users exist
    const bryan = await prisma.user.findFirst({ where: { role: 'Bryan' } });
    const hweiYeen = await prisma.user.findFirst({ where: { role: 'HweiYeen' } });

    if (!bryan) {
      await prisma.user.create({
        data: {
          id: BigInt(109284773),
          name: 'Bryan',
          role: 'Bryan',
        },
      });
      console.log('Created user: Bryan');
    }

    if (!hweiYeen) {
      await prisma.user.create({
        data: {
          id: BigInt(424894363),
          name: 'Hwei Yeen',
          role: 'HweiYeen',
        },
      });
      console.log('Created user: Hwei Yeen');
    }
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

/**
 * Process recurring expenses
 * Runs daily at 09:00 Asia/Singapore time
 */
async function processRecurringExpenses(): Promise<void> {
  try {
    const today = getDayOfMonth();
    const recurringExpenses = await prisma.recurringExpense.findMany({
      where: {
        dayOfMonth: today,
        isActive: true,
      },
      include: {
        payer: true,
      },
    });

    for (const expense of recurringExpenses) {
      const transaction = await prisma.transaction.create({
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

      const groupId = await bot.getPrimaryGroupId();
      if (groupId) {
        const balanceMessage = await expenseService.getOutstandingBalanceMessage();
        await bot.sendToPrimaryGroup(
          `💰 Recurring Expense Processed\n\n` +
          `Description: ${expense.description}\n` +
          `Amount: SGD $${expense.amountOriginal.toFixed(2)}\n` +
          `Paid by: ${expense.payer.name}\n\n` +
          balanceMessage,
          { parse_mode: 'Markdown' }
        );
      }
    }
  } catch (error) {
    console.error('Error processing recurring expenses:', error);
  }
}

/**
 * Calculate daily stats
 * Runs at midnight Asia/Singapore time
 */
async function calculateDailyStats(): Promise<void> {
  try {
    await analyticsService.calculateDailyStats();
    console.log('Daily stats calculated');
  } catch (error) {
    console.error('Error calculating daily stats:', error);
  }
}

/**
 * Generate and send monthly report
 * Runs on 1st of month at 09:00 Asia/Singapore time
 */
async function sendMonthlyReport(): Promise<void> {
  try {
    const report = await expenseService.getMonthlyReport(1); // Last month
    const reportDate = getMonthsAgo(1);
    const monthName = formatDate(reportDate, 'MMMM yyyy');

    // Generate chart
    const chart = new QuickChart();
    chart.setConfig({
      type: 'bar',
      data: {
        labels: report.topCategories.map((c) => c.category),
        datasets: [
          {
            label: 'Spending by Category',
            data: report.topCategories.map((c) => c.amount),
          },
        ],
      },
    });
    chart.setWidth(800);
    chart.setHeight(400);
    const chartUrl = chart.getUrl();

    const message =
      `📊 **Monthly Report - ${monthName}**\n\n` +
      `Total Spend: SGD $${report.totalSpend.toFixed(2)}\n` +
      `Transactions: ${report.transactionCount}\n\n` +
      `**Breakdown:**\n` +
      `Sir Bryan paid: SGD $${report.bryanPaid.toFixed(2)}\n` +
      `Madam Hwei Yeen paid: SGD $${report.hweiYeenPaid.toFixed(2)}\n\n` +
      `**Top Categories:**\n` +
      report.topCategories
        .map((c, i) => `${i + 1}. ${c.category}: SGD $${c.amount.toFixed(2)}`)
        .join('\n') +
      `\n\n[View Chart](${chartUrl})`;

    await bot.sendToPrimaryGroup(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error sending monthly report:', error);
  }
}

// Setup cron jobs
// Note: node-cron v3 doesn't support timezone option, so we calculate UTC times
// Asia/Singapore is UTC+8, so:
// - 00:00 SGT = 16:00 UTC (previous day)
// - 09:00 SGT = 01:00 UTC

// Daily stats at midnight (00:00) Asia/Singapore time = 16:00 UTC
cron.schedule('0 16 * * *', calculateDailyStats);

// Recurring expenses at 09:00 Asia/Singapore time = 01:00 UTC
cron.schedule('0 1 * * *', processRecurringExpenses);

// Monthly report on 1st of month at 09:00 Asia/Singapore time = 01:00 UTC
cron.schedule('0 1 1 * *', sendMonthlyReport);

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Start bot
async function main() {
  try {
    await initializeDatabase();
    await bot.launch();
    console.log('YBB Tally Bot is running...');
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
}

main();


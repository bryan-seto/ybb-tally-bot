import dotenv from 'dotenv';
import cron from 'node-cron';
import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { YBBTallyBot } from './bot';
import { AnalyticsService } from './services/analyticsService';
import { ExpenseService } from './services/expenseService';
import { getDayOfMonth, getNow, getMonthsAgo, getStartOfMonth, formatDate } from './utils/dateHelpers';
import QuickChart from 'quickchart-js';

dotenv.config();

// --- DUMMY WEB SERVER (RENDER KEEP-ALIVE) ---
// Minimal Express server to prevent Render from sleeping
// This starts immediately and runs concurrently with the bot
const webServerPort = process.env.PORT || 3000;
const app = express();

// Root route - simple response to keep Render awake
app.get('/', (req: Request, res: Response) => {
  res.status(200).send('Bot is alive');
});

// Health check endpoint (optional but useful)
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'Bot is alive',
    timestamp: new Date().toISOString()
  });
});

// Start the web server immediately (non-blocking)
app.listen(Number(webServerPort), '0.0.0.0', () => {
  console.log(`Dummy web server listening on port ${webServerPort} (Render keep-alive)`);
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
    
    // Use webhooks in production (Render), long polling in development
    const isProduction = process.env.NODE_ENV === 'production';
    const webhookUrl = process.env.WEBHOOK_URL;
    const port = process.env.PORT || 10000;
    
    if (isProduction && webhookUrl) {
      // Webhook mode for Render
      const webhookPath = `/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
      const fullWebhookUrl = `${webhookUrl}${webhookPath}`;
      
      console.log(`Setting up webhook: ${fullWebhookUrl}`);
      await bot.getBot().telegram.setWebhook(fullWebhookUrl);
      
      // Add webhook endpoint to existing Express app
      app.use(express.json());
      app.use(bot.getBot().webhookCallback(webhookPath));
      
      console.log('YBB Tally Bot is running with webhooks...');
    } else {
      // Long polling mode for development
      await bot.launch();
      console.log('YBB Tally Bot is running with long polling...');
    }
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
}

main();


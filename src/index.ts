import dotenv from 'dotenv';
import cron from 'node-cron';
import express, { Request, Response } from 'express';
import { YBBTallyBot } from './bot';
import { AnalyticsService } from './services/analyticsService';
import { ExpenseService } from './services/expenseService';
import { getDayOfMonth, getNow, getMonthsAgo, getStartOfMonth, formatDate } from './utils/dateHelpers';
import QuickChart from 'quickchart-js';
import { prisma } from './lib/prisma';

dotenv.config();

// --- PREVENT MULTIPLE INSTANCES ---
// Global flag to prevent multiple bot instances during development hot reloads
declare global {
  var botInstance: YBBTallyBot | undefined;
  var isBooting: boolean | undefined;
}

// If bot is already running, exit early
if (global.isBooting) {
  console.log('⚠️  Bot is already starting, skipping duplicate initialization');
  process.exit(0);
}

global.isBooting = true;

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

// Add request logging middleware for debugging
app.use((req: Request, res: Response, next) => {
  if (req.path !== '/health' && req.path !== '/') {
    console.log(`📥 Incoming request: ${req.method} ${req.path}`, {
      headers: req.headers['user-agent'],
      body: req.body ? 'has body' : 'no body',
    });
  }
  next();
});

// Test endpoint to verify Express is working
app.post('/test-webhook', (req: Request, res: Response) => {
  console.log('🧪 Test webhook endpoint called:', req.body);
  res.status(200).json({ message: 'Test endpoint working', body: req.body });
});

// Start the web server immediately (non-blocking)
app.listen(Number(webServerPort), '0.0.0.0', () => {
  console.log(`Dummy web server listening on port ${webServerPort} (Render keep-alive)`);
});

// --- YOUR BOT CODE STARTS BELOW HERE ---

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

// Store bot instance globally to prevent duplicates
global.botInstance = bot;

// --- GRACEFUL SHUTDOWN ---
// Ensure clean shutdown of bot and database connections
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }
  
  isShuttingDown = true;
  console.log(`\n🛑 ${signal} received. Starting graceful shutdown...`);
  
  try {
    // Stop the bot (stops polling or webhook processing)
    console.log('⏹️  Stopping Telegram bot...');
    await bot.stop(signal);
    
    // Disconnect from database
    console.log('🔌 Disconnecting from database...');
    await prisma.$disconnect();
    
    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught Exception:', error);
  await gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  await gracefulShutdown('UNHANDLED_REJECTION');
});

/**
 * Initialize database - create users if they don't exist
 */
async function initializeDatabase(): Promise<void> {
  try {
    console.log('🔌 Testing database connection...');
    
    // Test database connection first
    await prisma.$connect();
    console.log('✅ Database connected successfully');
    
    // Check if users exist
    console.log('👥 Checking for existing users...');
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
      console.log('✅ Created user: Bryan');
    } else {
      console.log('✅ User Bryan already exists');
    }

    if (!hweiYeen) {
      await prisma.user.create({
        data: {
          id: BigInt(424894363),
          name: 'Hwei Yeen',
          role: 'HweiYeen',
        },
      });
      console.log('✅ Created user: Hwei Yeen');
    } else {
      console.log('✅ User Hwei Yeen already exists');
    }
    
    console.log('✅ Database initialization complete');
  } catch (error: any) {
    console.error('❌ Error initializing database:', error.message);
    console.error('📋 Error details:', {
      code: error.code,
      message: error.message,
      meta: error.meta,
    });
    
    // Don't exit - let the error propagate so we can see it in logs
    throw new Error(`Database initialization failed: ${error.message}`);
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

// Start bot
async function main() {
  try {
    console.log('🚀 Starting YBB Tally Bot...');
    console.log('📊 Environment:', process.env.NODE_ENV || 'development');
    console.log('🔧 Port:', process.env.PORT || 10000);
    
    await initializeDatabase();
    
    // Use webhooks in production (Render), long polling in development
    const isProduction = process.env.NODE_ENV === 'production';
    const webhookUrl = process.env.WEBHOOK_URL;
    const port = process.env.PORT || 10000;
    
    if (isProduction && webhookUrl) {
      console.log('🌐 Running in PRODUCTION mode with WEBHOOKS');
      
      // Webhook mode for Render
      // Use a simple path - Telegram will verify the token automatically
      const webhookPath = '/webhook';
      const fullWebhookUrl = `${webhookUrl}${webhookPath}`;
      
      // Add webhook endpoint to Express app BEFORE setting up webhook
      // This ensures the route is ready when Telegram sends updates
      app.use(express.json());
      
      // Add specific logging for webhook path
      app.use(webhookPath, (req: Request, res: Response, next: any) => {
        console.log('🔔 WEBHOOK REQUEST RECEIVED:', {
          method: req.method,
          path: req.path,
          headers: {
            'content-type': req.headers['content-type'],
            'user-agent': req.headers['user-agent'],
          },
          bodyKeys: req.body ? Object.keys(req.body) : 'no body',
          updateId: req.body?.update_id,
        });
        next();
      });
      
      // Register webhook callback
      // Telegraf's webhookCallback() returns an Express middleware
      app.use(webhookPath, bot.getBot().webhookCallback());
      
      // Add error handling middleware (must be after routes)
      app.use((err: any, req: Request, res: Response, next: any) => {
        console.error('❌ Express error:', err.message || err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      });
      
      // Catch-all route for debugging (must be last)
      app.use('*', (req: Request, res: Response) => {
        console.log('🔍 Catch-all route hit:', req.method, req.originalUrl);
        res.status(404).json({ 
          message: 'Route not found', 
          path: req.originalUrl,
          method: req.method 
        });
      });
      
      // Delete any existing webhook first to prevent conflicts
      console.log('🔄 Removing any existing webhook...');
      try {
        const webhookInfo = await bot.getBot().telegram.getWebhookInfo();
        console.log('📡 Current webhook:', webhookInfo.url || 'None');
        
        await bot.getBot().telegram.deleteWebhook({ drop_pending_updates: true });
        console.log('✅ Old webhook removed');
      } catch (error: any) {
        console.log('⚠️  No existing webhook to remove:', error.message);
      }
      
      console.log(`📡 Setting up webhook: ${fullWebhookUrl}`);
      await bot.getBot().telegram.setWebhook(fullWebhookUrl, {
        drop_pending_updates: true,
      });
      
      // Verify webhook was set
      const newWebhookInfo = await bot.getBot().telegram.getWebhookInfo();
      console.log('✅ Webhook verified:', newWebhookInfo.url);
      console.log('📊 Webhook status:', {
        url: newWebhookInfo.url,
        has_custom_certificate: newWebhookInfo.has_custom_certificate,
        pending_update_count: newWebhookInfo.pending_update_count,
      });
      
      console.log('✅ YBB Tally Bot is running with webhooks...');
      global.isBooting = false;
    } else {
      console.log('💻 Running in DEVELOPMENT mode with LONG POLLING');
      
      // Long polling mode for development
      // Check if bot is already running
      try {
        const me = await bot.getBot().telegram.getMe();
        console.log(`🤖 Bot username: @${me.username}`);
        console.log(`🆔 Bot ID: ${me.id}`);
        
        // Delete webhook to enable polling
        console.log('🔄 Removing webhook to enable polling...');
        await bot.getBot().telegram.deleteWebhook({ drop_pending_updates: false });
        console.log('✅ Webhook removed, polling enabled');
        
        await bot.launch();
        console.log('✅ YBB Tally Bot is running with long polling...');
        global.isBooting = false;
      } catch (error: any) {
        if (error.message?.includes('409')) {
          console.error('❌ 409 CONFLICT: Another bot instance is already running!');
          console.error('💡 Solution: Stop the other instance first, or wait 1 minute and try again.');
          throw new Error('Bot conflict detected. Another instance is running.');
        }
        throw error;
      }
    }
  } catch (error: any) {
    console.error('💥 Error starting bot:', error.message);
    console.error('📋 Error stack:', error.stack);
    
    // Attempt cleanup before exit
    try {
      await prisma.$disconnect();
    } catch (e) {
      console.error('Error disconnecting Prisma:', e);
    }
    
    global.isBooting = false;
    process.exit(1);
  }
}

main();


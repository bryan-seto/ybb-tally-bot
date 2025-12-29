import dotenv from 'dotenv';
import { YBBTallyBot } from './bot';
import { AnalyticsService } from './services/analyticsService';
import { ExpenseService } from './services/expenseService';
import { prisma } from './lib/prisma';
import { CONFIG, BOT_USERS } from './config';
import { setupServer } from './server';
import { setupJobs } from './jobs';
import { UserRole } from '@prisma/client';

dotenv.config();

declare global {
  var botInstance: YBBTallyBot | undefined;
  var isBooting: boolean | undefined;
}

if (global.isBooting) {
  console.log('⚠️ Bot is already starting, skipping duplicate initialization');
  process.exit(0);
}

global.isBooting = true;

const analyticsService = new AnalyticsService();
const expenseService = new ExpenseService();

const bot = new YBBTallyBot(
  CONFIG.TELEGRAM_TOKEN,
  CONFIG.GEMINI_API_KEY,
  CONFIG.ALLOWED_USER_IDS.join(',')
);

global.botInstance = bot;

async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 ${signal} received. Starting graceful shutdown...`);
  try {
    await bot.stop(signal);
    await prisma.$disconnect();
    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

async function initializeDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');
    
    for (const user of BOT_USERS) {
      const existingUser = await prisma.user.findFirst({ 
        where: { role: user.role as UserRole } 
      });
      if (!existingUser) {
        await prisma.user.create({
          data: {
            id: user.id,
            name: user.name,
            role: user.role as UserRole,
          },
        });
        console.log(`✅ Created user: ${user.name}`);
      }
    }
  } catch (error: any) {
    console.error('❌ Error initializing database:', error.message);
    throw error;
  }
}

async function main() {
  try {
    await initializeDatabase();
    
    console.log('🔧 Setting up server...');
    setupServer(bot);
    console.log('✅ Server setup complete');
    
    console.log('⏰ Setting up jobs...');
    setupJobs(bot, expenseService, analyticsService);
    console.log('✅ Jobs setup complete');

    const environment = CONFIG.NODE_ENV || 'development';
    const isProduction = environment === 'production';
    const isStaging = environment === 'staging';

    console.log(`🌍 Environment: ${environment}`);
    console.log(`🔗 Webhook URL: ${CONFIG.WEBHOOK_URL || 'Not set'}`);
    console.log(`🚪 Port: ${CONFIG.PORT}`);

    if ((isProduction || isStaging) && CONFIG.WEBHOOK_URL) {
      const fullWebhookUrl = `${CONFIG.WEBHOOK_URL}/webhook`;
      console.log(`🌐 Running in ${environment.toUpperCase()} mode with WEBHOOKS`);
      console.log(`🧹 Deleting existing webhook...`);
      await bot.getBot().telegram.deleteWebhook({ drop_pending_updates: true });
      console.log(`📡 Setting new webhook: ${fullWebhookUrl}`);
      await bot.getBot().telegram.setWebhook(fullWebhookUrl, { drop_pending_updates: true });
      
      // Verify webhook was set
      const webhookInfo = await bot.getBot().telegram.getWebhookInfo();
      console.log(`✅ Webhook confirmed: ${webhookInfo.url}`);
      console.log(`📊 Pending updates: ${webhookInfo.pending_update_count}`);
      
      // Get bot info
      const botInfo = await bot.getBot().telegram.getMe();
      console.log(`🤖 Bot @${botInfo.username} (ID: ${botInfo.id}) ready for webhooks`);
      console.log(`🎯 Bot launched successfully!`);
    } else {
      console.log(`💻 Running in ${environment.toUpperCase()} mode with LONG POLLING`);
      await bot.getBot().telegram.deleteWebhook({ drop_pending_updates: false });
      await bot.launch();
      console.log(`🎯 Bot launched successfully!`);
    }
    
    global.isBooting = false;
  } catch (error: any) {
    console.error('💥 Error starting bot:', error.message || error);
    console.error('Full error details:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    if (error.message?.includes('409: Conflict')) {
      console.error('👉 409 CONFLICT: Another bot instance is using this token!');
    }
    process.exit(1);
  }
}

main();

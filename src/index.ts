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
    
    setupServer(bot);
    setupJobs(bot, expenseService, analyticsService);

    const isProduction = CONFIG.NODE_ENV === 'production';
    if (isProduction && CONFIG.WEBHOOK_URL) {
      const fullWebhookUrl = `${CONFIG.WEBHOOK_URL}/webhook`;
      await bot.getBot().telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.getBot().telegram.setWebhook(fullWebhookUrl, { drop_pending_updates: true });
      console.log(`📡 Webhook set: ${fullWebhookUrl}`);
    } else {
      await bot.getBot().telegram.deleteWebhook({ drop_pending_updates: false });
      await bot.launch();
      console.log('💻 Polling mode enabled');
    }
    
    global.isBooting = false;
  } catch (error: any) {
    console.error('💥 Error starting bot:', error.message);
    process.exit(1);
  }
}

main();

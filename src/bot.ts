import { Telegraf, Context, session, Markup } from 'telegraf';
import * as Sentry from '@sentry/node';
import { AIService } from './services/ai';
import { ExpenseService } from './services/expenseService';
import { HistoryService } from './services/historyService';
import { BackupService } from './services/backupService';
import { RecurringExpenseService } from './services/recurringExpenseService';
import { AnalyticsService } from './services/analyticsService';
import { formatDate } from './utils/dateHelpers';
import { prisma } from './lib/prisma';
import { CONFIG, USER_NAMES, USER_IDS } from './config';
import { CommandHandlers } from './handlers/commandHandlers';
import { PhotoHandler } from './handlers/photoHandler';
import { MessageHandlers } from './handlers/messageHandlers';
import { CallbackHandlers } from './handlers/callbackHandlers';

// Helper function for dynamic greeting
function getGreeting(userId: string): string {
  const name = USER_NAMES[userId] || 'there';
  const env = process.env.NODE_ENV || 'development';
  const prefix = env !== 'production' ? `[${env.toUpperCase()}] ` : '';
  return `${prefix}Hi ${name}!`;
}

// Session data interface
interface BotSession {
  awaitingAmountConfirmation?: boolean;
  awaitingPayer?: boolean;
  manualAddMode?: boolean;
  manualAddStep?: 'description' | 'amount' | 'category' | 'payer';
  manualAmount?: number;
  manualCategory?: string;
  manualDescription?: string;
  recurringMode?: boolean;
  recurringStep?: 'description' | 'amount' | 'day' | 'payer' | 'confirm';
  recurringData?: {
    description?: string;
    amount?: number;
    day?: number;
    payer?: string;
  };
  editLastMode?: boolean;
  editLastAction?: 'amount' | 'category' | 'split';
  editLastTransactionId?: bigint;
  searchMode?: boolean;
  pendingReceipts?: { [key: string]: any };
}

interface PendingPhoto {
  fileId: string;
  filePath: string;
  buffer?: Buffer;
}

interface PhotoCollection {
  photos: PendingPhoto[];
  timer: NodeJS.Timeout | null;
  statusMessageId?: number;
  userId: bigint;
}

export class YBBTallyBot {
  private bot: Telegraf<Context & { session?: BotSession }>;
  private aiService: AIService;
  private expenseService: ExpenseService;
  private historyService: HistoryService;
  private backupService: BackupService;
  private analyticsService: AnalyticsService;
  private commandHandlers: CommandHandlers;
  private photoHandler: PhotoHandler;
  private messageHandlers: MessageHandlers;
  private callbackHandlers: CallbackHandlers;
  private allowedUserIds: Set<string>;
  private botUsername: string = '';

  constructor(token: string, geminiApiKey: string, allowedUserIds: string) {
    this.bot = new Telegraf(token);
    this.aiService = new AIService(geminiApiKey);
    this.expenseService = new ExpenseService();
    this.historyService = new HistoryService();
    this.backupService = new BackupService();
    this.analyticsService = new AnalyticsService();
    const recurringExpenseService = new RecurringExpenseService(this.expenseService);
    this.commandHandlers = new CommandHandlers(this.expenseService, this.analyticsService, this.historyService);
    this.photoHandler = new PhotoHandler(
      this.aiService, 
      this.expenseService,
      (ctx: any, editMode: boolean) => this.showDashboard(ctx, editMode)
    );
    this.messageHandlers = new MessageHandlers(
      this.expenseService, 
      this.aiService, 
      this.historyService,
      () => this.botUsername,
      (ctx: any, editMode: boolean) => this.showDashboard(ctx, editMode)
    );
    this.callbackHandlers = new CallbackHandlers(
      this.expenseService, 
      this.historyService, 
      recurringExpenseService,
      (ctx: any, editMode: boolean) => this.showDashboard(ctx, editMode)
    );
    this.allowedUserIds = new Set(allowedUserIds.split(',').map((id) => id.trim()));

    // Setup session middleware (simple in-memory store)
    this.bot.use(session());

    this.setupMiddleware();
    this.setupCommands();
    this.setupHandlers();
    this.setupGlobalErrorHandler();
    // setupBotCommands will be called after bot is launched
  }

  /**
   * Global error handler to catch any unhandled exceptions
   */
  private setupGlobalErrorHandler(): void {
    this.bot.catch(async (err: any, ctx: Context) => {
      console.error(`[GLOBAL ERROR] for ${ctx.updateType}:`, err);
      
      // 1. Report to Sentry
      Sentry.withScope((scope) => {
        scope.setTag("updateType", ctx.updateType);
        scope.setContext("update", ctx.update as any);
        if (ctx.from) scope.setUser({ id: ctx.from.id.toString(), username: ctx.from.username });
        Sentry.captureException(err);
      });

      // 2. Notify Founder (Bryan)
      try {
        const errorMsg = err.message || 'Unknown error';
        const userStr = ctx.from ? `${ctx.from.first_name} (@${ctx.from.username})` : 'System';
        const groupStr = ctx.chat?.type !== 'private' ? `in group <b>${(ctx.chat as any).title}</b>` : 'in private chat';
        
        await this.bot.telegram.sendMessage(USER_IDS.BRYAN, 
          `🚨 <b>BOT ERROR ALERT</b>\n\n` +
          `<b>User:</b> ${userStr}\n` +
          `<b>Location:</b> ${groupStr}\n` +
          `<b>Error:</b> <code>${errorMsg}</code>`,
          { parse_mode: 'HTML' }
        );
      } catch (notifyErr) {
        console.error('Failed to notify founder about error:', notifyErr);
      }

      // 3. Apologize to User
      try {
        const apology = `🛠️ <b>Status: Temporary Glitch</b>\n\n` +
          `🙏 <b>Apologies!</b> I hit a snag while processing your request.\n` +
          `Our founder @bryanseto has been notified and is fixing it right now.\n\n` +
          `⏳ I will post a message here as soon as I'm back online!`;
        
        await ctx.reply(apology, { parse_mode: 'HTML' });

        // 4. Register group as "waiting for fix"
        if (ctx.chat?.id) {
          const chatId = ctx.chat.id.toString();
          const setting = await prisma.settings.findUnique({ where: { key: 'broken_groups' } });
          const groups = setting ? setting.value.split(',') : [];
          if (!groups.includes(chatId)) {
            groups.push(chatId);
            await prisma.settings.upsert({
              where: { key: 'broken_groups' },
              update: { value: groups.join(',') },
              create: { key: 'broken_groups', value: chatId },
            });
          }
        }
      } catch (replyErr) {
        console.error('Failed to send apology to user:', replyErr);
      }
    });
  }

  /**
   * Setup Telegram BotCommand menu (shows when user types /)
   */
  async setupBotCommands(): Promise<void> {
    await this.bot.telegram.setMyCommands([
      {
        command: 'menu',
        description: 'Show main menu',
      },
    ]);
  }

  /**
   * Security middleware - check if user is allowed
   */
  private setupMiddleware(): void {
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id?.toString();
      
      if (!userId) {
        return;
      }

      // Log all interactions
      try {
        let command = 'photo';
        if (ctx.message && 'text' in ctx.message && ctx.message.text) {
          command = ctx.message.text;
        } else if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data) {
          command = ctx.callbackQuery.data;
        }
        
        await prisma.systemLog.create({
          data: {
            userId: BigInt(userId),
            event: 'command_used',
            metadata: {
              command,
              chatType: ctx.chat?.type,
            },
          },
        });
      } catch (error) {
        console.error('Error logging interaction:', error);
      }

      // Check if user is allowed
      if (!this.allowedUserIds.has(userId)) {
        console.log(`[SECURITY] Access denied for user ID: ${userId}. Allowed:`, Array.from(this.allowedUserIds));
        await ctx.reply(`Access Denied (ID: ${userId})`);
        return;
      }

      return next();
    });
  }

  /**
   * Get main menu keyboard (inline keyboard for groups)
   */
  private getMainMenuKeyboard() {
    return Markup.inlineKeyboard([
      [
        { text: '💸 Settle Up', callback_data: 'settle_up' },
        { text: '📜 History', callback_data: 'view_history' },
      ],
      [
        { text: '☰ Menu', callback_data: 'open_menu' },
      ],
    ]);
  }

  /**
   * Get random balance header from templates
   */
  private async getRandomBalanceHeader(): Promise<string> {
    const balance = await this.expenseService.calculateOutstandingBalance();
    
    // Handle settled state
    if (balance.bryanOwes === 0 && balance.hweiYeenOwes === 0) {
      return '🎉 All settled! Balance is $0.00';
    }

    // Get user names from config
    const bryanName = USER_NAMES[USER_IDS.BRYAN] || 'Husband';
    const hweiYeenName = USER_NAMES[USER_IDS.HWEI_YEEN] || 'Wife';

    // Pick random template
    const templates: string[] = [];
    
    if (balance.bryanOwes > 0) {
      templates.push(`📈 Scoreboard: ${hweiYeenName} is up by $${balance.bryanOwes.toFixed(2)}`);
      templates.push(`👸 ${hweiYeenName} ➡️ 🤴 ${bryanName}: $${balance.bryanOwes.toFixed(2)}`);
      templates.push(`🍪 Treat Status: ${bryanName} owes ${hweiYeenName} $${balance.bryanOwes.toFixed(2)}`);
    } else if (balance.hweiYeenOwes > 0) {
      templates.push(`📈 Scoreboard: ${bryanName} is up by $${balance.hweiYeenOwes.toFixed(2)}`);
      templates.push(`🤴 ${bryanName} ➡️ 👸 ${hweiYeenName}: $${balance.hweiYeenOwes.toFixed(2)}`);
      templates.push(`🍪 Treat Status: ${hweiYeenName} owes ${bryanName} $${balance.hweiYeenOwes.toFixed(2)}`);
    }

    if (templates.length === 0) {
      return '💰 Balance Status';
    }

    const randomIndex = Math.floor(Math.random() * templates.length);
    return templates[randomIndex];
  }

  /**
   * Get dashboard message content
   */
  private async getDashboardMessage(): Promise<string> {
    // Get random header
    const header = await this.getRandomBalanceHeader();
    
    // Get last 3 transactions
    const transactions = await this.historyService.getRecentTransactions(3, 0);
    
    // Build activity feed
    let activityFeed = '';
    if (transactions.length > 0) {
      activityFeed = '\n\n📋 **Latest Activity:**\n';
      for (const tx of transactions) {
        const line = this.historyService.formatTransactionListItem(tx);
        activityFeed += `${line}\n`;
      }
    } else {
      activityFeed = '\n\n📋 **Latest Activity:**\nNo transactions yet.';
    }
    
    // Footer instruction
    const footer = '\n👇 Quick Record: Send a photo or type \'5 Coffee\' (Amount first).';
    
    return `${header}${activityFeed}${footer}`;
  }

  /**
   * Show dashboard (Hub)
   * @param ctx - Telegram context
   * @param editMode - If true, use editMessageText; if false, use reply
   */
  async showDashboard(ctx: any, editMode: boolean = false) {
    try {
      const dashboardMessage = await this.getDashboardMessage();
      const keyboard = this.getMainMenuKeyboard();
      
      if (editMode) {
        // Edit mode: for navigation (Back button)
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery();
        }
        try {
          await ctx.editMessageText(dashboardMessage, {
            ...keyboard,
            parse_mode: 'Markdown',
          });
        } catch (error: any) {
          // If edit fails (e.g., message too old), send new message
          console.error('Error editing dashboard message:', error);
          await ctx.reply(dashboardMessage, {
            ...keyboard,
            parse_mode: 'Markdown',
          });
        }
      } else {
        // New message mode: for new inputs (text/photo)
        await ctx.reply(dashboardMessage, {
          ...keyboard,
          parse_mode: 'Markdown',
        });
      }
    } catch (error: any) {
      console.error('Error showing dashboard:', error);
      // Fallback: send simple message
      try {
        await ctx.reply('Dashboard loading...', this.getMainMenuKeyboard());
      } catch (fallbackError) {
        console.error('Error sending fallback dashboard:', fallbackError);
      }
    }
  }

  /**
   * Setup all bot commands
   */
  private setupCommands(): void {
    // Handle bot being added to a group
    this.bot.on('my_chat_member', async (ctx) => {
      const { new_chat_member } = ctx.myChatMember;
      
      // If bot was added to group
      if (
        (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') &&
        new_chat_member.status === 'member'
      ) {
        // Save group chat ID (same as /start logic)
        await prisma.settings.upsert({
          where: { key: 'primary_group_id' },
          update: { value: ctx.chat.id.toString() },
          create: { key: 'primary_group_id', value: ctx.chat.id.toString() },
        });

        // Show dashboard automatically
        await this.showDashboard(ctx, false);
      }
    });

    // Start command - register group
    this.bot.command('start', async (ctx) => {
      if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        // Save group chat ID
        await prisma.settings.upsert({
          where: { key: 'primary_group_id' },
          update: { value: ctx.chat.id.toString() },
          create: { key: 'primary_group_id', value: ctx.chat.id.toString() },
        });
        
        await this.showDashboard(ctx, false);
      } else {
        const greeting = getGreeting(ctx.from.id.toString());
        await ctx.reply(
          `👋 ${greeting}! I'm ready to track.\n\n` +
          `Please add me to a group and use /start there to register.`
        );
      }
    });

    // Help command - show dashboard
    this.bot.command('help', async (ctx) => await this.showDashboard(ctx, false));

    // Menu command - show dashboard
    this.bot.command('menu', async (ctx) => await this.showDashboard(ctx, false));

    // Balance command
    this.bot.command('balance', async (ctx) => await this.commandHandlers.handleBalance(ctx));

    // Show all pending transactions command
    this.bot.command('pending', async (ctx) => await this.commandHandlers.handlePending(ctx));
    this.bot.command('showAllPendingTransactions', async (ctx) => await this.commandHandlers.handlePending(ctx));

    // Settle all expenses command
    this.bot.command('settle', async (ctx) => await this.commandHandlers.handleSettle(ctx));

    // Monthly report command
    this.bot.command('report', async (ctx) => await this.commandHandlers.handleReport(ctx));

    // Manual add command
    this.bot.command('add', async (ctx) => {
      if (!ctx.session) {
        ctx.session = {};
      }
      await ctx.reply(
        'At your service! Let\'s add an expense manually.\n\n' +
        'Please enter the amount in SGD:'
      );
      
      // Store that we're in manual add mode
      ctx.session.manualAddMode = true;
      ctx.session.manualAddStep = 'amount';
    });

    // History command
    this.bot.command('history', async (ctx) => await this.commandHandlers.handleHistory(ctx));

    // Detailed balance command
    this.bot.command('detailedBalance', async (ctx) => await this.commandHandlers.handleDetailedBalance(ctx));

    // Fixed command (admin only - for error recovery)
    this.bot.command('fixed', async (ctx) => await this.commandHandlers.handleFixed(ctx));

    // Recurring expense command - now redirects to menu
    this.bot.command('recurring', async (ctx) => {
      await ctx.reply(
        '🔄 **Recurring Expenses**\n\n' +
        'Use the menu button to manage recurring expenses:\n' +
        '• Click "🔄 Recurring" in the main menu\n' +
        '• Select "➕ Add New" to create a recurring expense\n\n' +
        'Or use `/menu` to open the main menu.',
        { parse_mode: 'Markdown' }
      );
    });
  }

  /**
   * Setup message handlers
   */
  private setupHandlers(): void {
    this.bot.on('photo', async (ctx) => await this.photoHandler.handlePhoto(ctx));
    
    // Transaction ID parsing is now handled in MessageHandlers.handleText()
    // Removed old bot.hears handler - it's now in MessageHandlers
    
    this.bot.on('text', async (ctx) => await this.messageHandlers.handleText(ctx));
    this.bot.on('callback_query', async (ctx) => await this.callbackHandlers.handleCallback(ctx));

    // Auto-start when added to a group
    this.bot.on('my_chat_member', async (ctx) => {
      try {
        const { new_chat_member } = ctx.myChatMember;
        
        // Check if the bot was added as a member or administrator
        if (new_chat_member.status === 'member' || new_chat_member.status === 'administrator') {
          if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
            // Register group as primary
            await prisma.settings.upsert({
              where: { key: 'primary_group_id' },
              update: { value: ctx.chat.id.toString() },
              create: { key: 'primary_group_id', value: ctx.chat.id.toString() },
            });
            
            const groupTitle = (ctx.chat as any).title || 'this group';
            await this.showDashboard(ctx, false);
          }
        }
      } catch (error) {
        console.error('Error handling my_chat_member update:', error);
      }
    });
  }
  async getPrimaryGroupId(): Promise<number | null> {
    const setting = await prisma.settings.findUnique({
      where: { key: 'primary_group_id' },
    });
    return setting ? parseInt(setting.value) : null;
  }

  /**
   * Send message to primary group
   */
  async sendToPrimaryGroup(message: string, options?: any): Promise<void> {
    const groupId = await this.getPrimaryGroupId();
    if (groupId) {
      try {
        await this.bot.telegram.sendMessage(groupId, message, options);
      } catch (error) {
        console.error('Error sending message to primary group:', error);
      }
    }
  }

  /**
   * Get the bot instance (for webhook callbacks)
   */
  getBot(): Telegraf<Context & { session?: BotSession }> {
    return this.bot;
  }

  /**
   * Cache bot username at startup to prevent blocking getMe() calls
   */
  async cacheBotUsername(): Promise<void> {
    try {
      const botInfo = await this.bot.telegram.getMe();
      this.botUsername = botInfo.username || '';
      console.log('[Bot] Username cached:', this.botUsername);
    } catch (error) {
      console.error('[Bot] Failed to get bot username:', error);
    }
  }

  /**
   * Launch the bot
   */
  async launch(): Promise<void> {
    await this.cacheBotUsername();
    await this.bot.launch();
    await this.setupBotCommands();
    console.log('YBB Tally Bot is running...');
  }

  /**
   * Send a database backup to a specific user via Telegram
   */
  async sendBackupToUser(userId: number): Promise<void> {
    try {
      console.log(`📦 Generating backup for user ${userId}...`);
      const sql = await this.backupService.generateSQLBackup();
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `backup_${dateStr}_${Date.now()}.sql`;
      const buffer = Buffer.from(sql);

      const env = process.env.NODE_ENV || 'development';
      const prefix = env !== 'production' ? `[${env.toUpperCase()}] ` : '';
      
      const message = `${prefix}📦 <b>Daily Backup - ${dateStr}</b>\n\n` +
        `✅ Backup generated successfully\n` +
        `📊 Tables: transactions, users, recurring_expenses, settings\n\n` +
        `🔧 <b>How to Restore in Supabase:</b>\n` +
        `1. Open Supabase Dashboard → SQL Editor\n` +
        `2. Copy the contents of the attached SQL file\n` +
        `3. Paste into SQL Editor\n` +
        `4. Click "Run" to execute\n\n` +
        `⚠️ <b>Note:</b> This will INSERT data. If tables already have data, you may need to DELETE existing rows first or use ON CONFLICT logic (included).`;

      await this.bot.telegram.sendDocument(userId, { source: buffer, filename }, {
        caption: message,
        parse_mode: 'HTML'
      });
      console.log(`✅ Backup sent successfully to user ${userId}`);
    } catch (error) {
      console.error('❌ Error sending backup to user:', error);
    }
  }

  /**
   * Stop the bot gracefully
   */
  async stop(signal?: string): Promise<void> {
    this.bot.stop(signal);
    await prisma.$disconnect();
  }
}


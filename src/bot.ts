import { Telegraf, Context, session, Markup } from 'telegraf';
import * as Sentry from '@sentry/node';
import { AIService } from './services/ai';
import { AnalyticsService } from './services/analyticsService';
import { ExpenseService } from './services/expenseService';
import { HistoryService } from './services/historyService';
import { BackupService } from './services/backupService';
import { getNow, getMonthsAgo, formatDate } from './utils/dateHelpers';
import QuickChart from 'quickchart-js';
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
  receiptData?: {
    amount: number;
    currency: string;
    merchant?: string;
    date?: string;
    category?: string;
    individualAmounts?: number[];
    merchants?: string[];
    categories?: string[];
  };
  awaitingAmountConfirmation?: boolean;
  awaitingPayer?: boolean;
  manualAddMode?: boolean;
  manualAddStep?: 'description' | 'amount' | 'category' | 'payer';
  manualAmount?: number;
  manualCategory?: string;
  manualDescription?: string;
  recurringMode?: boolean;
  recurringStep?: 'description' | 'amount' | 'day' | 'payer';
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

interface PendingReceiptData {
  receiptData: {
    amount: number;
    currency: string;
    merchant?: string;
    date?: string;
    category?: string;
    individualAmounts?: number[];
    merchants?: string[];
    categories?: string[];
  };
  chatId: number;
  userId: bigint;
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
  private analyticsService: AnalyticsService;
  private expenseService: ExpenseService;
  private historyService: HistoryService;
  private backupService: BackupService;
  private commandHandlers: CommandHandlers;
  private photoHandler: PhotoHandler;
  private messageHandlers: MessageHandlers;
  private callbackHandlers: CallbackHandlers;
  private allowedUserIds: Set<string>;
  private pendingReceipts: Map<string, PendingReceiptData> = new Map(); // receiptId -> receiptData

  constructor(token: string, geminiApiKey: string, allowedUserIds: string) {
    this.bot = new Telegraf(token);
    this.aiService = new AIService(geminiApiKey);
    this.analyticsService = new AnalyticsService();
    this.expenseService = new ExpenseService();
    this.historyService = new HistoryService();
    this.backupService = new BackupService();
    this.commandHandlers = new CommandHandlers(this.expenseService, this.analyticsService);
    this.photoHandler = new PhotoHandler(this.aiService, this.expenseService);
    this.messageHandlers = new MessageHandlers(this.expenseService);
    this.callbackHandlers = new CallbackHandlers(this.expenseService, this.historyService, this.analyticsService);
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
        { text: '✅ Settle Up', callback_data: 'menu_settle' },
        { text: '💰 Check Balance', callback_data: 'menu_balance' },
      ],
      [
        { text: '📜 History', callback_data: 'menu_history' },
        { text: '🧾 View Unsettled', callback_data: 'menu_unsettled' },
      ],
      [
        { text: '➕ Add Manual Expense', callback_data: 'menu_add' },
        { text: '✏️ Edit Last', callback_data: 'menu_edit_last' },
      ],
      [
        { text: '🔍 Search', callback_data: 'menu_search' },
        { text: '🔄 Recurring', callback_data: 'menu_recurring' },
      ],
      [
        { text: '📊 Reports', callback_data: 'menu_reports' },
        { text: '❓ User Guide', url: 'https://github.com/bryan-seto/ybb-tally-bot/blob/main/USER_GUIDE.md' },
      ],
    ]);
  }

  /**
   * Show main menu
   */
  private async showMainMenu(ctx: any, message?: string) {
    const greeting = getGreeting(ctx.from.id.toString());
    const menuMessage = message || 
      `👋 ${greeting}! I'm ready to track.\n\n` +
      `📸 Quick Record: Simply send photos of your receipts or screenshots. I can handle single photos or a batch of them at once.\n\n` +
      `👇 Or tap a button below:`;
    
    const keyboard = this.getMainMenuKeyboard();
    
    try {
      await ctx.reply(menuMessage, keyboard);
    } catch (error: any) {
      console.error('Error sending main menu:', error);
      await ctx.reply(menuMessage);
    }
  }

  /**
   * Strip emoji from category name
   */
  private stripEmoji(category: string): string {
    return category.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
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

        // Show main menu automatically
        await this.showMainMenu(ctx, 
          `👋 I've been added to this group! I'm ready to track.\n\n` +
          `📸 Quick Record: Simply send photos of your receipts or screenshots. I can handle single photos or a batch of them at once.\n\n` +
          `👇 Or tap a button below:`
        );
      }
    });

    // Start command - register group
    this.bot.command('start', async (ctx) => {
      console.log(`[DEBUG] /start command received from user ${ctx.from?.id} in chat ${ctx.chat?.id}`);
      if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        // Save group chat ID
        await prisma.settings.upsert({
          where: { key: 'primary_group_id' },
          update: { value: ctx.chat.id.toString() },
          create: { key: 'primary_group_id', value: ctx.chat.id.toString() },
        });
        
        await this.showMainMenu(ctx);
      } else {
        const greeting = getGreeting(ctx.from.id.toString());
        await ctx.reply(
          `👋 ${greeting}! I'm ready to track.\n\n` +
          `Please add me to a group and use /start there to register.`
        );
      }
    });

    // Help command - show main menu
    this.bot.command('help', async (ctx) => {
      console.log(`[DEBUG] /help command received from user ${ctx.from?.id}`);
      await this.showMainMenu(ctx);
    });

    // Menu command
    this.bot.command('menu', async (ctx) => {
      console.log(`[DEBUG] /menu command received from user ${ctx.from?.id} (@${ctx.from?.username})`);
      await this.showMainMenu(ctx);
    });

    // Balance command
    this.bot.command('balance', async (ctx) => await this.commandHandlers.handleBalance(ctx));

    // Show all pending transactions command
    this.bot.command('pending', async (ctx) => await this.commandHandlers.handlePending(ctx));
    this.bot.command('showAllPendingTransactions', async (ctx) => await this.commandHandlers.handlePending(ctx));

    // Settle all expenses command
    this.bot.command('settle', async (ctx) => await this.commandHandlers.handleSettle(ctx));

    // Admin stats command
    this.bot.command('admin_stats', async (ctx) => {
      const stats = await this.analyticsService.getAdminStats();
      await ctx.reply(stats, { parse_mode: 'Markdown' });
    });

    // Monthly report command
    this.bot.command('report', async (ctx) => await this.commandHandlers.handleReport(ctx));

    // Admin: Broadcast fix to all broken groups
    this.bot.command('fixed', async (ctx) => await this.commandHandlers.handleFixed(ctx));


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

    // Recurring expense command
    this.bot.command('recurring', async (ctx) => await this.commandHandlers.handleRecurring(ctx));
  }

  /**
   * Show transaction history list (kept for now as it may be used in some flows)
   */
  private async showHistory(ctx: any, offset: number = 0) {
    try {
      const transactions = await this.historyService.getRecentTransactions(20, offset);
      const totalCount = await this.historyService.getTotalTransactionCount();

      if (transactions.length === 0) {
        const message = '📜 **Transaction History**\n\nNo transactions found.';
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery();
          try {
            await ctx.editMessageText(message, { parse_mode: 'Markdown' });
          } catch (editError) {
            // If edit fails, send a new message
            await ctx.reply(message, { parse_mode: 'Markdown' });
          }
        } else {
          await ctx.reply(message, { parse_mode: 'Markdown' });
        }
        return;
      }

      // Build the list message
      const lines = ['📜 **Transaction History**\n'];
      
      for (const tx of transactions) {
        const line = this.historyService.formatTransactionListItem(tx);
        lines.push(line);
      }

      const message = lines.join('\n');

      // Add pagination button if there are more transactions
      const keyboard: any[] = [];
      if (offset + 20 < totalCount) {
        keyboard.push([
          Markup.button.callback('⬇️ Load More', `history_load_${offset + 20}`)
        ]);
      }

      const replyMarkup = keyboard.length > 0 ? Markup.inlineKeyboard(keyboard) : undefined;

      if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
        try {
          await ctx.editMessageText(
            message,
            {
              parse_mode: 'Markdown',
              reply_markup: replyMarkup?.reply_markup,
            }
          );
        } catch (editError: any) {
          // If edit fails, send a new message
          console.error('Error editing history message:', editError);
          await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: replyMarkup?.reply_markup,
          });
        }
      } else {
        await ctx.reply(message, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup?.reply_markup,
        });
      }
    } catch (error: any) {
      console.error('Error showing history:', error);
      console.error('Error stack:', error.stack);
      const errorMessage = ctx.callbackQuery 
        ? 'Sorry, I encountered an error retrieving history. Please try again.'
        : 'Sorry, I encountered an error retrieving history. Please try again.';
      
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('Error retrieving history', { show_alert: true });
        try {
          await ctx.editMessageText(errorMessage);
        } catch {
          await ctx.reply(errorMessage);
        }
      } else {
        await ctx.reply(errorMessage);
      }
    }
  }

  /**
   * Show transaction detail card
   */
  private async showTransactionDetail(ctx: any, transactionId: bigint) {
    try {
      const transaction = await this.historyService.getTransactionById(transactionId);

      if (!transaction) {
        const message = `❌ Transaction \`/${transactionId}\` not found.`;
        if (ctx.message) {
          await ctx.reply(message, { parse_mode: 'Markdown' });
        } else if (ctx.callbackQuery) {
          await ctx.answerCbQuery('Transaction not found', { show_alert: true });
        }
        return;
      }

      const card = this.historyService.formatTransactionDetail(transaction);

      // Build inline keyboard buttons
      const keyboard: any[] = [];

      // Only show "Settle Up" if transaction is unsettled
      if (transaction.status === 'unsettled') {
        keyboard.push([
          Markup.button.callback('✅ Settle', `tx_settle_${transactionId}`)
        ]);
      }

      // Edit and Delete buttons
      keyboard.push([
        Markup.button.callback('✏️ Edit', `tx_edit_${transactionId}`),
        Markup.button.callback('🗑️ Delete', `tx_delete_${transactionId}`),
      ]);

      const replyMarkup = Markup.inlineKeyboard(keyboard);

      if (ctx.message) {
        await ctx.reply(card, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup.reply_markup,
        });
      } else if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
        await ctx.editMessageText(card, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup.reply_markup,
        });
      }
    } catch (error: any) {
      console.error('Error showing transaction detail:', error);
      await ctx.reply('Sorry, I encountered an error retrieving transaction details. Please try again.');
    }
  }

  /**
   * Setup message handlers
   */
  private setupHandlers(): void {
    this.bot.on('photo', async (ctx) => await this.photoHandler.handlePhoto(ctx));
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
            await this.showMainMenu(ctx, 
              `👋 I've been added to **${groupTitle}**!\n\n` +
              `I'm ready to track expenses for everyone here. Simply send photos of your receipts or screenshots to get started!`
            );
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
   * Launch the bot
   */
  async launch(): Promise<void> {
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


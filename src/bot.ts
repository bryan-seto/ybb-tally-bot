import { Telegraf, Context, session, Markup } from 'telegraf';
import * as Sentry from '@sentry/node';
import { AIService } from './services/ai';
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
  private expenseService: ExpenseService;
  private historyService: HistoryService;
  private backupService: BackupService;
  private commandHandlers: CommandHandlers;
  private photoHandler: PhotoHandler;
  private messageHandlers: MessageHandlers;
  private callbackHandlers: CallbackHandlers;
  private allowedUserIds: Set<string>;
  private pendingReceipts: Map<string, PendingReceiptData> = new Map(); // receiptId -> receiptData
  private botUsername: string = '';

  constructor(token: string, geminiApiKey: string, allowedUserIds: string) {
    this.bot = new Telegraf(token);
    this.aiService = new AIService(geminiApiKey);
    this.expenseService = new ExpenseService();
    this.historyService = new HistoryService();
    this.backupService = new BackupService();
    this.commandHandlers = new CommandHandlers(this.expenseService);
    this.photoHandler = new PhotoHandler(this.aiService, this.expenseService);
    this.messageHandlers = new MessageHandlers(
      this.expenseService, 
      this.aiService, 
      this.historyService,
      () => this.botUsername
    );
    this.callbackHandlers = new CallbackHandlers(this.expenseService, this.historyService);
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
    this.bot.command('help', async (ctx) => await this.showMainMenu(ctx));

    // Menu command
    this.bot.command('menu', async (ctx) => await this.showMainMenu(ctx));

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
    this.bot.command('history', async (ctx) => {
      try {
        await this.showHistory(ctx, 0);
      } catch (error: any) {
        console.error('Error showing history:', error);
        await ctx.reply('Sorry, I encountered an error retrieving history. Please try again.');
      }
    });

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
   * Get ordinal suffix for day (1st, 2nd, 3rd, etc.)
   */
  private getOrdinalSuffix(day: number): string {
    if (day >= 11 && day <= 13) {
      return 'th';
    }
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  /**
   * Start manual add flow
   */
  private async startManualAdd(ctx: any) {
    if (!ctx.session) ctx.session = {};
    ctx.session.manualAddMode = true;
    ctx.session.manualAddStep = 'description';
    await ctx.reply(
      'What is the description?',
      Markup.keyboard([['❌ Cancel']]).resize()
    );
  }

  /**
   * Handle settle up
   */
  private async handleSettleUp(ctx: any) {
    try {
      const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
      
      // Parse balance to get net debt
      // Format: "Madam Hwei Yeen owes Sir Bryan SGD $XX.XX" or vice versa
      const match = balanceMessage.match(/(\w+(?:\s+\w+)?)\s+owes\s+(\w+(?:\s+\w+)?)\s+SGD\s+\$([\d.]+)/i);
      
      if (match) {
        const debtor = match[1].replace(/Sir|Madam/gi, '').trim();
        const creditor = match[2].replace(/Sir|Madam/gi, '').trim();
        const amount = parseFloat(match[3]);
        
        await ctx.reply(
          `${balanceMessage}\n\n` +
          `Mark this as paid and reset balance to $0?`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Yes, Settle', callback_data: 'settle_confirm' }],
                [{ text: '❌ Cancel', callback_data: 'settle_cancel' }],
              ],
            },
            parse_mode: 'Markdown',
          }
        );
      } else {
        // No outstanding balance
        await ctx.reply('✅ All expenses are already settled! No outstanding balance.');
      }
    } catch (error: any) {
      console.error('Error handling settle up:', error);
      await ctx.reply('Sorry, I encountered an error. Please try again.');
    }
  }

  /**
   * Handle check balance
   */
  private async handleCheckBalance(ctx: any) {
    try {
      // Get users
      const bryan = await prisma.user.findFirst({
        where: { role: 'Bryan' },
      });
      const hweiYeen = await prisma.user.findFirst({
        where: { role: 'HweiYeen' },
      });

      if (!bryan || !hweiYeen) {
        await ctx.reply('Error: Users not found in database.');
        return;
      }

      // Get all unsettled transactions with their split percentages
      const transactions = await prisma.transaction.findMany({
        where: {
          isSettled: false,
        },
        include: {
          payer: true,
        },
      });

      let bryanPaid = 0;
      let hweiYeenPaid = 0;
      let bryanShare = 0;
      let hweiYeenShare = 0;
      
      // Track split percentages for display
      let totalAmount = 0;
      let weightedBryanPercent = 0;
      let weightedHweiYeenPercent = 0;

      transactions.forEach((t) => {
        if (t.payerId === bryan.id) {
          bryanPaid += t.amountSGD;
        } else if (t.payerId === hweiYeen.id) {
          hweiYeenPaid += t.amountSGD;
        }
        
        // Use custom split if available, otherwise default to 70/30
        const bryanPercent = t.bryanPercentage ?? 0.7;
        const hweiYeenPercent = t.hweiYeenPercentage ?? 0.3;
        
        bryanShare += t.amountSGD * bryanPercent;
        hweiYeenShare += t.amountSGD * hweiYeenPercent;
        
        // Calculate weighted average for display
        totalAmount += t.amountSGD;
        weightedBryanPercent += t.amountSGD * bryanPercent;
        weightedHweiYeenPercent += t.amountSGD * hweiYeenPercent;
      });

      // Calculate weighted average percentages
      const avgBryanPercent = totalAmount > 0 ? (weightedBryanPercent / totalAmount) * 100 : 70;
      const avgHweiYeenPercent = totalAmount > 0 ? (weightedHweiYeenPercent / totalAmount) * 100 : 30;
      
      const totalSpending = bryanPaid + hweiYeenPaid;
      
      // Calculate net: positive = overpaid (other person owes them), negative = underpaid (they owe)
      const bryanNet = bryanPaid - bryanShare;
      const hweiYeenNet = hweiYeenPaid - hweiYeenShare;
      
      let message = `💰 **Balance Summary**\n\n`;
      message += `Total Paid by Bryan (Unsettled): SGD $${bryanPaid.toFixed(2)}\n`;
      message += `Total Paid by Hwei Yeen (Unsettled): SGD $${hweiYeenPaid.toFixed(2)}\n`;
      message += `Total Group Spending: SGD $${totalSpending.toFixed(2)}\n\n`;
      message += `**Split Calculation (${avgBryanPercent.toFixed(0)}/${avgHweiYeenPercent.toFixed(0)}):**\n`;
      message += `Bryan's share (${avgBryanPercent.toFixed(0)}%): SGD $${bryanShare.toFixed(2)}\n`;
      message += `Hwei Yeen's share (${avgHweiYeenPercent.toFixed(0)}%): SGD $${hweiYeenShare.toFixed(2)}\n\n`;
      
      if (bryanNet > 0) {
        // Bryan overpaid, so Hwei Yeen owes Bryan
        message += `👉 Hwei Yeen owes Bryan: SGD $${bryanNet.toFixed(2)}`;
      } else if (hweiYeenNet > 0) {
        // Hwei Yeen overpaid, so Bryan owes Hwei Yeen
        message += `👉 Bryan owes Hwei Yeen: SGD $${hweiYeenNet.toFixed(2)}`;
      } else if (bryanNet < 0) {
        // Bryan underpaid, so Bryan owes Hwei Yeen
        message += `👉 Bryan owes Hwei Yeen: SGD $${Math.abs(bryanNet).toFixed(2)}`;
      } else if (hweiYeenNet < 0) {
        // Hwei Yeen underpaid, so Hwei Yeen owes Bryan
        message += `👉 Hwei Yeen owes Bryan: SGD $${Math.abs(hweiYeenNet).toFixed(2)}`;
      } else {
        message += `✅ All settled!`;
      }
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error handling check balance:', error);
      await ctx.reply('Sorry, I encountered an error. Please try again.');
    }
  }

  /**
   * Handle view unsettled
   */
  private async handleViewUnsettled(ctx: any) {
    try {
      const pendingTransactions = await this.expenseService.getAllPendingTransactions();
      
      if (pendingTransactions.length === 0) {
        await ctx.reply('✅ All expenses are settled! No unsettled transactions.');
        return;
      }
      
      // Get last 10 transactions
      const last10 = pendingTransactions.slice(0, 10);
      
      let message = `🧾 **Unsettled Transactions**\n\n`;
      
      last10.forEach((t, index) => {
        const dateStr = formatDate(t.date, 'dd MMM yyyy');
        message += `${index + 1}. ${dateStr} - ${t.description} ($${t.amount.toFixed(2)}) - ${t.payerName}\n`;
      });
      
      message += `\n**Total Unsettled Transactions: ${pendingTransactions.length}**`;
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error handling view unsettled:', error);
      await ctx.reply('Sorry, I encountered an error. Please try again.');
    }
  }

  /**
   * Handle reports
   */
  private async handleReports(ctx: any) {
    try {
      await ctx.reply('Generating monthly report...');
      const report = await this.expenseService.getMonthlyReport(0);
      const reportDate = getMonthsAgo(0);
      const monthName = formatDate(reportDate, 'MMMM yyyy');
      
      const chart = new QuickChart();
      chart.setConfig({
        type: 'bar',
        data: {
          labels: report.topCategories.map((c) => c.category),
          datasets: [{ label: 'Spending by Category', data: report.topCategories.map((c) => c.amount) }],
        },
      });
      chart.setWidth(800);
      chart.setHeight(400);
      const chartUrl = chart.getUrl();
      
      const message =
        `📊 **Monthly Report - ${monthName}**\n\n` +
        `Total Spend: SGD $${report.totalSpend.toFixed(2)}\n` +
        `Transactions: ${report.transactionCount}\n\n` +
        `**Top Categories - Bryan:**\n` +
        (report.bryanCategories.length > 0
          ? report.bryanCategories
              .map((c) => {
                const percentage = report.bryanPaid > 0 
                  ? Math.round((c.amount / report.bryanPaid) * 100) 
                  : 0;
                return `${c.category}: SGD $${c.amount.toFixed(2)} (${percentage}%)`;
              })
              .join('\n')
          : 'No categories found') +
        `\n\n**Top Categories - Hwei Yeen:**\n` +
        (report.hweiYeenCategories.length > 0
          ? report.hweiYeenCategories
              .map((c) => {
                const percentage = report.hweiYeenPaid > 0 
                  ? Math.round((c.amount / report.hweiYeenPaid) * 100) 
                  : 0;
                return `${c.category}: SGD $${c.amount.toFixed(2)} (${percentage}%)`;
              })
              .join('\n')
          : 'No categories found') +
        `\n\n[View Chart](${chartUrl})`;
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error handling reports:', error);
      await ctx.reply('Sorry, I encountered an error. Please try again.');
    }
  }

  /**
   * Show recurring menu
   */
  private async showRecurringMenu(ctx: any) {
    await ctx.reply(
      '🔄 **Recurring Expenses**\n\nSelect an option:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 View Active', callback_data: 'recurring_view' }],
            [{ text: '❌ Cancel', callback_data: 'recurring_cancel' }],
          ],
        },
        parse_mode: 'Markdown',
      }
    );
  }

  /**
   * Handle edit last transaction
   */
  private async handleEditLast(ctx: any) {
    try {
      const userId = BigInt(ctx.from.id);
      const lastTransaction = await prisma.transaction.findFirst({
        where: { payerId: userId },
        orderBy: { createdAt: 'desc' },
        include: { payer: true },
      });

      if (!lastTransaction) {
        await ctx.reply('No transactions found. Record an expense first!');
        return;
      }

      const dateStr = formatDate(lastTransaction.date, 'dd MMM yyyy');
      await ctx.reply(
        `You last recorded: ${lastTransaction.description || 'No description'} - $${lastTransaction.amountSGD.toFixed(2)} - ${lastTransaction.category || 'Other'}\n` +
        `Date: ${dateStr}\n` +
        `Paid by: ${USER_NAMES[lastTransaction.payer.id.toString()] || lastTransaction.payer.role}\n\n` +
        `What would you like to edit?`,
        {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🗑️ Delete', callback_data: `edit_last_delete_${lastTransaction.id}` }],
                [{ text: '🔙 Cancel', callback_data: `edit_last_cancel_${lastTransaction.id}` }],
              ],
            },
        }
      );
    } catch (error: any) {
      console.error('Error handling edit last:', error);
      await ctx.reply('Sorry, I encountered an error. Please try again.');
    }
  }

  /**
   * Start search flow
   */
  private async startSearch(ctx: any) {
    if (!ctx.session) ctx.session = {};
    ctx.session.searchMode = true;
    await ctx.reply(
      'Type a keyword (e.g., "Grab" or "Sushi"):',
      Markup.keyboard([['❌ Cancel']]).resize()
    );
  }

  /**
   * Show transaction history list
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


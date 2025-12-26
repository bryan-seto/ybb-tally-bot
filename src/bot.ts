import { Telegraf, Context, session, Markup } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { AIService } from './services/ai';
import { AnalyticsService } from './services/analyticsService';
import { ExpenseService } from './services/expenseService';
import { getNow, getMonthsAgo, formatDate } from './utils/dateHelpers';
import QuickChart from 'quickchart-js';

const prisma = new PrismaClient();

// User ID mappings
const USER_NAMES: { [key: string]: string } = {
  '109284773': 'Sir Bryan',
  '424894363': 'Madam Hwei Yeen',
};

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
  };
  awaitingAmountConfirmation?: boolean;
  awaitingPayer?: boolean;
  manualAddMode?: boolean;
  manualAddStep?: 'amount' | 'category' | 'description' | 'payer';
  manualAmount?: number;
  manualCategory?: string;
  manualDescription?: string;
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
  private allowedUserIds: Set<string>;
  private photoCollections: Map<number, PhotoCollection> = new Map(); // chat_id -> collection
  private pendingReceipts: Map<string, PendingReceiptData> = new Map(); // receiptId -> receiptData

  constructor(token: string, geminiApiKey: string, allowedUserIds: string) {
    this.bot = new Telegraf(token);
    this.aiService = new AIService(geminiApiKey);
    this.analyticsService = new AnalyticsService();
    this.expenseService = new ExpenseService();
    this.allowedUserIds = new Set(allowedUserIds.split(',').map((id) => id.trim()));

    // Setup session middleware (simple in-memory store)
    this.bot.use(session());

    this.setupMiddleware();
    this.setupCommands();
    this.setupHandlers();
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
        await ctx.reply('Access Denied');
        console.log(`Access denied for user ID: ${userId}`);
        return;
      }

      return next();
    });
  }

  /**
   * Setup all bot commands
   */
  private setupCommands(): void {
    // Start command - register group
    this.bot.command('start', async (ctx) => {
      const userName = USER_NAMES[ctx.from.id.toString()] || 'User';
      
      if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        // Save group chat ID
        await prisma.settings.upsert({
          where: { key: 'primary_group_id' },
          update: { value: ctx.chat.id.toString() },
          create: { key: 'primary_group_id', value: ctx.chat.id.toString() },
        });
        
        await ctx.reply(
          `At your service, ${userName}!\n\n` +
          `I am YBB Tally Bot, your expense management assistant.\n` +
          `This group has been registered as the primary group.\n\n` +
          `Send me a receipt photo to get started, or use /help for commands.`
        );
      } else {
        await ctx.reply(
          `At your service, ${userName}!\n\n` +
          `I am YBB Tally Bot. Please add me to a group and use /start there to register.`
        );
      }
    });

    // Help command
    this.bot.command('help', async (ctx) => {
      const userName = USER_NAMES[ctx.from.id.toString()] || 'User';
      await ctx.reply(
        `At your service, ${userName}!\n\n` +
        `💰 **Commands:**\n` +
        `\`/start\` - Register this group\n` +
        `\`/add\` - Manually add an expense\n` +
        `\`/balance\` - Check outstanding balance\n` +
        `\`/recurring\` - Manage recurring expenses\n` +
        `\`/report [offset]\` - Generate monthly report\n` +
        `\`/admin_stats\` - View analytics (admin only)\n` +
        `\`/help\` - Show this help message\n\n` +
        `📸 **Receipt Processing:**\n` +
        `• Send a receipt photo to automatically extract expense details\n` +
        `• Supports traditional receipts, YouTrip screenshots, and banking apps\n` +
        `• Automatic 70/30 split (Bryan 70%, Hwei Yeen 30%)\n\n` +
        `💡 **Pro Tip:** Send multiple receipt photos within 10 seconds! ` +
        `I'll collect them all and process them together. Perfect for:\n` +
        `• Multiple parts of one long receipt\n` +
        `• Multiple receipts from the same shopping trip\n` +
        `• Batch processing of expenses\n\n` +
        `📅 **Recurring Expenses:**\n` +
        `\`/recurring add "Description" <amount> <day> <payer>\`\n` +
        `Example: \`/recurring add "Internet Bill" 50 15 bryan\`\n` +
        `Automatically processed on the specified day each month at 09:00 SGT.\n\n` +
        `📈 **Monthly Reports:**\n` +
        `\`/report\` - Current month\n` +
        `\`/report 1\` - Last month\n` +
        `\`/report 2\` - 2 months ago\n` +
        `Includes spending breakdown, top categories, and visual charts.`,
        { parse_mode: 'Markdown' }
      );
    });

    // Balance command
    this.bot.command('balance', async (ctx) => {
      const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
      await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });
    });

    // Admin stats command
    this.bot.command('admin_stats', async (ctx) => {
      const stats = await this.analyticsService.getAdminStats();
      await ctx.reply(stats, { parse_mode: 'Markdown' });
    });

    // Monthly report command
    this.bot.command('report', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      let monthOffset = 0; // Default to current month (changed from 1)
      
      if (args.length > 0) {
        const offset = parseInt(args[0]);
        if (!isNaN(offset)) {
          monthOffset = offset;
        } else {
          await ctx.reply(
            'Invalid month offset. Use:\n' +
            '`/report` - Generate report for current month\n' +
            '`/report 0` - Generate report for current month\n' +
            '`/report 1` - Generate report for last month\n' +
            '`/report -3` - Generate report for 3 months in the future\n\n' +
            'Example: `/report 0`',
            { parse_mode: 'Markdown' }
          );
          return;
        }
      }

      try {
        await ctx.reply('Generating monthly report... At your service!');

        const report = await this.expenseService.getMonthlyReport(monthOffset);
        const reportDate = getMonthsAgo(monthOffset);
        const monthName = formatDate(reportDate, 'MMMM yyyy');

        // If no transactions found, check if there are any transactions at all
        if (report.transactionCount === 0) {
          // Get all transactions to see what dates exist
          const allTransactions = await prisma.transaction.findMany({
            include: { payer: true },
            orderBy: { date: 'desc' },
          });

          if (allTransactions.length > 0) {
            // Group transactions by month
            const transactionsByMonth: { [key: string]: number } = {};
            allTransactions.forEach(t => {
              const monthKey = formatDate(t.date, 'yyyy-MM');
              const monthName = formatDate(t.date, 'MMMM yyyy');
              if (!transactionsByMonth[monthKey]) {
                transactionsByMonth[monthKey] = 0;
              }
              transactionsByMonth[monthKey] += t.amountSGD;
            });

            const monthList = Object.entries(transactionsByMonth)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([key, total]) => {
                const monthName = formatDate(new Date(key + '-01'), 'MMMM yyyy');
                return `• ${monthName}: ${allTransactions.filter(t => formatDate(t.date, 'yyyy-MM') === key).length} transaction(s), SGD $${total.toFixed(2)}`;
              })
              .join('\n');
            
            await ctx.reply(
              `No transactions found for ${monthName}.\n\n` +
              `**Available transaction months:**\n${monthList}\n\n` +
              `To view a specific month, calculate the offset:\n` +
              `• Current month (${formatDate(getNow(), 'MMMM yyyy')}): \`/report 0\`\n` +
              `• Last month: \`/report 1\`\n` +
              `• 2 months ago: \`/report 2\`\n\n` +
              `Note: Your transaction is dated September 2025, which is in the future. You may need to adjust the transaction date in the database.`,
              { parse_mode: 'Markdown' }
            );
            return;
          }
        }

        // Legacy fallback - if no transactions found for last month, try current month
        if (report.transactionCount === 0 && monthOffset === 1) {
          // Maybe user wants current month data
          const currentMonthReport = await this.expenseService.getMonthlyReport(0);
          if (currentMonthReport.transactionCount > 0) {
            const currentMonthDate = getMonthsAgo(0);
            const currentMonthName = formatDate(currentMonthDate, 'MMMM yyyy');
            
            const chart = new QuickChart();
            chart.setConfig({
              type: 'bar',
              data: {
                labels: currentMonthReport.topCategories.map((c) => c.category),
                datasets: [
                  {
                    label: 'Spending by Category',
                    data: currentMonthReport.topCategories.map((c) => c.amount),
                  },
                ],
              },
            });
            chart.setWidth(800);
            chart.setHeight(400);
            const chartUrl = chart.getUrl();

            const message =
              `📊 **Monthly Report - ${currentMonthName}**\n\n` +
              `Total Spend: SGD $${currentMonthReport.totalSpend.toFixed(2)}\n` +
              `Transactions: ${currentMonthReport.transactionCount}\n\n` +
              `**Breakdown:**\n` +
              `Sir Bryan paid: SGD $${currentMonthReport.bryanPaid.toFixed(2)}\n` +
              `Madam Hwei Yeen paid: SGD $${currentMonthReport.hweiYeenPaid.toFixed(2)}\n\n` +
              `**Top Categories:**\n` +
              (currentMonthReport.topCategories.length > 0
                ? currentMonthReport.topCategories
                    .map((c, i) => `${i + 1}. ${c.category}: SGD $${c.amount.toFixed(2)}`)
                    .join('\n')
                : 'No categories found') +
              `\n\n[View Chart](${chartUrl})`;

            await ctx.reply(
              `No transactions found for last month. Showing current month instead:\n\n${message}`,
              { parse_mode: 'Markdown' }
            );
            return;
          }
        }

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
          (report.topCategories.length > 0
            ? report.topCategories
                .map((c, i) => `${i + 1}. ${c.category}: SGD $${c.amount.toFixed(2)}`)
                .join('\n')
            : 'No categories found') +
          `\n\n[View Chart](${chartUrl})`;

        await ctx.reply(message, { parse_mode: 'Markdown' });
      } catch (error: any) {
        console.error('Error generating monthly report:', error);
        await ctx.reply('Sorry, I encountered an error generating the report. Please try again.');
      }
    });

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

    // Recurring expense command
    this.bot.command('recurring', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length === 0 || args[0] !== 'add') {
        await ctx.reply(
          '**Recurring Expense Commands:**\n\n' +
          'To add a recurring expense:\n' +
          '`/recurring add <description> <amount> <day_of_month> <payer>`\n\n' +
          'Example:\n' +
          '`/recurring add "Internet Bill" 50 15 bryan`\n\n' +
          'Parameters:\n' +
          '• Description: Name of the expense (use quotes if it contains spaces)\n' +
          '• Amount: Amount in SGD\n' +
          '• Day of month: 1-31 (when to process each month)\n' +
          '• Payer: "bryan" or "hweiyeen"',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      if (args.length < 5) {
        await ctx.reply(
          'Incorrect format. Use:\n' +
          '`/recurring add "Description" <amount> <day> <payer>`\n\n' +
          'Example: `/recurring add "Internet Bill" 50 15 bryan`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      try {
        // Parse arguments
        // Handle description with quotes
        let description = '';
        let amountIndex = 1;
        
        if (args[1].startsWith('"')) {
          // Description is in quotes
          let descParts = [];
          let i = 1;
          while (i < args.length && !args[i].endsWith('"')) {
            descParts.push(args[i].replace(/^"/, ''));
            i++;
          }
          if (i < args.length) {
            descParts.push(args[i].replace(/"$/, ''));
          }
          description = descParts.join(' ');
          amountIndex = i + 1;
        } else {
          description = args[1];
          amountIndex = 2;
        }

        const amount = parseFloat(args[amountIndex]);
        const dayOfMonth = parseInt(args[amountIndex + 1]);
        const payerStr = args[amountIndex + 2].toLowerCase();

        // Validate
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply('Invalid amount. Please provide a positive number.');
          return;
        }

        if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
          await ctx.reply('Invalid day of month. Please provide a number between 1 and 31.');
          return;
        }

        let payerRole: 'Bryan' | 'HweiYeen' | null = null;
        if (payerStr.includes('bryan')) {
          payerRole = 'Bryan';
        } else if (payerStr.includes('hwei') || payerStr.includes('yeen')) {
          payerRole = 'HweiYeen';
        } else {
          await ctx.reply('Invalid payer. Use "bryan" or "hweiyeen".');
          return;
        }

        // Get user
        const user = await prisma.user.findFirst({
          where: { role: payerRole },
        });

        if (!user) {
          await ctx.reply('Error: User not found in database.');
          return;
        }

        // Create recurring expense
        const recurringExpense = await prisma.recurringExpense.create({
          data: {
            description,
            amountOriginal: amount,
            payerId: user.id,
            dayOfMonth,
            isActive: true,
          },
        });

        await ctx.reply(
          `✅ Recurring expense added!\n\n` +
          `Description: ${description}\n` +
          `Amount: SGD $${amount.toFixed(2)}\n` +
          `Day of month: ${dayOfMonth}\n` +
          `Payer: ${USER_NAMES[user.id.toString()] || payerRole}\n\n` +
          `This expense will be automatically processed on the ${dayOfMonth}${this.getOrdinalSuffix(dayOfMonth)} of each month at 09:00 SGT.`
        );
      } catch (error: any) {
        console.error('Error adding recurring expense:', error);
        await ctx.reply('Sorry, I encountered an error adding the recurring expense. Please try again.');
      }
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
   * Setup message handlers
   */
  private setupHandlers(): void {
    // Photo handler - receipt processing with debouncing
    this.bot.on('photo', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        const userId = BigInt(ctx.from.id);
        
        // Get the largest photo
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.telegram.getFile(photo.file_id);
        
        // Get or create photo collection for this chat
        let collection = this.photoCollections.get(chatId);
        if (!collection) {
          collection = {
            photos: [],
            timer: null,
            userId,
          };
          this.photoCollections.set(chatId, collection);
        }

        // Add photo to collection
        collection.photos.push({
          fileId: photo.file_id,
          filePath: file.file_path || '',
        });

        // Clear existing timer
        if (collection.timer) {
          clearTimeout(collection.timer);
        }

        // Update or create status message
        const photoCount = collection.photos.length;
        const statusText = `📥 Collecting receipts... (${photoCount} photo${photoCount > 1 ? 's' : ''} received)`;
        
        if (collection.statusMessageId) {
          try {
            await ctx.telegram.editMessageText(
              chatId,
              collection.statusMessageId,
              undefined,
              statusText
            );
          } catch (error) {
            // If edit fails, send new message
            const statusMsg = await ctx.reply(statusText);
            collection.statusMessageId = statusMsg.message_id;
          }
        } else {
          const statusMsg = await ctx.reply(statusText);
          collection.statusMessageId = statusMsg.message_id;
        }

        // Set new timer (10 seconds)
        collection.timer = setTimeout(async () => {
          await this.processPhotoBatch(chatId, collection!);
        }, 10000);

      } catch (error: any) {
        console.error('Error handling photo:', error);
        await ctx.reply('Sorry, I encountered an error. Please try again.');
      }
    });

    // Text message handler - handle confirmations and manual add
    this.bot.on('text', async (ctx) => {
      if (!ctx.session) {
        ctx.session = {};
      }
      const text = ctx.message.text.toLowerCase().trim();
      const session = ctx.session;
      const chatId = ctx.chat.id;

      // If user sends text during photo collection, clear the collection
      // (they might be sending a correction or canceling)
      if (this.photoCollections.has(chatId)) {
        const collection = this.photoCollections.get(chatId);
        if (collection && collection.timer) {
          clearTimeout(collection.timer);
          if (collection.statusMessageId) {
            try {
              await ctx.telegram.deleteMessage(chatId, collection.statusMessageId);
            } catch (error) {
              // Ignore if message already deleted
            }
          }
          this.photoCollections.delete(chatId);
        }
      }

      // Handle amount confirmation for receipt
      if (session.awaitingAmountConfirmation) {
        if (text === 'yes' || text === 'y') {
          // Amount confirmed, ask who paid
          session.awaitingAmountConfirmation = false;
          session.awaitingPayer = true;
          
          await ctx.reply(
            'Who paid for this expense?',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Bryan', callback_data: 'payer_bryan' }],
                  [{ text: 'Hwei Yeen', callback_data: 'payer_hweiyeen' }],
                ],
              },
            }
          );
        } else {
          // Try to parse as amount
          const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
          if (!isNaN(amount) && amount > 0) {
            if (!session.receiptData) {
              session.receiptData = { amount: 0, currency: 'SGD' };
            }
            session.receiptData.amount = amount;
            session.awaitingAmountConfirmation = false;
            session.awaitingPayer = true;
            
            await ctx.reply(
              `Amount updated to SGD $${amount.toFixed(2)}.\n\nWho paid for this expense?`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: 'Bryan', callback_data: 'payer_bryan' }],
                    [{ text: 'Hwei Yeen', callback_data: 'payer_hweiyeen' }],
                  ],
                },
              }
            );
          } else {
            await ctx.reply('Please reply "yes" to confirm the amount, or send the correct amount.');
          }
        }
        return;
      }

      // Handle payer selection
      if (session.awaitingPayer) {
        let payerRole: 'Bryan' | 'HweiYeen' | null = null;
        
        if (text.includes('bryan') || text === '1') {
          payerRole = 'Bryan';
        } else if (text.includes('hwei') || text.includes('yeen') || text === '2') {
          payerRole = 'HweiYeen';
        }

        if (payerRole) {
          const user = await prisma.user.findFirst({
            where: { role: payerRole },
          });

          if (!user) {
            await ctx.reply('Error: User not found in database. Please ensure users are initialized.');
            session.awaitingPayer = false;
            return;
          }

          // Create transaction
          const receiptData = session.receiptData;
          if (!receiptData) {
            await ctx.reply('Error: Receipt data not found. Please try again.');
            session.awaitingPayer = false;
            return;
          }
          
          const transaction = await prisma.transaction.create({
            data: {
              amountSGD: receiptData.amount,
              currency: receiptData.currency || 'SGD',
              category: receiptData.category || 'Other',
              description: receiptData.merchant || 'Expense',
              payerId: user.id,
              date: receiptData.date ? new Date(receiptData.date) : getNow(),
              splitType: 'FULL',
            },
          });

          // Clear session
          session.receiptData = undefined;
          session.awaitingPayer = false;
          session.awaitingAmountConfirmation = false;

          // Show outstanding balance
          const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
          
          await ctx.reply(
            `✅ Expense recorded!\n\n` +
            `Amount: SGD $${transaction.amountSGD.toFixed(2)}\n` +
            `Paid by: ${USER_NAMES[user.id.toString()] || payerRole}\n` +
            `Category: ${transaction.category || 'Other'}\n\n` +
            balanceMessage,
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.reply(
            'Please reply with:\n' +
            '• "bryan" or "1" for Sir Bryan\n' +
            '• "hwei yeen" or "2" for Madam Hwei Yeen'
          );
        }
        return;
      }

      // Handle manual add flow
      if (session.manualAddMode) {
        if (session.manualAddStep === 'amount') {
          const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
          if (isNaN(amount) || amount <= 0) {
            await ctx.reply('Please enter a valid amount in SGD:');
            return;
          }
          
          session.manualAmount = amount;
          session.manualAddStep = 'category';
          await ctx.reply(
            `Amount: SGD $${amount.toFixed(2)}\n\n` +
            'Enter category (Food, Transport, Shopping, Bills, Other):'
          );
          return;
        } else if (session.manualAddStep === 'category') {
          session.manualCategory = text || 'Other';
          session.manualAddStep = 'description';
          await ctx.reply(
            `Category: ${session.manualCategory}\n\n` +
            'Enter description (optional, or send "skip"):'
          );
        } else if (session.manualAddStep === 'description') {
          if (text !== 'skip') {
            session.manualDescription = text;
          }
          session.manualAddStep = 'payer';
          await ctx.reply(
            `Description: ${session.manualDescription || 'None'}\n\n` +
            'Who paid?\n' +
            '• "bryan" or "1" for Sir Bryan\n' +
            '• "hwei yeen" or "2" for Madam Hwei Yeen'
          );
        } else if (session.manualAddStep === 'payer') {
          let payerRole: 'Bryan' | 'HweiYeen' | null = null;
          
          if (text.includes('bryan') || text === '1') {
            payerRole = 'Bryan';
          } else if (text.includes('hwei') || text.includes('yeen') || text === '2') {
            payerRole = 'HweiYeen';
          }

          if (payerRole) {
            const user = await prisma.user.findFirst({
              where: { role: payerRole },
            });

            if (!user) {
              await ctx.reply('Error: User not found. Please ensure users are initialized.');
              session.manualAddMode = false;
              return;
            }

            const transaction = await prisma.transaction.create({
              data: {
                amountSGD: session.manualAmount || 0,
                currency: 'SGD',
                category: session.manualCategory || 'Other',
                description: session.manualDescription || '',
                payerId: user.id,
                date: getNow(),
                splitType: 'FULL',
              },
            });

            // Clear session
            session.manualAddMode = false;
            session.manualAddStep = undefined;
            session.manualAmount = undefined;
            session.manualCategory = undefined;
            session.manualDescription = undefined;

            const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
            
            await ctx.reply(
              `✅ Expense added!\n\n` +
              `Amount: SGD $${transaction.amountSGD.toFixed(2)}\n` +
              `Paid by: ${USER_NAMES[user.id.toString()] || payerRole}\n` +
              `Category: ${transaction.category || 'Other'}\n\n` +
              balanceMessage,
              { parse_mode: 'Markdown' }
            );
          } else {
            await ctx.reply(
              'Please reply with:\n' +
              '• "bryan" or "1" for Sir Bryan\n' +
              '• "hwei yeen" or "2" for Madam Hwei Yeen'
            );
          }
        }
        return;
      }
    });

    // Handle callback queries (button clicks)
    this.bot.on('callback_query', async (ctx) => {
      if (!ctx.session) {
        ctx.session = {};
      }
      
      // Type guard for callback query with data
      if (!('data' in ctx.callbackQuery) || !ctx.callbackQuery.data) {
        await ctx.answerCbQuery('Invalid callback');
        return;
      }
      
      const callbackData = ctx.callbackQuery.data;
      const session = ctx.session;

      // Handle amount confirmation button (with or without receiptId)
      if (callbackData === 'confirm_amount' || callbackData.startsWith('confirm_amount_')) {
        await ctx.answerCbQuery();
        
        let receiptDataToUse: PendingReceiptData['receiptData'] | null = null;
        let receiptId: string | null = null;
        
        // Check if this is from pendingReceipts (batch processing)
        if (callbackData.startsWith('confirm_amount_')) {
          receiptId = callbackData.replace('confirm_amount_', '');
          const pendingReceipt = this.pendingReceipts.get(receiptId);
          if (pendingReceipt) {
            receiptDataToUse = pendingReceipt.receiptData;
            // Store in session for payer selection
            session.receiptData = receiptDataToUse;
          }
        } else {
          // Legacy: from session
          receiptDataToUse = session.receiptData || null;
        }
        
        if (!receiptDataToUse) {
          await ctx.reply('Error: Receipt data not found. Please try again.');
          return;
        }
        
        session.awaitingAmountConfirmation = false;
        session.awaitingPayer = true;
        
        const payerCallbackPrefix = receiptId ? `payer_${receiptId}_` : 'payer_';
        
        try {
          await ctx.editMessageText(
            'Who paid for this expense?',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Bryan', callback_data: `${payerCallbackPrefix}bryan` }],
                  [{ text: 'Hwei Yeen', callback_data: `${payerCallbackPrefix}hweiyeen` }],
                ],
              },
            }
          );
        } catch (error) {
          // If editing fails, send a new message
          await ctx.reply(
            'Who paid for this expense?',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Bryan', callback_data: `${payerCallbackPrefix}bryan` }],
                  [{ text: 'Hwei Yeen', callback_data: `${payerCallbackPrefix}hweiyeen` }],
                ],
              },
            }
          );
        }
        return;
      }

      // Handle payer selection buttons (with or without receiptId)
      if (callbackData.startsWith('payer_')) {
        await ctx.answerCbQuery();
        
        let receiptId: string | null = null;
        let payerRole: 'Bryan' | 'HweiYeen';
        
        // Parse callback data
        // Format: payer_bryan, payer_hweiyeen, or payer_receiptId_bryan/payer_receiptId_hweiyeen
        const parts = callbackData.split('_');
        
        if (parts.length === 2) {
          // Format: payer_bryan or payer_hweiyeen
          payerRole = parts[1] === 'bryan' ? 'Bryan' : 'HweiYeen';
        } else if (parts.length >= 3) {
          // Format: payer_receiptId_bryan or payer_receiptId_hweiyeen
          receiptId = parts.slice(1, -1).join('_');
          payerRole = parts[parts.length - 1] === 'bryan' ? 'Bryan' : 'HweiYeen';
        } else {
          await ctx.reply('Error: Invalid callback data.');
          return;
        }
        
        const user = await prisma.user.findFirst({
          where: { role: payerRole },
        });

        if (!user) {
          await ctx.reply('Error: User not found in database. Please ensure users are initialized.');
          session.awaitingPayer = false;
          return;
        }

        // Get receipt data from pendingReceipts or session
        let receiptDataToUse: PendingReceiptData['receiptData'] | null = null;
        let pendingReceipt: PendingReceiptData | null = null;
        
        if (receiptId) {
          pendingReceipt = this.pendingReceipts.get(receiptId) || null;
          if (pendingReceipt) {
            receiptDataToUse = pendingReceipt.receiptData;
          }
        }
        
        if (!receiptDataToUse && session.receiptData) {
          receiptDataToUse = session.receiptData;
        }
        
        if (!receiptDataToUse) {
          await ctx.reply('Error: Receipt data not found. Please try again.');
          return;
        }

        const transaction = await prisma.transaction.create({
          data: {
            amountSGD: receiptDataToUse.amount,
            currency: receiptDataToUse.currency || 'SGD',
            category: receiptDataToUse.category || 'Other',
            description: receiptDataToUse.merchant || 'Multiple Receipts',
            payerId: user.id,
            date: receiptDataToUse.date ? new Date(receiptDataToUse.date) : getNow(),
            splitType: 'FULL',
          },
        });

        // Clear session and pending receipt
        session.receiptData = undefined;
        session.awaitingPayer = false;
        session.awaitingAmountConfirmation = false;
        if (receiptId) {
          this.pendingReceipts.delete(receiptId);
        }
        
        // Clean up old pending receipts (older than 1 hour)
        const oneHourAgo = Date.now() - 3600000;
        for (const [id, receipt] of this.pendingReceipts.entries()) {
          if (id.startsWith('receipt_')) {
            const timestamp = parseInt(id.split('_')[2]);
            if (timestamp && timestamp < oneHourAgo) {
              this.pendingReceipts.delete(id);
            }
          }
        }

        // Show outstanding balance
        const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
        
        try {
          await ctx.editMessageText(
            `✅ Expense recorded!\n\n` +
            `Amount: SGD $${transaction.amountSGD.toFixed(2)}\n` +
            `Paid by: ${USER_NAMES[user.id.toString()] || payerRole}\n` +
            `Category: ${transaction.category || 'Other'}\n\n` +
            balanceMessage,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          // If editing fails, send a new message
          await ctx.reply(
            `✅ Expense recorded!\n\n` +
            `Amount: SGD $${transaction.amountSGD.toFixed(2)}\n` +
            `Paid by: ${USER_NAMES[user.id.toString()] || payerRole}\n` +
            `Category: ${transaction.category || 'Other'}\n\n` +
            balanceMessage,
            { parse_mode: 'Markdown' }
          );
        }
      }
    });
  }

  /**
   * Process a batch of photos after debounce period
   */
  private async processPhotoBatch(chatId: number, collection: PhotoCollection): Promise<void> {
    try {
      // Clear the collection from map
      this.photoCollections.delete(chatId);

      // Delete status message
      if (collection.statusMessageId) {
        try {
          await this.bot.telegram.deleteMessage(chatId, collection.statusMessageId);
        } catch (error) {
          // Ignore if message already deleted
        }
      }

      if (collection.photos.length === 0) {
        return;
      }

      // Download all images
      const imageBuffers: Buffer[] = [];
      for (const photo of collection.photos) {
        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${photo.filePath}`;
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        imageBuffers.push(buffer);
      }

      // Send processing message
      const processingMsg = await this.bot.telegram.sendMessage(
        chatId,
        'Processing receipt(s)... At your service!'
      );

      // Process with AI (multiple images)
      const receiptData = await this.aiService.processReceipt(
        imageBuffers,
        collection.userId,
        'image/jpeg'
      );

      // Delete processing message
      try {
        await this.bot.telegram.deleteMessage(chatId, processingMsg.message_id);
      } catch (error) {
        // Ignore if message already deleted
      }

      if (!receiptData.isValid) {
        await this.bot.telegram.sendMessage(chatId, 'Not a receipt. Please send a valid receipt image.');
        return;
      }

      if (!receiptData.total) {
        await this.bot.telegram.sendMessage(
          chatId,
          'Could not extract total amount from receipt. Please try again or use /add to add manually.'
        );
        return;
      }

      // Store receipt data in pendingReceipts map
      const receiptId = `receipt_${chatId}_${Date.now()}`;
      this.pendingReceipts.set(receiptId, {
        receiptData: {
          amount: receiptData.total,
          currency: receiptData.currency || 'SGD',
          merchant: receiptData.merchant,
          date: receiptData.date,
          category: receiptData.category,
          individualAmounts: receiptData.individualAmounts,
          merchants: receiptData.merchants || [],
        },
        chatId,
        userId: collection.userId,
      });

      // Ask for confirmation
      const amountStr = receiptData.currency === 'SGD' 
        ? `SGD $${receiptData.total.toFixed(2)}`
        : `${receiptData.currency} ${receiptData.total.toFixed(2)}`;
      
      // Build transaction breakdown
      let transactionInfo = '';
      if (collection.photos.length > 1) {
        transactionInfo = `Processed ${collection.photos.length} receipt${collection.photos.length > 1 ? 's' : ''}.\n\n`;
      }
      
      if (receiptData.merchants && receiptData.merchants.length > 0) {
        transactionInfo += '**Merchants:**\n';
        receiptData.merchants.forEach((merchant, index) => {
          transactionInfo += `${index + 1}. ${merchant}\n`;
        });
        transactionInfo += '\n';
      }
      
      if (receiptData.individualAmounts && receiptData.individualAmounts.length > 0) {
        transactionInfo += '**Breakdown:**\n';
        receiptData.individualAmounts.forEach((amt, index) => {
          transactionInfo += `${index + 1}. SGD $${amt.toFixed(2)}\n`;
        });
        transactionInfo += `\n**Total: ${amountStr}**\n\n`;
      } else {
        transactionInfo += `**Total: ${amountStr}**\n\n`;
      }
      
      await this.bot.telegram.sendMessage(
        chatId,
        `${transactionInfo}Is ${amountStr} correct?\n\n` +
        `Merchant: ${receiptData.merchant || 'Multiple'}\n` +
        `Category: ${receiptData.category || 'Other'}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Yes', callback_data: `confirm_amount_${receiptId}` }],
            ],
          },
        }
      );

    } catch (error: any) {
      console.error('Error processing photo batch:', error);
      await this.bot.telegram.sendMessage(
        chatId,
        'Sorry, I encountered an error processing the receipts. Please try again.'
      );
      // Clean up
      this.photoCollections.delete(chatId);
    }
  }

  /**
   * Get primary group chat ID
   */
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
   * Launch the bot
   */
  async launch(): Promise<void> {
    await this.bot.launch();
    console.log('YBB Tally Bot is running...');
  }

  /**
   * Stop the bot gracefully
   */
  async stop(signal?: string): Promise<void> {
    this.bot.stop(signal);
    await prisma.$disconnect();
  }
}


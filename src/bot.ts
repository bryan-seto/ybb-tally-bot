import { Telegraf, Context, session, Markup } from 'telegraf';
import { AIService } from './services/ai';
import { AnalyticsService } from './services/analyticsService';
import { ExpenseService } from './services/expenseService';
import { getNow, getMonthsAgo, formatDate } from './utils/dateHelpers';
import QuickChart from 'quickchart-js';
import { prisma } from './lib/prisma';

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
    // setupBotCommands will be called after bot is launched
  }

  /**
   * Setup Telegram BotCommand menu (shows when user types /)
   */
  async setupBotCommands(): Promise<void> {
    await this.bot.telegram.setMyCommands([
      {
        command: 'start',
        description: 'Register this group for expense tracking',
      },
      {
        command: 'help',
        description: 'Show all available commands and features',
      },
      {
        command: 'add',
        description: 'Manually add an expense (amount, category, description, payer)',
      },
      {
        command: 'balance',
        description: 'Check outstanding balance (who owes whom)',
      },
      {
        command: 'pending',
        description: 'View all pending (unsettled) transactions',
      },
      {
        command: 'settle',
        description: 'Mark all expenses as settled (clear outstanding balance)',
      },
      {
        command: 'recurring',
        description: 'Manage recurring expenses (add/list recurring bills)',
      },
      {
        command: 'report',
        description: 'Generate monthly spending report (use /report 0 for current month)',
      },
      {
        command: 'admin_stats',
        description: 'View analytics and statistics (admin only)',
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

    // Help command with inline keyboard buttons
    this.bot.command('help', async (ctx) => {
      const userName = USER_NAMES[ctx.from.id.toString()] || 'User';
      await ctx.reply(
        `At your service, ${userName}!\n\n` +
        `💰 **Quick Commands (Click to run):**\n\n` +
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
        `Includes spending breakdown, top categories, and visual charts.\n\n` +
        `💸 **Settling Expenses:**\n` +
        `Use \`/settle\` to mark all expenses as settled and clear the outstanding balance.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💰 Balance', callback_data: 'help_cmd_balance' },
                { text: '📋 Pending', callback_data: 'help_cmd_pending' },
              ],
              [
                { text: '➕ Add Expense', callback_data: 'help_cmd_add' },
                { text: '✅ Settle All', callback_data: 'help_cmd_settle' },
              ],
              [
                { text: '📊 Report', callback_data: 'help_cmd_report' },
                { text: '🔄 Recurring', callback_data: 'help_cmd_recurring' },
              ],
              [
                { text: '📈 Analytics', callback_data: 'help_cmd_admin_stats' },
              ],
            ],
          },
        }
      );
    });

    // Balance command
    this.bot.command('balance', async (ctx) => {
      const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
      await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });
    });

    // Show all pending transactions command
    // Register both 'pending' (new, valid) and 'showAllPendingTransactions' (old, for backward compatibility)
    const pendingTransactionsHandler = async (ctx: any) => {
      try {
        const pendingTransactions = await this.expenseService.getAllPendingTransactions();
        
        if (pendingTransactions.length === 0) {
          await ctx.reply('✅ All expenses are settled! No pending transactions.');
          return;
        }

        let message = `📋 **All Pending Transactions (${pendingTransactions.length}):**\n\n`;
        
        pendingTransactions.forEach((t, index) => {
          const dateStr = formatDate(t.date, 'dd MMM yyyy');
          message += `${index + 1}. **${t.description}**\n`;
          message += `   Amount: SGD $${t.amount.toFixed(2)}\n`;
          message += `   Paid by: ${t.payerName}\n`;
          message += `   Category: ${t.category}\n`;
          message += `   Date: ${dateStr}\n`;
          
          if (t.bryanOwes > 0) {
            message += `   💰 Sir Bryan owes: SGD $${t.bryanOwes.toFixed(2)}\n`;
          } else if (t.hweiYeenOwes > 0) {
            message += `   💰 Madam Hwei Yeen owes: SGD $${t.hweiYeenOwes.toFixed(2)}\n`;
          }
          
          message += '\n';
        });

        // Add total balance at the end
        const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
        message += balanceMessage;

        await ctx.reply(message, { parse_mode: 'Markdown' });
      } catch (error: any) {
        console.error('Error getting pending transactions:', error);
        await ctx.reply('Sorry, I encountered an error retrieving pending transactions. Please try again.');
      }
    };
    
    // Register the handler for both command names
    this.bot.command('pending', pendingTransactionsHandler);
    this.bot.command('showAllPendingTransactions', pendingTransactionsHandler);

    // Settle all expenses command
    this.bot.command('settle', async (ctx) => {
      try {
        // Mark all unsettled transactions as settled
        const result = await prisma.transaction.updateMany({
          where: {
            isSettled: false,
          },
          data: {
            isSettled: true,
          },
        });

        if (result.count === 0) {
          await ctx.reply('✅ All expenses are already settled! No pending transactions to settle.');
          return;
        }

        await ctx.reply(
          `✅ **All expenses settled!**\n\n` +
          `Marked ${result.count} transaction${result.count > 1 ? 's' : ''} as settled.\n\n` +
          `Outstanding balance has been cleared. All expenses are now settled!`,
          { parse_mode: 'Markdown' }
        );
      } catch (error: any) {
        console.error('Error settling expenses:', error);
        await ctx.reply('Sorry, I encountered an error settling expenses. Please try again.');
      }
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

      try {
        // Parse arguments
        // Reconstruct the full command text to handle quoted descriptions
        const fullText = ctx.message.text;
        const commandMatch = fullText.match(/^\/recurring\s+add\s+(.+)$/i);
        
        if (!commandMatch) {
          await ctx.reply(
            'Incorrect format. Use:\n' +
            '`/recurring add "Description" <amount> <day> <payer>`\n\n' +
            'Example: `/recurring add "Internet Bill" 50 15 bryan`',
            { parse_mode: 'Markdown' }
          );
          return;
        }
        
        const restOfCommand = commandMatch[1].trim();
        
        // Parse: "Description" amount day payer
        // Handle both regular quotes (") and smart quotes ("")
        // Also handle descriptions without quotes (single word)
        // Try to match quoted description first (both regular and smart quotes)
        const quotedMatchRegular = restOfCommand.match(/^"([^"]+)"\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\w+)$/i);
        const quotedMatchSmart = restOfCommand.match(/^[""]([^""]+)[""]\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\w+)$/i);
        const quotedMatch = quotedMatchRegular || quotedMatchSmart;
        const unquotedMatch = restOfCommand.match(/^(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\w+)$/i);
        
        // Debug: log what we're trying to parse
        console.log('Parsing recurring command:', {
          fullText: ctx.message.text,
          restOfCommand,
          restOfCommandLength: restOfCommand.length,
          restOfCommandChars: restOfCommand.split('').map(c => c.charCodeAt(0)),
          quotedMatchRegular: !!quotedMatchRegular,
          quotedMatchSmart: !!quotedMatchSmart,
          quotedMatch: !!quotedMatch,
          unquotedMatch: !!unquotedMatch
        });
        
        let description: string = '';
        let amountStr: string = '';
        let dayStr: string = '';
        let payerStr: string = '';
        
        if (quotedMatch) {
          // Quoted description
          [, description, amountStr, dayStr, payerStr] = quotedMatch;
        } else if (unquotedMatch) {
          // Unquoted description (single word)
          [, description, amountStr, dayStr, payerStr] = unquotedMatch;
        } else {
          // Fallback: try to parse manually by splitting on spaces
          // This handles cases where quotes might be different or formatting is off
          const parts = restOfCommand.split(/\s+/);
          if (parts.length >= 4) {
            // Try to reconstruct: if first part starts with quote, combine until we find closing quote
            if (parts[0].startsWith('"') || parts[0].startsWith('"')) {
              // Find where description ends
              let descEnd = 0;
              for (let i = 0; i < parts.length; i++) {
                if (parts[i].endsWith('"') || parts[i].endsWith('"')) {
                  descEnd = i;
                  break;
                }
              }
              description = parts.slice(0, descEnd + 1).join(' ').replace(/^[""]|[""]$/g, '');
              if (descEnd + 1 < parts.length) amountStr = parts[descEnd + 1];
              if (descEnd + 2 < parts.length) dayStr = parts[descEnd + 2];
              if (descEnd + 3 < parts.length) payerStr = parts[descEnd + 3];
            } else {
              // No quotes, single word description
              description = parts[0];
              amountStr = parts[1];
              dayStr = parts[2];
              payerStr = parts[3];
            }
            
            console.log('Fallback parsing:', { description, amountStr, dayStr, payerStr });
          } else {
            // Debug: show what we're trying to parse
            console.error('Failed to parse recurring command:', restOfCommand, 'Parts:', parts);
            await ctx.reply(
              'Incorrect format. Use:\n' +
              '`/recurring add "Description" <amount> <day> <payer>`\n\n' +
              'Example: `/recurring add "Internet Bill" 50 15 bryan`\n\n' +
              `Debug: Could not parse "${restOfCommand}" (${parts.length} parts found)`,
              { parse_mode: 'Markdown' }
            );
            return;
          }
        }

        // Trim all values and validate they exist
        description = description?.trim() || '';
        amountStr = amountStr?.trim() || '';
        dayStr = dayStr?.trim() || '';
        payerStr = payerStr?.trim() || '';

        // Debug logging
        console.log('Parsed values:', { description, amountStr, dayStr, payerStr });

        if (!amountStr) {
          await ctx.reply(
            'Error: Could not extract amount from command.\n\n' +
            `Received: \`${ctx.message.text}\`\n` +
            `Parsed: description="${description}", amount="${amountStr}", day="${dayStr}", payer="${payerStr}"`,
            { parse_mode: 'Markdown' }
          );
          return;
        }

        const amount = parseFloat(amountStr);
        const dayOfMonth = parseInt(dayStr);
        payerStr = payerStr.toLowerCase();
        
        // Debug logging
        console.log('Parsed numeric values:', { amount, dayOfMonth, payerStr, amountIsNaN: isNaN(amount) });

        // Validate
        if (isNaN(amount) || amount <= 0) {
          console.error('Amount validation failed:', { 
            amount, 
            amountStr, 
            parsed: parseFloat(amountStr),
            fullText: ctx.message.text,
            restOfCommand,
            quotedMatch: !!quotedMatch,
            unquotedMatch: !!unquotedMatch
          });
          await ctx.reply(
            `Invalid amount "${amountStr}". Please provide a positive number.\n\n` +
            `Received: \`${ctx.message.text}\`\n` +
            `Parsed: description="${description}", amount="${amountStr}", day="${dayStr}", payer="${payerStr}"`,
            { parse_mode: 'Markdown' }
          );
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
        
        if (!file.file_path) {
          await ctx.reply('Error: Could not get file path from Telegram. Please try sending the photo again.');
          return;
        }
        
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
          filePath: file.file_path,
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

          // Calculate transaction-specific amount owed
          const transactionOwedMessage = this.expenseService.getTransactionOwedMessage(
            transaction.amountSGD,
            payerRole
          );
          
          // Show outstanding balance
          const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
          
          await ctx.reply(
            `✅ Expense recorded!\n\n` +
            `Amount: SGD $${transaction.amountSGD.toFixed(2)}\n` +
            `Paid by: ${USER_NAMES[user.id.toString()] || payerRole}\n` +
            `Category: ${transaction.category || 'Other'}\n\n` +
            `${transactionOwedMessage}\n\n` +
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

            // Calculate transaction-specific amount owed
            const transactionOwedMessage = this.expenseService.getTransactionOwedMessage(
              transaction.amountSGD,
              payerRole
            );
            
            const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
            
            await ctx.reply(
              `✅ Expense added!\n\n` +
              `Amount: SGD $${transaction.amountSGD.toFixed(2)}\n` +
              `Paid by: ${USER_NAMES[user.id.toString()] || payerRole}\n` +
              `Category: ${transaction.category || 'Other'}\n\n` +
              `${transactionOwedMessage}\n\n` +
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

      // Handle help command buttons
      if (callbackData.startsWith('help_cmd_')) {
        await ctx.answerCbQuery();
        const command = callbackData.replace('help_cmd_', '');
        
        // Manually trigger the command
        if (command === 'balance') {
          const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
          await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });
        } else if (command === 'pending') {
            const pendingTransactions = await this.expenseService.getAllPendingTransactions();
            if (pendingTransactions.length === 0) {
              await ctx.reply('✅ All expenses are settled! No pending transactions.');
          } else {
            let message = `📋 **All Pending Transactions (${pendingTransactions.length}):**\n\n`;
            pendingTransactions.forEach((t, index) => {
              const dateStr = formatDate(t.date, 'dd MMM yyyy');
              message += `${index + 1}. **${t.description}**\n`;
              message += `   Amount: SGD $${t.amount.toFixed(2)}\n`;
              message += `   Paid by: ${t.payerName}\n`;
              message += `   Category: ${t.category}\n`;
              message += `   Date: ${dateStr}\n`;
              if (t.bryanOwes > 0) {
                message += `   💰 Sir Bryan owes: SGD $${t.bryanOwes.toFixed(2)}\n`;
              } else if (t.hweiYeenOwes > 0) {
                message += `   💰 Madam Hwei Yeen owes: SGD $${t.hweiYeenOwes.toFixed(2)}\n`;
              }
              message += '\n';
            });
            const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
            message += balanceMessage;
            await ctx.reply(message, { parse_mode: 'Markdown' });
          }
        } else if (command === 'add') {
          await ctx.reply(
            'At your service! Let\'s add an expense manually.\n\n' +
            'Please enter the amount in SGD:'
          );
          if (!session) ctx.session = {};
          ctx.session.manualAddMode = true;
          ctx.session.manualAddStep = 'amount';
        } else if (command === 'settle') {
          const result = await prisma.transaction.updateMany({
            where: { isSettled: false },
            data: { isSettled: true },
          });
          if (result.count === 0) {
            await ctx.reply('✅ All expenses are already settled! No pending transactions to settle.');
          } else {
            await ctx.reply(
              `✅ **All expenses settled!**\n\n` +
              `Marked ${result.count} transaction${result.count > 1 ? 's' : ''} as settled.\n\n` +
              `Outstanding balance has been cleared. All expenses are now settled!`,
              { parse_mode: 'Markdown' }
            );
          }
        } else if (command === 'report') {
          await ctx.reply('Generating monthly report... At your service!');
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
            `**Breakdown:**\n` +
            `Sir Bryan paid: SGD $${report.bryanPaid.toFixed(2)}\n` +
            `Madam Hwei Yeen paid: SGD $${report.hweiYeenPaid.toFixed(2)}\n\n` +
            `**Top Categories:**\n` +
            (report.topCategories.length > 0
              ? report.topCategories.map((c, i) => `${i + 1}. ${c.category}: SGD $${c.amount.toFixed(2)}`).join('\n')
              : 'No categories found') +
            `\n\n[View Chart](${chartUrl})`;
          await ctx.reply(message, { parse_mode: 'Markdown' });
        } else if (command === 'recurring') {
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
        } else if (command === 'admin_stats') {
          const stats = await this.analyticsService.getAdminStats();
          await ctx.reply(stats, { parse_mode: 'Markdown' });
        }
        return;
      }

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

        // Check if we have multiple receipts to split
        const hasMultipleReceipts = receiptDataToUse.individualAmounts && 
                                     receiptDataToUse.individualAmounts.length > 1;
        const hasMultipleMerchants = receiptDataToUse.merchants && 
                                      receiptDataToUse.merchants.length > 1;

        let transactions: any[] = [];
        let totalAmount = 0;

        if (hasMultipleReceipts) {
          // Create separate transactions for each receipt
          const individualAmounts = receiptDataToUse.individualAmounts || [];
          const merchants = receiptDataToUse.merchants || [];
          const categories = receiptDataToUse.categories || [];
          const baseCategory = receiptDataToUse.category || 'Other';
          const transactionDate = receiptDataToUse.date ? new Date(receiptDataToUse.date) : getNow();

          for (let i = 0; i < individualAmounts.length; i++) {
            const amount = individualAmounts[i];
            const merchant = merchants[i] || merchants[0] || receiptDataToUse.merchant || `Receipt ${i + 1}`;
            
            // Use individual category if available, otherwise use base category
            const category = categories[i] || baseCategory;
            
            const transaction = await prisma.transaction.create({
              data: {
                amountSGD: amount,
                currency: receiptDataToUse.currency || 'SGD',
                category: category,
                description: merchant,
                payerId: user.id,
                date: transactionDate,
                splitType: 'FULL',
              },
            });
            
            transactions.push(transaction);
            totalAmount += amount;
          }
        } else {
          // Single receipt - create one transaction
          const transaction = await prisma.transaction.create({
            data: {
              amountSGD: receiptDataToUse.amount,
              currency: receiptDataToUse.currency || 'SGD',
              category: receiptDataToUse.category || 'Other',
              description: receiptDataToUse.merchant || (receiptDataToUse.merchants && receiptDataToUse.merchants[0]) || 'Receipt',
              payerId: user.id,
              date: receiptDataToUse.date ? new Date(receiptDataToUse.date) : getNow(),
              splitType: 'FULL',
            },
          });
          
          transactions.push(transaction);
          totalAmount = receiptDataToUse.amount;
        }

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

        // Build confirmation message
        let message = '';
        if (transactions.length > 1) {
          message = `✅ ${transactions.length} expenses recorded!\n\n`;
          transactions.forEach((t, index) => {
            message += `${index + 1}. ${t.description}: SGD $${t.amountSGD.toFixed(2)} (${t.category})\n`;
          });
          message += `\n**Total: SGD $${totalAmount.toFixed(2)}**\n`;
          message += `Paid by: ${USER_NAMES[user.id.toString()] || payerRole}\n\n`;
        } else {
          const transaction = transactions[0];
          message = `✅ Expense recorded!\n\n` +
            `Amount: SGD $${transaction.amountSGD.toFixed(2)}\n` +
            `Paid by: ${USER_NAMES[user.id.toString()] || payerRole}\n` +
            `Category: ${transaction.category || 'Other'}\n\n`;
        }

        // Calculate transaction-specific amount owed (from total)
        const transactionOwedMessage = this.expenseService.getTransactionOwedMessage(
          totalAmount,
          payerRole
        );
        
        // Show outstanding balance
        const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
        
        message += `${transactionOwedMessage}\n\n${balanceMessage}`;
        
        try {
          await ctx.editMessageText(message, { parse_mode: 'Markdown' });
        } catch (error) {
          // If editing fails, send a new message
          await ctx.reply(message, { parse_mode: 'Markdown' });
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
        if (!photo.filePath) {
          console.error('Photo filePath is missing:', photo);
          continue;
        }
        
        try {
          const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${photo.filePath}`;
          const response = await fetch(fileUrl);
          
          if (!response.ok) {
            console.error(`Failed to download image: ${response.status} ${response.statusText}`);
            continue;
          }
          
          const buffer = Buffer.from(await response.arrayBuffer());
          imageBuffers.push(buffer);
        } catch (error) {
          console.error('Error downloading image:', error);
          // Continue with other images
        }
      }
      
      if (imageBuffers.length === 0) {
        await this.bot.telegram.sendMessage(
          chatId,
          'Error: Could not download any images. Please try again.'
        );
        this.photoCollections.delete(chatId);
        return;
      }

      // Send processing message
      const processingMsg = await this.bot.telegram.sendMessage(
        chatId,
        'Processing receipt(s)... At your service!'
      );

      // Process with AI (multiple images)
      let receiptData;
      try {
        receiptData = await this.aiService.processReceipt(
          imageBuffers,
          collection.userId,
          'image/jpeg'
        );
      } catch (error: any) {
        console.error('AI processing error:', error);
        await this.bot.telegram.sendMessage(
          chatId,
          `Error processing receipt with AI: ${error.message || 'Unknown error'}. Please try again.`
        );
        this.photoCollections.delete(chatId);
        return;
      }

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
          categories: receiptData.categories || [],
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
      console.error('Error stack:', error.stack);
      console.error('Photo collection:', {
        chatId,
        photoCount: collection.photos.length,
        photos: collection.photos.map(p => ({ fileId: p.fileId, filePath: p.filePath }))
      });
      
      await this.bot.telegram.sendMessage(
        chatId,
        `Sorry, I encountered an error processing the receipts: ${error.message || 'Unknown error'}. Please try again.`
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
   * Stop the bot gracefully
   */
  async stop(signal?: string): Promise<void> {
    this.bot.stop(signal);
    await prisma.$disconnect();
  }
}


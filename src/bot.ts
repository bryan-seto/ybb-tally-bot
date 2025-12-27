import { Telegraf, Context, session, Markup } from 'telegraf';
import { AIService } from './services/ai';
import { AnalyticsService } from './services/analyticsService';
import { ExpenseService } from './services/expenseService';
import { HistoryService } from './services/historyService';
import { getNow, getMonthsAgo, formatDate } from './utils/dateHelpers';
import QuickChart from 'quickchart-js';
import { prisma } from './lib/prisma';

// User ID mappings
const USER_NAMES: { [key: string]: string } = {
  '109284773': 'Bryan',
  '424894363': 'Hwei Yeen',
};

// Helper function for dynamic greeting
function getGreeting(userId: string): string {
  const name = USER_NAMES[userId] || 'there';
  return `Hi ${name}!`;
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
  private allowedUserIds: Set<string>;
  private photoCollections: Map<number, PhotoCollection> = new Map(); // chat_id -> collection
  private pendingReceipts: Map<string, PendingReceiptData> = new Map(); // receiptId -> receiptData

  constructor(token: string, geminiApiKey: string, allowedUserIds: string) {
    this.bot = new Telegraf(token);
    this.aiService = new AIService(geminiApiKey);
    this.analyticsService = new AnalyticsService();
    this.expenseService = new ExpenseService();
    this.historyService = new HistoryService();
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
        await ctx.reply('Access Denied');
        console.log(`Access denied for user ID: ${userId}`);
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
    this.bot.command('help', async (ctx) => {
      await this.showMainMenu(ctx);
    });

    // Menu command
    this.bot.command('menu', async (ctx) => {
      await this.showMainMenu(ctx);
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
            message += `   💰 Bryan owes: SGD $${t.bryanOwes.toFixed(2)}\n`;
          } else if (t.hweiYeenOwes > 0) {
            message += `   💰 Hwei Yeen owes: SGD $${t.hweiYeenOwes.toFixed(2)}\n`;
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
              `**Top Categories - Bryan:**\n` +
              (currentMonthReport.bryanCategories.length > 0
                ? currentMonthReport.bryanCategories
                    .map((c) => {
                      const percentage = currentMonthReport.bryanPaid > 0 
                        ? Math.round((c.amount / currentMonthReport.bryanPaid) * 100) 
                        : 0;
                      return `${c.category}: SGD $${c.amount.toFixed(2)} (${percentage}%)`;
                    })
                    .join('\n')
                : 'No categories found') +
              `\n\n**Top Categories - Hwei Yeen:**\n` +
              (currentMonthReport.hweiYeenCategories.length > 0
                ? currentMonthReport.hweiYeenCategories
                    .map((c) => {
                      const percentage = currentMonthReport.hweiYeenPaid > 0 
                        ? Math.round((c.amount / currentMonthReport.hweiYeenPaid) * 100) 
                        : 0;
                      return `${c.category}: SGD $${c.amount.toFixed(2)} (${percentage}%)`;
                    })
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

    // History command
    this.bot.command('history', async (ctx) => {
      try {
        await this.showHistory(ctx, 0);
      } catch (error: any) {
        console.error('Error showing history:', error);
        await ctx.reply('Sorry, I encountered an error retrieving history. Please try again.');
      }
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
      const pendingTransactions = await this.expenseService.getAllPendingTransactions();
      
      let bryanPaid = 0;
      let hweiYeenPaid = 0;
      
      pendingTransactions.forEach(t => {
        if (t.payerName.includes('Bryan')) {
          bryanPaid += t.amount;
        } else {
          hweiYeenPaid += t.amount;
        }
      });
      
      const totalSpending = bryanPaid + hweiYeenPaid;
      const bryanShare = totalSpending * 0.7;
      const hweiYeenShare = totalSpending * 0.3;
      
      // Calculate net: positive = overpaid (other person owes them), negative = underpaid (they owe)
      const bryanNet = bryanPaid - bryanShare;
      const hweiYeenNet = hweiYeenPaid - hweiYeenShare;
      
      let message = `💰 **Balance Summary**\n\n`;
      message += `Total Paid by Bryan (Unsettled): SGD $${bryanPaid.toFixed(2)}\n`;
      message += `Total Paid by Hwei Yeen (Unsettled): SGD $${hweiYeenPaid.toFixed(2)}\n`;
      message += `Total Group Spending: SGD $${totalSpending.toFixed(2)}\n\n`;
      message += `**Split Calculation (70/30):**\n`;
      message += `Bryan's share (70%): SGD $${bryanShare.toFixed(2)}\n`;
      message += `Hwei Yeen's share (30%): SGD $${hweiYeenShare.toFixed(2)}\n\n`;
      
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
            [{ text: '➕ Add New', callback_data: 'recurring_add' }],
            [{ text: '📋 View Active', callback_data: 'recurring_view' }],
            [{ text: '❌ Remove', callback_data: 'recurring_remove' }],
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
                [{ text: '📝 Edit Amount', callback_data: `edit_last_amount_${lastTransaction.id}` }],
                [{ text: '🏷️ Edit Category', callback_data: `edit_last_category_${lastTransaction.id}` }],
                [{ text: '📊 Edit Split %', callback_data: `edit_last_split_${lastTransaction.id}` }],
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
      const text = ctx.message.text.trim();
      const textLower = text.toLowerCase();
      const session = ctx.session;
      const chatId = ctx.chat.id;

      // Handle transaction ID commands (e.g., /101)
      // Check if text matches pattern /<number> (but not a command like /help)
      const transactionIdMatch = text.match(/^\/(\d+)$/);
      if (transactionIdMatch) {
        const transactionId = BigInt(transactionIdMatch[1]);
        await this.showTransactionDetail(ctx, transactionId);
        return;
      }

      // Handle main menu buttons (for backward compatibility with reply keyboards)
      if (text === '✅ Settle Up' || text === 'Settle Up') {
        await this.handleSettleUp(ctx);
        return;
      } else if (text === '💰 Check Balance' || text === 'Check Balance') {
        await this.handleCheckBalance(ctx);
        return;
      } else if (text === '🧾 View Unsettled' || text === 'View Unsettled') {
        await this.handleViewUnsettled(ctx);
        return;
      } else if (text === '➕ Add Manual Expense' || text === 'Add Manual Expense') {
        await this.startManualAdd(ctx);
        return;
      } else if (text === '🔄 Recurring' || text === 'Recurring') {
        await this.showRecurringMenu(ctx);
        return;
      } else if (text === '📊 Reports' || text === 'Reports') {
        await this.handleReports(ctx);
        return;
      } else if (text === '✏️ Edit Last' || text === 'Edit Last') {
        await this.handleEditLast(ctx);
        return;
      } else if (text === '🔍 Search' || text === 'Search') {
        await this.startSearch(ctx);
        return;
      } else if (text === '❌ Cancel') {
        // Cancel any active flow
        session.manualAddMode = false;
        session.manualAddStep = undefined;
        session.recurringMode = false;
        session.recurringStep = undefined;
        session.editLastMode = false;
        session.editLastAction = undefined;
        session.searchMode = false;
        session.awaitingAmountConfirmation = false;
        session.awaitingPayer = false;
        await this.showMainMenu(ctx, '❌ Operation cancelled.');
        return;
      }

      // Handle search flow
      if (session.searchMode) {
        const keyword = text.trim();
        if (keyword.length === 0) {
          await ctx.reply('Please enter a keyword to search:');
          return;
        }

        try {
          const transactions = await prisma.transaction.findMany({
            where: {
              description: {
                contains: keyword,
                mode: 'insensitive',
              },
            },
            include: { payer: true },
            orderBy: { date: 'desc' },
            take: 5,
          });

          session.searchMode = false;

          if (transactions.length === 0) {
            await ctx.reply(
              `No expenses found matching "${keyword}".`,
              this.getMainMenuKeyboard()
            );
          } else {
            let message = `🔍 **Search Results for "${keyword}":**\n\n`;
            transactions.forEach((t, index) => {
              const dateStr = formatDate(t.date, 'dd MMM yyyy');
              message += `${index + 1}. ${t.description || 'No description'}\n`;
              message += `   Amount: SGD $${t.amountSGD.toFixed(2)}\n`;
              message += `   Category: ${t.category || 'Other'}\n`;
              message += `   Paid by: ${USER_NAMES[t.payer.id.toString()] || t.payer.role}\n`;
              message += `   Date: ${dateStr}\n\n`;
            });
            await ctx.reply(message, { 
              parse_mode: 'Markdown',
              ...this.getMainMenuKeyboard()
            });
          }
        } catch (error: any) {
          console.error('Error searching transactions:', error);
          session.searchMode = false;
          await ctx.reply('Sorry, I encountered an error searching. Please try again.', this.getMainMenuKeyboard());
        }
        return;
      }

      // Handle edit last amount
      if (session.editLastMode && session.editLastAction === 'amount') {
        const amount = parseFloat(textLower.replace(/[^0-9.]/g, ''));
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply('Please enter a valid amount in SGD:');
          return;
        }

        try {
          const transactionId = session.editLastTransactionId;
          if (transactionId) {
            await prisma.transaction.update({
              where: { id: transactionId },
              data: { amountSGD: amount },
            });
            session.editLastMode = false;
            session.editLastAction = undefined;
            session.editLastTransactionId = undefined;
            await ctx.reply(`✅ Amount updated to SGD $${amount.toFixed(2)}.`, this.getMainMenuKeyboard());
          } else {
            // Fallback: get last transaction
            const userId = BigInt(ctx.from.id);
            const lastTransaction = await prisma.transaction.findFirst({
              where: { payerId: userId },
              orderBy: { createdAt: 'desc' },
            });

            if (lastTransaction) {
              await prisma.transaction.update({
                where: { id: lastTransaction.id },
                data: { amountSGD: amount },
              });
              session.editLastMode = false;
              session.editLastAction = undefined;
              await ctx.reply(`✅ Amount updated to SGD $${amount.toFixed(2)}.`, this.getMainMenuKeyboard());
            } else {
              session.editLastMode = false;
              session.editLastAction = undefined;
              await ctx.reply('No transaction found to update.', this.getMainMenuKeyboard());
            }
          }
        } catch (error: any) {
          console.error('Error updating amount:', error);
          session.editLastMode = false;
          session.editLastAction = undefined;
          session.editLastTransactionId = undefined;
          await ctx.reply('Sorry, I encountered an error. Please try again.', this.getMainMenuKeyboard());
        }
        return;
      }

      // Handle edit split percentage
      if (session.editLastMode && session.editLastAction === 'split') {
        const bryanPercentage = parseFloat(textLower.replace(/[^0-9.]/g, ''));
        if (isNaN(bryanPercentage) || bryanPercentage < 0 || bryanPercentage > 100) {
          await ctx.reply('Please enter a valid percentage between 0 and 100 for Bryan\'s share:');
          return;
        }

        const hweiYeenPercentage = 100 - bryanPercentage;

        try {
          const transactionId = session.editLastTransactionId;
          if (transactionId) {
            // Update transaction with split percentages
            // Note: This assumes the Transaction model has bryanPercentage and hweiYeenPercentage fields
            // If not, you'll need to add a database migration first
            await prisma.transaction.update({
              where: { id: transactionId },
              data: { 
                bryanPercentage: bryanPercentage / 100,
                hweiYeenPercentage: hweiYeenPercentage / 100,
              },
            });
            session.editLastMode = false;
            session.editLastAction = undefined;
            session.editLastTransactionId = undefined;
            await ctx.reply(
              `✅ Split updated: Bryan ${bryanPercentage.toFixed(0)}% / Hwei Yeen ${hweiYeenPercentage.toFixed(0)}%`,
              this.getMainMenuKeyboard()
            );
          } else {
            // Fallback: get last transaction
            const userId = BigInt(ctx.from.id);
            const lastTransaction = await prisma.transaction.findFirst({
              where: { payerId: userId },
              orderBy: { createdAt: 'desc' },
            });

            if (lastTransaction) {
              await prisma.transaction.update({
                where: { id: lastTransaction.id },
                data: { 
                  bryanPercentage: bryanPercentage / 100,
                  hweiYeenPercentage: hweiYeenPercentage / 100,
                },
              });
              session.editLastMode = false;
              session.editLastAction = undefined;
              await ctx.reply(
                `✅ Split updated: Bryan ${bryanPercentage.toFixed(0)}% / Hwei Yeen ${hweiYeenPercentage.toFixed(0)}%`,
                this.getMainMenuKeyboard()
              );
            } else {
              session.editLastMode = false;
              session.editLastAction = undefined;
              await ctx.reply('No transaction found to update.', this.getMainMenuKeyboard());
            }
          }
        } catch (error: any) {
          console.error('Error updating split:', error);
          session.editLastMode = false;
          session.editLastAction = undefined;
          session.editLastTransactionId = undefined;
          await ctx.reply(
            'Sorry, I encountered an error. The split percentage fields may need to be added to the database schema first.',
            this.getMainMenuKeyboard()
          );
        }
        return;
      }

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
          const bryanPercent = transaction.bryanPercentage;
          const hweiYeenPercent = transaction.hweiYeenPercentage;
          const transactionOwedMessage = this.expenseService.getTransactionOwedMessage(
            transaction.amountSGD,
            payerRole,
            bryanPercent,
            hweiYeenPercent
          );
          
          // Show outstanding balance
          const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
          
          await ctx.reply(
            `✅ Recorded: ${transaction.description || 'Expense'} ($${transaction.amountSGD.toFixed(2)}) in ${transaction.category || 'Other'}. Paid by ${USER_NAMES[user.id.toString()] || payerRole}.\n\n${transactionOwedMessage}\n\n${balanceMessage}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.reply(
            'Please reply with:\n' +
            '• "bryan" or "1" for Bryan\n' +
            '• "hwei yeen" or "2" for Hwei Yeen'
          );
        }
        return;
      }

      // Handle manual add flow
      if (session.manualAddMode) {
        if (session.manualAddStep === 'description') {
          session.manualDescription = text;
          session.manualAddStep = 'amount';
          await ctx.reply(
            `Description: ${text}\n\n` +
            'How much was it? (Enter amount in SGD)',
            Markup.keyboard([['❌ Cancel']]).resize()
          );
          return;
        } else if (session.manualAddStep === 'amount') {
          const amount = parseFloat(textLower.replace(/[^0-9.]/g, ''));
          if (isNaN(amount) || amount <= 0) {
            await ctx.reply('Please enter a valid amount in SGD:');
            return;
          }
          
          session.manualAmount = amount;
          session.manualAddStep = 'category';
          await ctx.reply(
            `Amount: SGD $${amount.toFixed(2)}\n\n` +
            'Select a Category:',
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🍔 Food', callback_data: 'manual_category_Food' },
                    { text: '🚗 Transport', callback_data: 'manual_category_Transport' },
                  ],
                  [
                    { text: '🛒 Groceries', callback_data: 'manual_category_Groceries' },
                    { text: '🏠 Utilities', callback_data: 'manual_category_Utilities' },
                  ],
                  [
                    { text: '🎬 Entertainment', callback_data: 'manual_category_Entertainment' },
                    { text: '🛍️ Shopping', callback_data: 'manual_category_Shopping' },
                  ],
                  [
                    { text: '🏥 Medical', callback_data: 'manual_category_Medical' },
                    { text: '✈️ Travel', callback_data: 'manual_category_Travel' },
                  ],
                  [
                    { text: '❌ Cancel', callback_data: 'manual_cancel' },
                  ],
                ],
              },
            }
          );
          return;
        } else if (session.manualAddStep === 'payer') {
          // This is handled by callback query for payer buttons
          return;
        }
        return;
      }

      // Handle recurring flow
      if (session.recurringMode) {
        if (session.recurringStep === 'description') {
          session.recurringData = session.recurringData || {};
          session.recurringData.description = text;
          session.recurringStep = 'amount';
          await ctx.reply(
            `Description: ${text}\n\nHow much? (Enter amount in SGD)`,
            Markup.keyboard([['❌ Cancel']]).resize()
          );
          return;
        } else if (session.recurringStep === 'amount') {
          const amount = parseFloat(textLower.replace(/[^0-9.]/g, ''));
          if (isNaN(amount) || amount <= 0) {
            await ctx.reply('Please enter a valid amount in SGD:');
            return;
          }
          session.recurringData = session.recurringData || {};
          session.recurringData.amount = amount;
          session.recurringStep = 'day';
          await ctx.reply(
            `Amount: SGD $${amount.toFixed(2)}\n\nDay of month (1-31)?`,
            Markup.keyboard([['❌ Cancel']]).resize()
          );
          return;
        } else if (session.recurringStep === 'day') {
          const day = parseInt(textLower);
          if (isNaN(day) || day < 1 || day > 31) {
            await ctx.reply('Please enter a valid day (1-31):');
            return;
          }
          session.recurringData = session.recurringData || {};
          session.recurringData.day = day;
          session.recurringStep = 'payer';
          await ctx.reply(
            `Day: ${day}\n\nWho pays?`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Bryan', callback_data: 'recurring_payer_bryan' }],
                  [{ text: 'Hwei Yeen', callback_data: 'recurring_payer_hweiyeen' }],
                  [{ text: '❌ Cancel', callback_data: 'recurring_cancel' }],
                ],
              },
            }
          );
          return;
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

      // Handle manual category selection
      if (callbackData.startsWith('manual_category_')) {
        await ctx.answerCbQuery();
        const category = this.stripEmoji(callbackData.replace('manual_category_', ''));
        session.manualCategory = category;
        session.manualAddStep = 'payer';
        
        await ctx.reply(
          `Category: ${category}\n\nWho paid?`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Bryan', callback_data: 'manual_payer_bryan' }],
                [{ text: 'Hwei Yeen', callback_data: 'manual_payer_hweiyeen' }],
                [{ text: '❌ Cancel', callback_data: 'manual_cancel' }],
              ],
            },
          }
        );
        return;
      }

      // Handle manual payer selection
      if (callbackData.startsWith('manual_payer_')) {
        await ctx.answerCbQuery();
        const payerRole = callbackData.replace('manual_payer_', '') === 'bryan' ? 'Bryan' : 'HweiYeen';
        
        const user = await prisma.user.findFirst({
          where: { role: payerRole },
        });

        if (!user) {
          await ctx.reply('Error: User not found.');
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

        await ctx.reply(
          `✅ Recorded: ${transaction.description} ($${transaction.amountSGD.toFixed(2)}) in ${transaction.category}. Paid by ${USER_NAMES[user.id.toString()] || payerRole}.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔀 Adjust Split', callback_data: `adjust_split_${transaction.id}` }],
              ],
            },
          }
        );
        return;
      }

      // Handle manual cancel
      if (callbackData === 'manual_cancel') {
        await ctx.answerCbQuery();
        session.manualAddMode = false;
        session.manualAddStep = undefined;
        await this.showMainMenu(ctx, '❌ Operation cancelled.');
        return;
      }

      // Handle settle confirm
      if (callbackData === 'settle_confirm') {
        await ctx.answerCbQuery();
        const result = await prisma.transaction.updateMany({
          where: { isSettled: false },
          data: { isSettled: true },
        });

        if (result.count > 0) {
          // Get balance to determine who owes whom
          const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
          const match = balanceMessage.match(/(\w+(?:\s+\w+)?)\s+owes\s+(\w+(?:\s+\w+)?)\s+SGD\s+\$([\d.]+)/i);
          
          let settleMessage = '🤝 All Settled! Balance reset.';
          if (match) {
            const debtor = match[1].replace(/Sir|Madam/gi, '').trim();
            const creditor = match[2].replace(/Sir|Madam/gi, '').trim();
            const amount = match[3];
            settleMessage += ` @${creditor}, payment of $${amount} recorded from @${debtor}.`;
          }
          
          await ctx.reply(settleMessage, this.getMainMenuKeyboard());
        } else {
          await ctx.reply('✅ All expenses are already settled!', this.getMainMenuKeyboard());
        }
        return;
      }

      // Handle settle cancel
      if (callbackData === 'settle_cancel') {
        await ctx.answerCbQuery();
        await this.showMainMenu(ctx, '❌ Operation cancelled.');
        return;
      }

      // Handle recurring menu
      if (callbackData === 'recurring_add') {
        await ctx.answerCbQuery();
        if (!session) ctx.session = {};
        session.recurringMode = true;
        session.recurringStep = 'description';
        session.recurringData = {};
        await ctx.reply(
          'Enter description:',
          Markup.keyboard([['❌ Cancel']]).resize()
        );
        return;
      } else if (callbackData === 'recurring_view') {
        await ctx.answerCbQuery();
        const activeRecurring = await prisma.recurringExpense.findMany({
          where: { isActive: true },
          include: { payer: true },
        });
        
        if (activeRecurring.length === 0) {
          await ctx.reply('No active recurring expenses.');
        } else {
          let message = '📋 **Active Recurring Expenses:**\n\n';
          activeRecurring.forEach((r, index) => {
            message += `${index + 1}. ${r.description} - SGD $${r.amountOriginal.toFixed(2)} on day ${r.dayOfMonth} - ${USER_NAMES[r.payer.id.toString()] || 'Unknown'}\n`;
          });
          await ctx.reply(message, { parse_mode: 'Markdown' });
        }
        return;
      } else if (callbackData === 'recurring_remove') {
        await ctx.answerCbQuery();
        const activeRecurring = await prisma.recurringExpense.findMany({
          where: { isActive: true },
          include: { payer: true },
        });
        
        if (activeRecurring.length === 0) {
          await ctx.reply('No active recurring expenses to remove.');
        } else {
          const buttons = activeRecurring.map((r, index) => [
            { text: `${index + 1}. ${r.description}`, callback_data: `recurring_delete_${r.id}` }
          ]);
          buttons.push([{ text: '❌ Cancel', callback_data: 'recurring_cancel' }]);
          
          await ctx.reply(
            'Select recurring expense to remove:',
            { reply_markup: { inline_keyboard: buttons } }
          );
        }
        return;
      } else if (callbackData.startsWith('recurring_delete_')) {
        await ctx.answerCbQuery();
        const id = BigInt(callbackData.replace('recurring_delete_', ''));
        await prisma.recurringExpense.update({
          where: { id },
          data: { isActive: false },
        });
        await ctx.reply('✅ Recurring expense removed.', this.getMainMenuKeyboard());
        return;
      } else if (callbackData.startsWith('recurring_payer_')) {
        await ctx.answerCbQuery();
        const payerRole = callbackData.replace('recurring_payer_', '') === 'bryan' ? 'Bryan' : 'HweiYeen';
        const user = await prisma.user.findFirst({
          where: { role: payerRole },
        });

        if (!user || !session.recurringData) {
          await ctx.reply('Error: Missing data. Please try again.');
          session.recurringMode = false;
          return;
        }

        const recurringExpense = await prisma.recurringExpense.create({
          data: {
            description: session.recurringData.description || '',
            amountOriginal: session.recurringData.amount || 0,
            payerId: user.id,
            dayOfMonth: session.recurringData.day || 1,
            isActive: true,
          },
        });

        session.recurringMode = false;
        session.recurringStep = undefined;
        session.recurringData = undefined;

        await ctx.reply(
          `✅ Recurring expense added!\n\n` +
          `Description: ${recurringExpense.description}\n` +
          `Amount: SGD $${recurringExpense.amountOriginal.toFixed(2)}\n` +
          `Day of month: ${recurringExpense.dayOfMonth}\n` +
          `Payer: ${USER_NAMES[user.id.toString()] || payerRole}\n\n` +
          `This expense will be automatically processed on the ${recurringExpense.dayOfMonth}${this.getOrdinalSuffix(recurringExpense.dayOfMonth)} of each month at 09:00 SGT.`,
          this.getMainMenuKeyboard()
        );
        return;
      } else if (callbackData === 'recurring_cancel') {
        await ctx.answerCbQuery();
        session.recurringMode = false;
        session.recurringStep = undefined;
        await this.showMainMenu(ctx, '❌ Operation cancelled.');
        return;
      }

      // Handle adjust split
      if (callbackData.startsWith('adjust_split_')) {
        await ctx.answerCbQuery();
        const transactionId = BigInt(callbackData.replace('adjust_split_', ''));
        
        await ctx.reply(
          'How should this expense be split?',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '⚖️ 50/50', callback_data: `split_50_50_${transactionId}` }],
                [{ text: '👤 100% Payer Only', callback_data: `split_payer_only_${transactionId}` }],
                [{ text: '🔙 Cancel', callback_data: `split_cancel_${transactionId}` }],
              ],
            },
          }
        );
        return;
      }

      // Handle split selection
      if (callbackData.startsWith('split_50_50_')) {
        await ctx.answerCbQuery();
        const transactionId = BigInt(callbackData.replace('split_50_50_', ''));
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { splitType: 'FIFTY_FIFTY' as any },
        });
        await ctx.reply('✅ Split updated to 50/50.', this.getMainMenuKeyboard());
        return;
      } else if (callbackData.startsWith('split_payer_only_')) {
        await ctx.answerCbQuery();
        const transactionId = BigInt(callbackData.replace('split_payer_only_', ''));
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { splitType: 'PAYER_ONLY' as any },
        });
        await ctx.reply('✅ Split updated to 100% Payer Only.', this.getMainMenuKeyboard());
        return;
      } else if (callbackData.startsWith('split_cancel_')) {
        await ctx.answerCbQuery();
        await this.showMainMenu(ctx, '❌ Operation cancelled.');
        return;
      }

      // Handle edit last
      if (callbackData.startsWith('edit_last_')) {
        await ctx.answerCbQuery();
        const parts = callbackData.replace('edit_last_', '').split('_');
        const action = parts[0];
        const transactionId = parts.length > 1 ? BigInt(parts.slice(1).join('_')) : null;
        
        if (action === 'amount') {
          if (!session) ctx.session = {};
          session.editLastMode = true;
          session.editLastAction = 'amount';
          if (transactionId) {
            session.editLastTransactionId = transactionId;
          }
          await ctx.reply(
            'Enter new amount:',
            Markup.keyboard([['❌ Cancel']]).resize()
          );
        } else if (action === 'category') {
          if (transactionId) {
            session.editLastTransactionId = transactionId;
          }
          await ctx.reply(
            'Select new category:',
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🍔 Food', callback_data: `edit_category_Food_${transactionId || ''}` },
                    { text: '🚗 Transport', callback_data: `edit_category_Transport_${transactionId || ''}` },
                  ],
                  [
                    { text: '🛒 Groceries', callback_data: `edit_category_Groceries_${transactionId || ''}` },
                    { text: '🏠 Utilities', callback_data: `edit_category_Utilities_${transactionId || ''}` },
                  ],
                  [
                    { text: '🎬 Entertainment', callback_data: `edit_category_Entertainment_${transactionId || ''}` },
                    { text: '🛍️ Shopping', callback_data: `edit_category_Shopping_${transactionId || ''}` },
                  ],
                  [
                    { text: '🏥 Medical', callback_data: `edit_category_Medical_${transactionId || ''}` },
                    { text: '✈️ Travel', callback_data: `edit_category_Travel_${transactionId || ''}` },
                  ],
                  [
                    { text: '🔙 Cancel', callback_data: 'edit_cancel' },
                  ],
                ],
              },
            }
          );
        } else if (action === 'split') {
          if (!session) ctx.session = {};
          session.editLastMode = true;
          session.editLastAction = 'split';
          if (transactionId) {
            session.editLastTransactionId = transactionId;
          }
          await ctx.reply(
            'Enter split percentage for Bryan (0-100).\n\n' +
            'Examples:\n' +
            '• 70 (for 70/30 split)\n' +
            '• 50 (for 50/50 split)\n' +
            '• 80 (for 80/20 split)\n\n' +
            'Hwei Yeen\'s percentage will be calculated automatically.',
            Markup.keyboard([['❌ Cancel']]).resize()
          );
        } else if (action === 'delete') {
          if (transactionId) {
            await prisma.transaction.delete({
              where: { id: transactionId },
            });
            await ctx.reply('✅ Transaction deleted.', this.getMainMenuKeyboard());
          } else {
            // Fallback: get last transaction
            const lastTransaction = await prisma.transaction.findFirst({
              where: { payerId: BigInt(ctx.from.id) },
              orderBy: { createdAt: 'desc' },
            });
            
            if (lastTransaction) {
              await prisma.transaction.delete({
                where: { id: lastTransaction.id },
              });
              await ctx.reply('✅ Transaction deleted.', this.getMainMenuKeyboard());
            } else {
              await ctx.reply('No transaction found to delete.');
            }
          }
        } else if (action === 'cancel') {
          await this.showMainMenu(ctx, '❌ Operation cancelled.');
        }
        return;
      }

      // Handle edit category
      if (callbackData.startsWith('edit_category_')) {
        await ctx.answerCbQuery();
        const parts = callbackData.replace('edit_category_', '').split('_');
        const category = this.stripEmoji(parts[0]);
        const transactionId = parts.length > 1 ? BigInt(parts.slice(1).join('_')) : null;
        
        if (transactionId) {
          await prisma.transaction.update({
            where: { id: transactionId },
            data: { category },
          });
          await ctx.reply(`✅ Category updated to ${category}.`, this.getMainMenuKeyboard());
        } else {
          // Fallback: get last transaction
          const lastTransaction = await prisma.transaction.findFirst({
            where: { payerId: BigInt(ctx.from.id) },
            orderBy: { createdAt: 'desc' },
          });
          
          if (lastTransaction) {
            await prisma.transaction.update({
              where: { id: lastTransaction.id },
              data: { category },
            });
            await ctx.reply(`✅ Category updated to ${category}.`, this.getMainMenuKeyboard());
          } else {
            await ctx.reply('No transaction found to update.');
          }
        }
        return;
      }

      // Handle edit cancel
      if (callbackData === 'edit_cancel') {
        await ctx.answerCbQuery();
        if (session) {
          session.editLastMode = false;
          session.editLastAction = undefined;
        }
        await this.showMainMenu(ctx, '❌ Operation cancelled.');
        return;
      }

      // Handle history pagination
      if (callbackData.startsWith('history_load_')) {
        await ctx.answerCbQuery();
        const offset = parseInt(callbackData.replace('history_load_', ''));
        if (!isNaN(offset)) {
          await this.showHistory(ctx, offset);
        }
        return;
      }

      // Handle transaction settle (from detail card)
      if (callbackData.startsWith('tx_settle_')) {
        await ctx.answerCbQuery();
        const transactionId = BigInt(callbackData.replace('tx_settle_', ''));
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { isSettled: true },
        });
        await ctx.answerCbQuery('✅ Transaction marked as settled!', { show_alert: true });
        // Refresh the transaction detail card
        await this.showTransactionDetail(ctx, transactionId);
        return;
      }

      // Handle transaction edit (from detail card)
      if (callbackData.startsWith('tx_edit_')) {
        await ctx.answerCbQuery();
        const transactionId = BigInt(callbackData.replace('tx_edit_', ''));
        // Reuse the edit last flow for editing this transaction
        if (!session) ctx.session = {};
        session.editLastMode = true;
        session.editLastAction = 'amount';
        session.editLastTransactionId = transactionId;
        
        await ctx.reply(
          'What would you like to edit?',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📝 Edit Amount', callback_data: `edit_last_amount_${transactionId}` }],
                [{ text: '🏷️ Edit Category', callback_data: `edit_last_category_${transactionId}` }],
                [{ text: '📊 Edit Split %', callback_data: `edit_last_split_${transactionId}` }],
                [{ text: '🔙 Cancel', callback_data: `edit_last_cancel_${transactionId}` }],
              ],
            },
          }
        );
        return;
      }

      // Handle transaction delete (from detail card)
      if (callbackData.startsWith('tx_delete_')) {
        await ctx.answerCbQuery();
        const transactionId = BigInt(callbackData.replace('tx_delete_', ''));
        await prisma.transaction.delete({
          where: { id: transactionId },
        });
        await ctx.reply('✅ Transaction deleted.', this.getMainMenuKeyboard());
        return;
      }

      // Handle main menu button clicks (inline keyboard)
      if (callbackData.startsWith('menu_')) {
        await ctx.answerCbQuery();
        const action = callbackData.replace('menu_', '');
        
        if (action === 'settle') {
          await this.handleSettleUp(ctx);
        } else if (action === 'balance') {
          await this.handleCheckBalance(ctx);
        } else if (action === 'history') {
          await this.showHistory(ctx, 0);
        } else if (action === 'unsettled') {
          await this.handleViewUnsettled(ctx);
        } else if (action === 'add') {
          await this.startManualAdd(ctx);
        } else if (action === 'edit_last') {
          await this.handleEditLast(ctx);
        } else if (action === 'search') {
          await this.startSearch(ctx);
        } else if (action === 'recurring') {
          await this.showRecurringMenu(ctx);
        } else if (action === 'reports') {
          await this.handleReports(ctx);
        }
        return;
      }
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
                message += `   💰 Bryan owes: SGD $${t.bryanOwes.toFixed(2)}\n`;
              } else if (t.hweiYeenOwes > 0) {
                message += `   💰 Hwei Yeen owes: SGD $${t.hweiYeenOwes.toFixed(2)}\n`;
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
        let transactionIds: bigint[] = [];
        
        if (transactions.length > 1) {
          message = `✅ ${transactions.length} expenses recorded!\n\n`;
          transactions.forEach((t, index) => {
            message += `${index + 1}. ${t.description}: $${t.amountSGD.toFixed(2)}\n`;
            transactionIds.push(t.id);
          });
          message += `Total: $${totalAmount.toFixed(2)} | Paid by: ${USER_NAMES[user.id.toString()] || payerRole}\n\n`;
        } else {
          const transaction = transactions[0];
          message = `✅ Recorded: ${transaction.description} ($${transaction.amountSGD.toFixed(2)}) in ${transaction.category || 'Other'}. Paid by ${USER_NAMES[user.id.toString()] || payerRole}.\n\n`;
          transactionIds.push(transaction.id);
        }

        // Calculate transaction-specific amount owed (from total)
        const transactionOwedMessage = this.expenseService.getTransactionOwedMessage(
          totalAmount,
          payerRole
        );
        
        // Show outstanding balance
        const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
        
        message += `${transactionOwedMessage}\n\n${balanceMessage}`;
        
        // Add Adjust Split button for single transaction only
        const keyboard = transactions.length === 1 
          ? {
              inline_keyboard: [
                [{ text: '🔀 Adjust Split', callback_data: `adjust_split_${transactionIds[0]}` }],
              ],
            }
          : undefined;
        
        try {
          await ctx.editMessageText(message, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        } catch (error) {
          // If editing fails, send a new message
          await ctx.reply(message, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
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


import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { AnalyticsService } from '../services/analyticsService';
import { HistoryService } from '../services/historyService';
import { formatDate, getMonthsAgo, getNow } from '../utils/dateHelpers';
import QuickChart from 'quickchart-js';
import { USER_NAMES, USER_IDS, CONFIG } from '../config';

export class CommandHandlers {
  private historyService: HistoryService;

  constructor(
    private expenseService: ExpenseService,
    private analyticsService: AnalyticsService
  ) {
    this.historyService = new HistoryService();
  }

  async handleBalance(ctx: Context) {
    const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
    await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });
  }

  async handlePending(ctx: Context) {
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

      const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
      message += balanceMessage;

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error getting pending transactions:', error);
      await ctx.reply('Sorry, I encountered an error retrieving pending transactions. Please try again.');
    }
  }

  async handleSettle(ctx: Context) {
    try {
      const result = await prisma.transaction.updateMany({
        where: { isSettled: false },
        data: { isSettled: true },
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
  }

  async handleReport(ctx: any) {
    const args = ctx.message.text.split(' ').slice(1);
    let monthOffset = 0;
    
    if (args.length > 0) {
      const offset = parseInt(args[0]);
      if (!isNaN(offset)) {
        monthOffset = offset;
      } else {
        await ctx.reply(
          'Invalid month offset. Use:\n' +
          '`/report` - Current month\n' +
          '`/report 1` - Last month\n',
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }

    try {
      if (CONFIG.FEATURE_FLAGS.ENABLE_NEW_REPORT_FEATURE) {
        await ctx.reply('🚀 [New Feature Enabled] Generating advanced monthly report...');
        // Your new feature logic would go here.
        // For now, we continue to the standard report as well.
      } else {
        await ctx.reply('Generating monthly report... At your service!');
      }

      const report = await this.expenseService.getMonthlyReport(monthOffset);
      const reportDate = getMonthsAgo(monthOffset);
      const monthName = formatDate(reportDate, 'MMMM yyyy');

      if (report.transactionCount === 0) {
        const allTransactions = await prisma.transaction.findMany({
          include: { payer: true },
          orderBy: { date: 'desc' },
        });

        if (allTransactions.length > 0) {
          const transactionsByMonth: { [key: string]: number } = {};
          allTransactions.forEach(t => {
            const monthKey = formatDate(t.date, 'yyyy-MM');
            if (!transactionsByMonth[monthKey]) transactionsByMonth[monthKey] = 0;
            transactionsByMonth[monthKey] += t.amountSGD;
          });

          const monthList = Object.entries(transactionsByMonth)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([key, total]) => {
              const name = formatDate(new Date(key + '-01'), 'MMMM yyyy');
              return `• ${name}: SGD $${total.toFixed(2)}`;
            })
            .join('\n');
          
          await ctx.reply(`No transactions found for ${monthName}.\n\nAvailable months:\n${monthList}`, { parse_mode: 'Markdown' });
          return;
        }
      }

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
          ? report.bryanCategories.map(c => `${c.category}: SGD $${c.amount.toFixed(2)}`).join('\n')
          : 'No categories found') +
        `\n\n**Top Categories - Hwei Yeen:**\n` +
        (report.hweiYeenCategories.length > 0
          ? report.hweiYeenCategories.map(c => `${c.category}: SGD $${c.amount.toFixed(2)}`).join('\n')
          : 'No categories found') +
        `\n\n[View Chart](${chartUrl})`;

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error generating report:', error);
      await ctx.reply('Error generating report.');
    }
  }

  async handleDetailedBalance(ctx: Context) {
    try {
      const message = await this.expenseService.getDetailedBalanceMessage();
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error handling detailed balance:', error);
      await ctx.reply('Sorry, I encountered an error. Please try again.');
    }
  }

  async handleHistory(ctx: any) {
    try {
      const transactions = await this.historyService.getRecentTransactions(20, 0);
      const totalCount = await this.historyService.getTotalTransactionCount();

      if (transactions.length === 0) {
        await ctx.reply('📜 **Transaction History**\n\nNo transactions found.', { parse_mode: 'Markdown' });
        return;
      }

      const lines = ['📜 **Transaction History**\n'];
      for (const tx of transactions) {
        lines.push(this.historyService.formatTransactionListItem(tx));
      }

      const keyboard: any[] = [];
      if (20 < totalCount) {
        keyboard.push([Markup.button.callback('⬇️ Load More', `history_load_20`)]);
      }

      await ctx.reply(lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: keyboard.length > 0 ? Markup.inlineKeyboard(keyboard).reply_markup : undefined,
      });
    } catch (error: any) {
      console.error('Error showing history:', error);
      await ctx.reply('Sorry, I encountered an error retrieving history. Please try again.');
    }
  }

  async handleRecurring(ctx: any) {
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
      const quotedMatchRegular = restOfCommand.match(/^"([^"]+)"\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\w+)$/i);
      const quotedMatchSmart = restOfCommand.match(/^[""]([^""]+)[""]\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\w+)$/i);
      const quotedMatch = quotedMatchRegular || quotedMatchSmart;
      const unquotedMatch = restOfCommand.match(/^(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\w+)$/i);
      
      let description: string = '';
      let amountStr: string = '';
      let dayStr: string = '';
      let payerStr: string = '';
      
      if (quotedMatch) {
        [, description, amountStr, dayStr, payerStr] = quotedMatch;
      } else if (unquotedMatch) {
        [, description, amountStr, dayStr, payerStr] = unquotedMatch;
      } else {
        // Fallback: try to parse manually
        const parts = restOfCommand.split(/\s+/);
        if (parts.length >= 4) {
          if (parts[0].startsWith('"') || parts[0].startsWith('"')) {
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
            description = parts[0];
            amountStr = parts[1];
            dayStr = parts[2];
            payerStr = parts[3];
          }
        } else {
          await ctx.reply(
            'Incorrect format. Use:\n' +
            '`/recurring add "Description" <amount> <day> <payer>`\n\n' +
            'Example: `/recurring add "Internet Bill" 50 15 bryan`',
            { parse_mode: 'Markdown' }
          );
          return;
        }
      }

      // Trim and validate
      description = description?.trim() || '';
      amountStr = amountStr?.trim() || '';
      dayStr = dayStr?.trim() || '';
      payerStr = payerStr?.trim() || '';

      if (!amountStr) {
        await ctx.reply('Error: Could not extract amount from command.', { parse_mode: 'Markdown' });
        return;
      }

      const amount = parseFloat(amountStr);
      const dayOfMonth = parseInt(dayStr);
      payerStr = payerStr.toLowerCase();

      if (isNaN(amount) || amount <= 0) {
        await ctx.reply(`Invalid amount "${amountStr}". Please provide a positive number.`);
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

      const user = await prisma.user.findFirst({
        where: { role: payerRole },
      });

      if (!user) {
        await ctx.reply('Error: User not found in database.');
        return;
      }

      await prisma.recurringExpense.create({
        data: {
          description,
          amountOriginal: amount,
          payerId: user.id,
          dayOfMonth,
          isActive: true,
        },
      });

      const ordinalSuffix = this.getOrdinalSuffix(dayOfMonth);
      await ctx.reply(
        `✅ Recurring expense added!\n\n` +
        `Description: ${description}\n` +
        `Amount: SGD $${amount.toFixed(2)}\n` +
        `Day of month: ${dayOfMonth}\n` +
        `Payer: ${USER_NAMES[user.id.toString()] || payerRole}\n\n` +
        `This expense will be automatically processed on the ${dayOfMonth}${ordinalSuffix} of each month at 09:00 SGT.`
      );
    } catch (error: any) {
      console.error('Error adding recurring expense:', error);
      await ctx.reply('Sorry, I encountered an error adding the recurring expense. Please try again.');
    }
  }

  async handleFixed(ctx: any) {
    const userId = ctx.from?.id?.toString();
    if (userId !== USER_IDS.BRYAN) return;

    try {
      const setting = await prisma.settings.findUnique({ where: { key: 'broken_groups' } });
      if (!setting || !setting.value) {
        await ctx.reply('No groups are currently waiting for a fix.');
        return;
      }

      const groups = setting.value.split(',');
      const message = `✅ <b>Issue Resolved!</b>\n\n` +
        `Thanks for your patience. @bryanseto has fixed the glitch and I'm fully operational again! 🚀`;

      let successCount = 0;
      for (const chatId of groups) {
        try {
          await ctx.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
          successCount++;
        } catch (sendErr) {
          console.error(`Failed to notify group ${chatId}:`, sendErr);
        }
      }

      await prisma.settings.update({
        where: { key: 'broken_groups' },
        data: { value: '' },
      });

      await ctx.reply(`Successfully broadcasted "fixed" message to ${successCount} groups.`);
    } catch (error: any) {
      console.error('Error in /fixed command:', error);
      await ctx.reply(`Error broadcasting fix: ${error.message}`);
    }
  }

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
}


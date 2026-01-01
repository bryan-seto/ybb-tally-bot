import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { AnalyticsService } from '../services/analyticsService';
import { HistoryService } from '../services/historyService';
import { formatDate, getMonthsAgo, getNow } from '../utils/dateHelpers';
import QuickChart from 'quickchart-js';
import { USER_NAMES, CONFIG, USER_IDS, getUserNameByRole, USER_A_ROLE_KEY, USER_B_ROLE_KEY } from '../config';

export class CommandHandlers {
  constructor(
    private expenseService: ExpenseService,
    private analyticsService: AnalyticsService,
    private historyService?: HistoryService
  ) {}

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

      // Get dynamic names from config
      const userAName = getUserNameByRole(USER_A_ROLE_KEY);
      const userBName = getUserNameByRole(USER_B_ROLE_KEY);

      let message = `📋 **All Pending Transactions (${pendingTransactions.length}):**\n\n`;
      
      pendingTransactions.forEach((t, index) => {
        const dateStr = formatDate(t.date, 'dd MMM yyyy');
        message += `${index + 1}. **${t.description}**\n`;
        message += `   Amount: SGD $${t.amount.toFixed(2)}\n`;
        
        // Map database payer name to config name using role
        const payerDisplayName = t.payerRole === USER_A_ROLE_KEY ? userAName : userBName;
        message += `   Paid by: ${payerDisplayName}\n`;
        
        message += `   Category: ${t.category}\n`;
        message += `   Date: ${dateStr}\n`;
        
        if (t.bryanOwes > 0) {
          message += `   💰 ${userAName} owes: SGD $${t.bryanOwes.toFixed(2)}\n`;
        } else if (t.hweiYeenOwes > 0) {
          message += `   💰 ${userBName} owes: SGD $${t.hweiYeenOwes.toFixed(2)}\n`;
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
      await ctx.reply('Generating monthly report... At your service!');

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

      const message = this.expenseService.formatMonthlyReportMessage(report, monthName, chartUrl);
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error generating report:', error);
      await ctx.reply('Error generating report.');
    }
  }

  async handleFixed(ctx: Context) {
    // Security check: Only allow founder (Bryan) to execute
    const userId = ctx.from?.id?.toString();
    if (userId !== USER_IDS.BRYAN) {
      return; // Silently ignore if not founder
    }

    try {
      // Retrieve broken_groups from settings
      const setting = await prisma.settings.findUnique({
        where: { key: 'broken_groups' },
      });

      if (!setting || !setting.value || setting.value.trim() === '') {
        await ctx.reply('✅ No broken groups to notify. All systems operational!');
        return;
      }

      const groupIds = setting.value.split(',').filter(id => id.trim() !== '');
      
      if (groupIds.length === 0) {
        await ctx.reply('✅ No broken groups to notify. All systems operational!');
        return;
      }

      // Broadcast resolution message to all broken groups
      let successCount = 0;
      let failCount = 0;

      for (const groupId of groupIds) {
        try {
          await ctx.telegram.sendMessage(
            groupId.trim(),
            `✅ **Issue Resolved**\n\n` +
            `The bot is back online and fully operational. Thank you for your patience!`,
            { parse_mode: 'Markdown' }
          );
          successCount++;
        } catch (error: any) {
          console.error(`Failed to send message to group ${groupId}:`, error);
          failCount++;
        }
      }

      // Clear the broken_groups setting
      await prisma.settings.update({
        where: { key: 'broken_groups' },
        data: { value: '' },
      });

      // Reply to admin with summary
      const summary = `✅ **Successfully broadcasted fix notification**\n\n` +
        `• Groups notified: ${successCount}\n` +
        (failCount > 0 ? `• Failed: ${failCount}\n` : '') +
        `• Broken groups list cleared.`;
      
      await ctx.reply(summary, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error handling /fixed command:', error);
      await ctx.reply('❌ Error processing /fixed command. Please try again.');
    }
  }

  async handleHistory(ctx: Context) {
    if (!this.historyService) {
      await ctx.reply('History service not available.');
      return;
    }

    try {
      const transactions = await this.historyService.getRecentTransactions(20, 0);
      const totalCount = await this.historyService.getTotalTransactionCount();

      if (transactions.length === 0) {
        await ctx.reply('📜 **Transaction History**\n\nNo transactions found.', { parse_mode: 'Markdown' });
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
      if (20 < totalCount) {
        keyboard.push([
          Markup.button.callback('⬇️ Load More', `history_load_20`)
        ]);
      }

      const replyMarkup = keyboard.length > 0 ? Markup.inlineKeyboard(keyboard) : undefined;

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup?.reply_markup,
      });
    } catch (error: any) {
      console.error('Error showing history:', error);
      await ctx.reply('Sorry, I encountered an error retrieving history. Please try again.');
    }
  }

  async handleDetailedBalance(ctx: Context) {
    try {
      const detailedBalanceMessage = await this.expenseService.getDetailedBalanceMessage();
      await ctx.reply(detailedBalanceMessage, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error getting detailed balance:', error);
      await ctx.reply('Sorry, I encountered an error retrieving detailed balance. Please try again.');
    }
  }
}


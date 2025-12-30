import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { formatDate, getMonthsAgo, getNow } from '../utils/dateHelpers';
import QuickChart from 'quickchart-js';
import { USER_NAMES, CONFIG } from '../config';

export class CommandHandlers {
  constructor(
    private expenseService: ExpenseService
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
}


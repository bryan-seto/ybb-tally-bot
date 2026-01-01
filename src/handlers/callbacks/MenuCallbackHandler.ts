import { Context, Markup } from 'telegraf';
import QuickChart from 'quickchart-js';
import { prisma } from '../../lib/prisma';
import { USER_NAMES } from '../../config';
import { ICallbackHandler } from './ICallbackHandler';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';
import { getMonthsAgo, formatDate } from '../../utils/dateHelpers';

/**
 * Handler for menu navigation callbacks
 */
export class MenuCallbackHandler implements ICallbackHandler {
  constructor(
    private expenseService: ExpenseService,
    private historyService: HistoryService,
    private recurringExpenseService: RecurringExpenseService,
    private showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {}

  canHandle(data: string): boolean {
    return data === 'open_menu' || 
           data === 'menu_search' || 
           data === 'menu_reports' || 
           data === 'menu_balance' || 
           data === 'menu_unsettled' || 
           data === 'menu_history' || 
           data === 'menu_add' ||
           data === 'menu_edit_last';
  }

  async handle(ctx: any, data: string): Promise<void> {
    const session = ctx.session;

    if (data === 'open_menu') {
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        '🛠️ **Tools Menu**\n\nSelect an option:',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔍 Search', callback_data: 'menu_search' },
                { text: '📊 Reports', callback_data: 'menu_reports' },
              ],
              [
                { text: '🔄 Recurring', callback_data: 'menu_recurring' },
                { text: '❓ User Guide', url: 'https://github.com/bryan-seto/ybb-tally-bot/blob/main/USER_GUIDE.md' },
              ],
              [
                { text: '« Back', callback_data: 'back_to_dashboard' },
              ],
            ],
          },
          parse_mode: 'Markdown',
        }
      );
      return;
    }

    if (data === 'menu_balance') {
      await ctx.answerCbQuery();
      
      const message = await this.expenseService.getDetailedBalanceMessage();
      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }

    if (data === 'menu_unsettled') {
      await ctx.answerCbQuery();
      
      const pendingTransactions = await this.expenseService.getAllPendingTransactions();
      
      if (pendingTransactions.length === 0) {
        await ctx.reply('✅ All expenses are settled! No unsettled transactions.');
        return;
      }
      
      const last10 = pendingTransactions.slice(0, 10);
      let message = `🧾 **Unsettled Transactions**\n\n`;
      last10.forEach((t, index) => {
        const dateStr = formatDate(t.date, 'dd MMM yyyy');
        message += `${index + 1}. ${dateStr} - ${t.description} ($${t.amount.toFixed(2)}) - ${t.payerName}\n`;
      });
      message += `\n**Total Unsettled Transactions: ${pendingTransactions.length}**`;
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }

    if (data === 'menu_add') {
      await ctx.answerCbQuery();
      
      session.manualAddMode = true;
      session.manualAddStep = 'description';
      await ctx.reply('What is the description for the expense?', Markup.keyboard([['❌ Cancel']]).resize());
      return;
    }

    if (data === 'menu_search') {
      await ctx.answerCbQuery();
      
      session.searchMode = true;
      await ctx.reply('Type a keyword to search (e.g., "Grab" or "Sushi"):', Markup.keyboard([['❌ Cancel']]).resize());
      return;
    }

    if (data === 'menu_reports') {
      await ctx.answerCbQuery();
      
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

      const message = this.expenseService.formatMonthlyReportMessage(report, monthName, chartUrl);
      await ctx.reply(message, { parse_mode: 'Markdown' });
      return;
    }

    if (data === 'menu_edit_last') {
      await ctx.answerCbQuery();
      
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
              [{ text: '🔙 Cancel', callback_data: `edit_last_cancel` }],
            ],
          },
        }
      );
      return;
    }
  }
}


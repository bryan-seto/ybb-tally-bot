import { Markup } from 'telegraf';
import { ExpenseService } from '../services/expenseService';
import { HistoryService } from '../services/historyService';
import { formatDate, getMonthsAgo } from '../utils/dateHelpers';
import { USER_NAMES } from '../config';
import QuickChart from 'quickchart-js';
import { prisma } from '../lib/prisma';

export class MenuHandlers {
  private expenseService: ExpenseService;
  private historyService: HistoryService;

  constructor(expenseService: ExpenseService, historyService: HistoryService) {
    this.expenseService = expenseService;
    this.historyService = historyService;
  }

  /**
   * Get greeting for user
   */
  getGreeting(userId: string): string {
    const name = USER_NAMES[userId] || 'there';
    const env = process.env.NODE_ENV || 'development';
    const prefix = env !== 'production' ? `[${env.toUpperCase()}] ` : '';
    return `${prefix}Hi ${name}!`;
  }

  /**
   * Get main menu keyboard (inline keyboard for groups)
   */
  getMainMenuKeyboard() {
    return {
      reply_markup: {
        inline_keyboard: [
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
        ],
      },
    };
  }

  /**
   * Show main menu
   */
  async showMainMenu(ctx: any, message?: string) {
    const greeting = this.getGreeting(ctx.from.id.toString());
    const menuMessage = message || 
      `👋 ${greeting}! I'm ready to track.\n\n` +
      `📸 Quick Record: Simply send photos of your receipts or screenshots. I can handle single photos or a batch of them at once.\n\n` +
      `👇 Or tap a button below:`;
    
    const keyboard = this.getMainMenuKeyboard();
    
    try {
      await ctx.reply(menuMessage, keyboard);
    } catch (error: any) {
      console.error('Error sending main menu:', error);
      console.error('Error stack:', error.stack);
      await ctx.reply(menuMessage);
    }
  }

  /**
   * Start manual add flow
   */
  async startManualAdd(ctx: any) {
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
  async handleSettleUp(ctx: any) {
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
                [
                  { text: '✅ Yes, Settle', callback_data: 'settle_confirm' },
                  { text: '❌ No, Cancel', callback_data: 'settle_cancel' },
                ],
              ],
            },
          }
        );
      } else {
        // No debt or already balanced
        await ctx.reply(balanceMessage);
      }
    } catch (error: any) {
      console.error('Error handling settle up:', error);
      await ctx.reply('Sorry, I encountered an error. Please try again.');
    }
  }

  /**
   * Handle check balance
   */
  async handleCheckBalance(ctx: any) {
    try {
      const message = await this.expenseService.getDetailedBalanceMessage();
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error handling check balance:', error);
      await ctx.reply('Sorry, I encountered an error. Please try again.');
    }
  }

  /**
   * Handle view unsettled
   */
  async handleViewUnsettled(ctx: any) {
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
  async handleReports(ctx: any) {
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
  async showRecurringMenu(ctx: any) {
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
  async handleEditLast(ctx: any) {
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
  async startSearch(ctx: any) {
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
  async showHistory(ctx: any, offset: number = 0) {
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
  async showTransactionDetail(ctx: any, transactionId: bigint) {
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
}


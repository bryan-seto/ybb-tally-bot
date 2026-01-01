import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { HistoryService } from '../services/historyService';
import { RecurringExpenseService } from '../services/recurringExpenseService';
import { USER_NAMES } from '../config';
import { getNow, getMonthsAgo, formatDate, getNextRecurringDate } from '../utils/dateHelpers';
import QuickChart from 'quickchart-js';

export class CallbackHandlers {
  constructor(
    private expenseService: ExpenseService,
    private historyService: HistoryService,
    private recurringExpenseService: RecurringExpenseService,
    private showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {}

  /**
   * Show loading message and return message ID
   */
  private async showLoadingMessage(ctx: any): Promise<number | null> {
    try {
      const loadingMsg = await ctx.reply('⏳ Loading...');
      return loadingMsg.message_id;
    } catch (error) {
      console.error('Error sending loading message:', error);
      return null;
    }
  }

  /**
   * Delete loading message by message ID
   */
  private async deleteLoadingMessage(ctx: any, messageId: number | null): Promise<void> {
    if (messageId) {
      try {
        await ctx.deleteMessage(messageId);
      } catch (error) {
        console.error('Error deleting loading message:', error);
      }
    }
  }

  async handleCallback(ctx: any) {
    if (!ctx.session) ctx.session = {};
    const callbackData = ctx.callbackQuery.data;
    const session = ctx.session;

    try {
      // Dashboard Navigation
      if (callbackData === 'back_to_dashboard') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          if (this.showDashboard) {
            await this.showDashboard(ctx, true);
          }
        } catch (error) {
          console.error('Error showing dashboard:', error);
        } finally {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
        }
        return;
      }

      // Menu Actions
      if (callbackData === 'settle_up' || callbackData === 'menu_settle') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
          
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          
          if (balanceMessage.includes('settled')) {
            await ctx.reply('✅ All expenses are already settled! No outstanding balance.');
            return;
          }

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
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      if (callbackData === 'open_menu') {
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

      if (callbackData === 'view_history' || callbackData === 'menu_history') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          await this.showHistoryView(ctx);
        } catch (error) {
          console.error('Error showing history view:', error);
        } finally {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
        }
        return;
      }

      if (callbackData === 'menu_balance') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const message = await this.expenseService.getDetailedBalanceMessage();
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      if (callbackData === 'menu_history') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          await this.showHistory(ctx, 0);
        } catch (error) {
          console.error('Error showing history:', error);
        } finally {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
        }
        return;
      }

      if (callbackData === 'menu_unsettled') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const pendingTransactions = await this.expenseService.getAllPendingTransactions();
          
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          
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
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      if (callbackData === 'menu_add') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          session.manualAddMode = true;
          session.manualAddStep = 'description';
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('What is the description for the expense?', Markup.keyboard([['❌ Cancel']]).resize());
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error in menu_add:', error);
        }
        return;
      }

      if (callbackData === 'menu_search') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          session.searchMode = true;
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('Type a keyword to search (e.g., "Grab" or "Sushi"):', Markup.keyboard([['❌ Cancel']]).resize());
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error in menu_search:', error);
        }
        return;
      }

      if (callbackData === 'menu_reports') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
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
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      if (callbackData === 'menu_recurring') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply(
            '🔄 **Recurring Expenses**\n\nSelect an option:',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '➕ Add New', callback_data: 'recurring_add_new' }],
                  [{ text: '📋 View Active', callback_data: 'recurring_view' }],
                  [{ text: '❌ Cancel', callback_data: 'recurring_cancel' }],
                ],
              },
              parse_mode: 'Markdown',
            }
          );
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      if (callbackData === 'recurring_view') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          await this.showActiveRecurringExpenses(ctx);
        } catch (error) {
          console.error('Error showing recurring expenses:', error);
        } finally {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
        }
        return;
      }

      // Recurring Add Wizard Callbacks
      if (callbackData === 'recurring_add_new') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          if (!session.recurringData) session.recurringData = {};
          session.recurringMode = true;
          session.recurringStep = 'description';
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply(
            'What is the description for this recurring expense?',
            Markup.keyboard([['❌ Cancel']]).resize()
          );
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error in recurring_add_new:', error);
        }
        return;
      }

      if (callbackData.startsWith('recurring_add_payer_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const payerRole = callbackData.replace('recurring_add_payer_', '') === 'bryan' ? 'Bryan' : 'HweiYeen';
          if (!session.recurringData) session.recurringData = {};
          session.recurringData.payer = payerRole;
          session.recurringStep = 'confirm';

          const { description, amount, day, payer } = session.recurringData;
          const user = await prisma.user.findFirst({ where: { role: payerRole } });
          const payerName = user ? USER_NAMES[user.id.toString()] || payerRole : payerRole;

          const summary = 
            `📋 **Recurring Expense Summary**\n\n` +
            `Description: ${description}\n` +
            `Amount: SGD $${amount?.toFixed(2)}\n` +
            `Day of month: ${day}\n` +
            `Payer: ${payerName}\n\n` +
            `Confirm to save?`;

          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply(summary, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Confirm', callback_data: 'recurring_confirm' }],
                [{ text: '❌ Cancel', callback_data: 'recurring_cancel' }],
              ],
            },
            parse_mode: 'Markdown',
          });
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      if (callbackData === 'recurring_confirm') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const { description, amount, day, payer } = session.recurringData || {};
          
          if (!description || !amount || !day || !payer) {
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.reply('❌ Error: Missing required information. Please start over.');
            session.recurringMode = false;
            session.recurringStep = undefined;
            session.recurringData = undefined;
            return;
          }

          // Validate and convert day to number if needed
          const dayOfMonth = typeof day === 'number' ? day : parseInt(String(day));
          if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.reply('❌ Error: Invalid day of month. Please start over.');
            session.recurringMode = false;
            session.recurringStep = undefined;
            session.recurringData = undefined;
            return;
          }

          // Validate amount
          const amountValue = typeof amount === 'number' ? amount : parseFloat(String(amount));
          if (isNaN(amountValue) || amountValue <= 0) {
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.reply('❌ Error: Invalid amount. Please start over.');
            session.recurringMode = false;
            session.recurringStep = undefined;
            session.recurringData = undefined;
            return;
          }

          const user = await prisma.user.findFirst({
            where: { role: payer as 'Bryan' | 'HweiYeen' },
          });

          if (!user) {
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.reply('❌ Error: User not found in database.');
            session.recurringMode = false;
            session.recurringStep = undefined;
            session.recurringData = undefined;
            return;
          }

          const recurringExpense = await prisma.recurringExpense.create({
            data: {
              description: String(description).trim(),
              amountOriginal: amountValue,
              payerId: user.id,
              dayOfMonth: dayOfMonth,
              isActive: true,
            },
          });

          const payerName = USER_NAMES[user.id.toString()] || payer;
          const nextRunDate = getNextRecurringDate(dayOfMonth);
          const nextRunDateStr = formatDate(nextRunDate, 'dd MMM yyyy \'at\' HH:mm \'SGT\'');

          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply(
            `✅ Recurring expense added!\n\n` +
            `Description: ${description}\n` +
            `Amount: SGD $${amountValue.toFixed(2)}\n` +
            `Day of month: ${dayOfMonth}\n` +
            `Payer: ${payerName}\n\n` +
            `📅 **Next Run:** ${nextRunDateStr}\n` +
            `🆔 **ID:** ${recurringExpense.id.toString()}\n\n` +
            `Will create transaction: **${description}** - SGD $${amountValue.toFixed(2)} (Bills, FULL split)`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '⚡ Test Now', callback_data: `recurring_test_${recurringExpense.id.toString()}` }],
                ],
              },
              parse_mode: 'Markdown',
            }
          );

          // Clear session state
          session.recurringMode = false;
          session.recurringStep = undefined;
          session.recurringData = undefined;
        } catch (error: any) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error adding recurring expense:', error);
          console.error('Error details:', {
            code: error.code,
            meta: error.meta,
            message: error.message,
            sessionData: session.recurringData,
          });
          
          // Provide more specific error message
          let errorMessage = '❌ Sorry, I encountered an error adding the recurring expense. Please try again.';
          if (error.code === 'P2002') {
            errorMessage = '❌ Error: A recurring expense with these details already exists.';
          } else if (error.code === 'P2003') {
            errorMessage = '❌ Error: Invalid payer reference. Please try again.';
          } else if (error.message) {
            errorMessage = `❌ Error: ${error.message}`;
          }
          
          await ctx.reply(errorMessage);
          session.recurringMode = false;
          session.recurringStep = undefined;
          session.recurringData = undefined;
        }
        return;
      }

      // Test recurring expense handler
      if (callbackData.startsWith('recurring_test_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const recurringExpenseId = BigInt(callbackData.replace('recurring_test_', ''));
          
          // Get the recurring expense to pass to the service
          const recurringExpense = await prisma.recurringExpense.findUnique({
            where: { id: recurringExpenseId },
            include: { payer: true },
          });
          
          if (!recurringExpense) {
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.reply('❌ Error: Recurring expense not found.');
            return;
          }
          
          // Process the recurring expense immediately (force mode to bypass day-of-month and already-processed checks)
          const result = await this.recurringExpenseService.processSingleRecurringExpense(recurringExpense, true);
          
          // Check if processing was successful
          if (!result) {
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.reply('❌ Error: Unable to process recurring expense (may have already been processed today).');
            return;
          }
          
          const nextRunDate = getNextRecurringDate(recurringExpense.dayOfMonth);
          const nextRunDateStr = formatDate(nextRunDate, 'dd MMM yyyy \'at\' HH:mm \'SGT\'');
          
          // Build response message
          let message = `⚡ **Test Run Successful!**\n\n`;
          message += `✅ **Transaction Created:**\n`;
          message += `• Description: ${result.transaction.description}\n`;
          message += `• Amount: SGD $${result.transaction.amountSGD.toFixed(2)}\n`;
          message += `• Category: ${result.transaction.category || 'Bills'}\n`;
          message += `• Payer: ${recurringExpense.payer.name}\n`;
          message += `• Split Type: FULL\n\n`;
          message += `${result.message}\n\n`;
          message += `✅ This expense is active and will trigger again on ${nextRunDateStr}.`;
          
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error: any) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error testing recurring expense:', error);
          await ctx.reply(`❌ Error testing recurring expense: ${error.message || 'Unknown error'}`);
        }
        return;
      }

      if (callbackData === 'menu_edit_last') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const userId = BigInt(ctx.from.id);
          const lastTransaction = await prisma.transaction.findFirst({
            where: { payerId: userId },
            orderBy: { createdAt: 'desc' },
            include: { payer: true },
          });

          await this.deleteLoadingMessage(ctx, loadingMsgId);

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
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      // Action Confirmation Callbacks
      if (callbackData === 'settle_confirm') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const result = await prisma.transaction.updateMany({
            where: { isSettled: false },
            data: { isSettled: true },
          });
          
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          
          if (result.count > 0) {
            await ctx.reply(`🤝 All Settled! Marked ${result.count} transactions as paid.`);
            // Return to dashboard after settlement
            if (this.showDashboard) {
              await this.showDashboard(ctx, false);
            }
          } else {
            await ctx.reply('✅ All expenses are already settled!');
          }
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      if (callbackData === 'settle_cancel') {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('Settlement cancelled.');
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error in settle_cancel:', error);
        }
        return;
      }

      if (callbackData === 'recurring_cancel') {
        await ctx.answerCbQuery();
        // Clear recurring session state
        session.recurringMode = false;
        session.recurringStep = undefined;
        session.recurringData = undefined;
        try {
          await ctx.editMessageText('❌ Action cancelled.', Markup.removeKeyboard());
        } catch {
          await ctx.reply('❌ Action cancelled.', Markup.removeKeyboard());
        }
        return;
      }

      if (callbackData === 'edit_last_cancel') {
        await ctx.answerCbQuery();
        await ctx.editMessageText('Edit cancelled.');
        return;
      }

      if (callbackData.startsWith('edit_last_delete_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const id = BigInt(callbackData.replace('edit_last_delete_', ''));
          await prisma.transaction.delete({ where: { id } });
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('🗑️ Transaction deleted.');
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      if (callbackData.startsWith('history_load_')) {
        await ctx.answerCbQuery();
        const offset = parseInt(callbackData.replace('history_load_', ''));
        await this.showHistory(ctx, offset);
        return;
      }

      // Manual Add Callbacks
      if (callbackData.startsWith('manual_category_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          session.manualCategory = callbackData.replace('manual_category_', '');
          session.manualAddStep = 'payer';
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply(`Category: ${session.manualCategory}\n\nWho paid?`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Bryan', callback_data: 'manual_payer_bryan' }],
                [{ text: 'Hwei Yeen', callback_data: 'manual_payer_hweiyeen' }],
              ],
            },
          });
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error in manual_category_:', error);
        }
        return;
      }

      if (callbackData.startsWith('manual_payer_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const role = callbackData.replace('manual_payer_', '') === 'bryan' ? 'Bryan' : 'HweiYeen';
          const user = await prisma.user.findFirst({ where: { role } });
          if (user) {
            await prisma.transaction.create({
              data: {
                amountSGD: session.manualAmount || 0,
                currency: 'SGD',
                category: session.manualCategory || 'Other',
                description: session.manualDescription || '',
                payerId: user.id,
                date: getNow(),
              },
            });
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.reply(`✅ Recorded $${session.manualAmount?.toFixed(2)} paid by ${role}.`, Markup.removeKeyboard());
          }
          session.manualAddMode = false;
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      // Receipt Callbacks
      if (callbackData.startsWith('confirm_receipt_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const receiptId = callbackData.replace('confirm_receipt_', '');
          const pending = session.pendingReceipts?.[receiptId];
          if (!pending) {
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.reply('Error: Receipt data not found.');
            return;
          }

          const user = await prisma.user.findFirst({ where: { role: 'Bryan' } }); // Logic to determine payer or ask
          if (user) {
            await prisma.transaction.create({
              data: {
                amountSGD: pending.amount,
                currency: pending.currency,
                category: pending.category,
                description: pending.merchant,
                payerId: user.id,
                date: getNow(),
              },
            });
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.reply(`✅ Receipt from ${pending.merchant} recorded!`);
            delete session.pendingReceipts[receiptId];
          }
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

      // Transaction view callback (from history list)
      if (callbackData.startsWith('tx_view_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const id = BigInt(callbackData.replace('tx_view_', ''));
          const transaction = await this.historyService.getTransactionById(id);
          
          if (!transaction) {
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.reply('❌ Transaction not found.');
            return;
          }

          const card = this.historyService.formatTransactionDetail(transaction);
          
          // Build inline keyboard buttons
          const keyboard: any[] = [];

          // Only show "Settle Up" if transaction is unsettled
          if (transaction.status === 'unsettled') {
            keyboard.push([
              Markup.button.callback('✅ Settle', `tx_settle_${id}`)
            ]);
          }

          // Edit and Delete buttons
          keyboard.push([
            Markup.button.callback('✨ AI Edit', `tx_edit_${id}`),
            Markup.button.callback('🗑️ Delete', `tx_delete_${id}`),
          ]);

          // Add back button
          keyboard.push([
            { text: '« Back', callback_data: 'view_history' }
          ]);

          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.editMessageText(card, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
          });
        } catch (error: any) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error showing transaction detail:', error);
          await ctx.reply('❌ Error loading transaction. Please try again.');
        }
        return;
      }

      // Transaction action callbacks
      if (callbackData.startsWith('tx_settle_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const id = BigInt(callbackData.replace('tx_settle_', ''));
          await prisma.transaction.update({
            where: { id },
            data: { isSettled: true },
          });
          
          // Re-fetch to get updated status
          const transaction = await this.historyService.getTransactionById(id);
          if (transaction) {
            const card = this.historyService.formatTransactionDetail(transaction);
            // Update keyboard (remove settle button, keep edit/delete)
            const keyboard = [
              [
                Markup.button.callback('✏️ Edit', `tx_edit_${id}`),
                Markup.button.callback('🗑️ Delete', `tx_delete_${id}`),
              ],
            ];
            await this.deleteLoadingMessage(ctx, loadingMsgId);
            await ctx.editMessageText(card, {
              parse_mode: 'Markdown',
              reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
            });
          }
        } catch (error: any) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error settling transaction:', error);
          await ctx.reply('❌ Error settling transaction. Please try again.');
        }
        return;
      }

      if (callbackData.startsWith('tx_delete_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const id = BigInt(callbackData.replace('tx_delete_', ''));
          await prisma.transaction.delete({ where: { id } });
          await ctx.deleteMessage();
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('🗑️ Transaction deleted.');
        } catch (error: any) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error deleting transaction:', error);
          await ctx.reply('❌ Error deleting transaction. Please try again.');
        }
        return;
      }

      if (callbackData.startsWith('tx_edit_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const id = callbackData.replace('tx_edit_', '');
          session.editingTxId = id;
          session.editMode = 'ai_natural_language';
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.reply('What would you like to change for this transaction?', {
            reply_markup: { force_reply: true }
          });
        } catch (error) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          console.error('Error in tx_edit_:', error);
        }
        return;
      }

      // Handle undo expense
      if (callbackData.startsWith('undo_expense_')) {
        await ctx.answerCbQuery();
        const loadingMsgId = await this.showLoadingMessage(ctx);
        
        try {
          const transactionId = BigInt(callbackData.replace('undo_expense_', ''));
          await prisma.transaction.delete({ where: { id: transactionId } });
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          await ctx.editMessageText('❌ Expense cancelled.');
        } catch (error: any) {
          await this.deleteLoadingMessage(ctx, loadingMsgId);
          // Handle double-tap: Record already deleted (P2025)
          if (error.code === 'P2025') {
            await ctx.editMessageText('❌ Expense already cancelled.');
            return;
          }
          await ctx.reply('❌ An error occurred.');
          console.error(error);
        }
        return;
      }

    } catch (error: any) {
      console.error('Callback error:', error);
      await ctx.answerCbQuery('Error processing request', { show_alert: true });
    }
  }

  /**
   * Show transaction history list
   * Handles both callback query context (edit message) and regular message context (reply)
   */
  async showHistory(ctx: any, offset: number = 0) {
    try {
      const transactions = await this.historyService.getRecentTransactions(20, offset);
      const totalCount = await this.historyService.getTotalTransactionCount();

      if (transactions.length === 0) {
        const message = '📜 **Transaction History**\n\nNo transactions found.';
        if (ctx.callbackQuery) {
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
   * Show history view with text list of last 10 transactions
   */
  private async showHistoryView(ctx: any) {
    try {
      const transactions = await this.historyService.getRecentTransactions(10, 0);

      if (transactions.length === 0) {
        const message = '📜 **Recent History (Last 10)**\n\nNo transactions found.';
        const keyboard = Markup.inlineKeyboard([
          [{ text: '« Back to Dashboard', callback_data: 'back_to_dashboard' }],
        ]);
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup,
        });
        return;
      }

      // Build message with header
      let message = '📜 **Recent History (Last 10)**\n\n';

      // Build transaction list using formatTransactionListItem (same as Dashboard)
      const transactionLines = transactions.map(tx => 
        this.historyService.formatTransactionListItem(tx)
      );
      message += transactionLines.join('\n');

      // Add footer tip
      message += '\n\n💡 **Tip:** To fix a mistake, just type \'edit /ID\' followed by the change (e.g., \'edit /15 20\').';

      // Single back button
      const keyboard = Markup.inlineKeyboard([
        [{ text: '« Back to Dashboard', callback_data: 'back_to_dashboard' }],
      ]);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard.reply_markup,
      });
    } catch (error: any) {
      console.error('Error showing history view:', error);
      await ctx.reply('❌ Error loading history. Please try again.');
    }
  }

  /**
   * Show active recurring expenses list
   */
  private async showActiveRecurringExpenses(ctx: any) {
    try {
      const recurringExpenses = await prisma.recurringExpense.findMany({
        where: { isActive: true },
        include: { payer: true },
        orderBy: { dayOfMonth: 'asc' },
      });

      if (recurringExpenses.length === 0) {
        const message = '🔄 **Active Recurring Expenses**\n\nNo active recurring expenses found.';
        const keyboard = Markup.inlineKeyboard([
          [{ text: '« Back', callback_data: 'menu_recurring' }],
        ]);
        
        if (ctx.callbackQuery) {
          await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard.reply_markup,
          });
        } else {
          await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard.reply_markup,
          });
        }
        return;
      }

      // Build message with all active recurring expenses
      let message = '🔄 **Active Recurring Expenses**\n\n';
      
      for (const expense of recurringExpenses) {
        const payerName = USER_NAMES[expense.payer.id.toString()] || expense.payer.name;
        const nextRunDate = getNextRecurringDate(expense.dayOfMonth);
        const nextRunDateStr = formatDate(nextRunDate, 'dd MMM yyyy');
        
        message += `• **${expense.description}**\n`;
        message += `  Amount: SGD $${expense.amountOriginal.toFixed(2)}\n`;
        message += `  Payer: ${payerName}\n`;
        message += `  Day of month: ${expense.dayOfMonth}\n`;
        message += `  Next run: ${nextRunDateStr}\n`;
        
        if (expense.lastProcessedDate) {
          const lastProcessedStr = formatDate(expense.lastProcessedDate, 'dd MMM yyyy');
          message += `  Last processed: ${lastProcessedStr}\n`;
        }
        
        message += '\n';
      }

      const keyboard = Markup.inlineKeyboard([
        [{ text: '« Back', callback_data: 'menu_recurring' }],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup,
        });
      } else {
        await ctx.reply(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup,
        });
      }
    } catch (error: any) {
      console.error('Error showing active recurring expenses:', error);
      await ctx.reply('❌ Error loading recurring expenses. Please try again.');
    }
  }
}


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
    private recurringExpenseService: RecurringExpenseService
  ) {}

  async handleCallback(ctx: any) {
    if (!ctx.session) ctx.session = {};
    const callbackData = ctx.callbackQuery.data;
    const session = ctx.session;

    try {
      // Menu Actions
      if (callbackData === 'menu_settle') {
        await ctx.answerCbQuery();
        const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
        
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
        return;
      }

      if (callbackData === 'menu_balance') {
        await ctx.answerCbQuery();
        // Use the logic from bot.ts's handleCheckBalance which is more detailed
        const bryan = await prisma.user.findFirst({ where: { role: 'Bryan' } });
        const hweiYeen = await prisma.user.findFirst({ where: { role: 'HweiYeen' } });

        if (!bryan || !hweiYeen) {
          await ctx.reply('Error: Users not found in database.');
          return;
        }

        const transactions = await prisma.transaction.findMany({
          where: { isSettled: false },
          include: { payer: true },
        });

        let bryanPaid = 0;
        let hweiYeenPaid = 0;
        let bryanShare = 0;
        let hweiYeenShare = 0;
        let totalAmount = 0;
        let weightedBryanPercent = 0;
        let weightedHweiYeenPercent = 0;

        transactions.forEach((t) => {
          if (t.payerId === bryan.id) bryanPaid += t.amountSGD;
          else if (t.payerId === hweiYeen.id) hweiYeenPaid += t.amountSGD;
          
          const bP = t.bryanPercentage ?? 0.7;
          const hYP = t.hweiYeenPercentage ?? 0.3;
          
          bryanShare += t.amountSGD * bP;
          hweiYeenShare += t.amountSGD * hYP;
          
          totalAmount += t.amountSGD;
          weightedBryanPercent += t.amountSGD * bP;
          weightedHweiYeenPercent += t.amountSGD * hYP;
        });

        const avgBP = totalAmount > 0 ? (weightedBryanPercent / totalAmount) * 100 : 70;
        const avgHYP = totalAmount > 0 ? (weightedHweiYeenPercent / totalAmount) * 100 : 30;
        const totalSpending = bryanPaid + hweiYeenPaid;
        const bryanNet = bryanPaid - bryanShare;
        const hweiYeenNet = hweiYeenPaid - hweiYeenShare;
        
        let message = `💰 **Balance Summary**\n\n`;
        message += `Total Paid by Bryan (Unsettled): SGD $${bryanPaid.toFixed(2)}\n`;
        message += `Total Paid by Hwei Yeen (Unsettled): SGD $${hweiYeenPaid.toFixed(2)}\n`;
        message += `Total Group Spending: SGD $${totalSpending.toFixed(2)}\n\n`;
        message += `**Split Calculation (${avgBP.toFixed(0)}/${avgHYP.toFixed(0)}):**\n`;
        message += `Bryan's share (${avgBP.toFixed(0)}%): SGD $${bryanShare.toFixed(2)}\n`;
        message += `Hwei Yeen's share (${avgHYP.toFixed(0)}%): SGD $${hweiYeenShare.toFixed(2)}\n\n`;
        
        if (bryanNet > 0) message += `👉 Hwei Yeen owes Bryan: SGD $${bryanNet.toFixed(2)}`;
        else if (hweiYeenNet > 0) message += `👉 Bryan owes Hwei Yeen: SGD $${hweiYeenNet.toFixed(2)}`;
        else if (bryanNet < 0) message += `👉 Bryan owes Hwei Yeen: SGD $${Math.abs(bryanNet).toFixed(2)}`;
        else if (hweiYeenNet < 0) message += `👉 Hwei Yeen owes Bryan: SGD $${Math.abs(hweiYeenNet).toFixed(2)}`;
        else message += `✅ All settled!`;
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
        return;
      }

      if (callbackData === 'menu_history') {
        await ctx.answerCbQuery();
        await this.showHistory(ctx, 0);
        return;
      }

      if (callbackData === 'menu_unsettled') {
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

      if (callbackData === 'menu_add') {
        await ctx.answerCbQuery();
        session.manualAddMode = true;
        session.manualAddStep = 'description';
        await ctx.reply('What is the description for the expense?', Markup.keyboard([['❌ Cancel']]).resize());
        return;
      }

      if (callbackData === 'menu_search') {
        await ctx.answerCbQuery();
        session.searchMode = true;
        await ctx.reply('Type a keyword to search (e.g., "Grab" or "Sushi"):', Markup.keyboard([['❌ Cancel']]).resize());
        return;
      }

      if (callbackData === 'menu_reports') {
        await ctx.answerCbQuery();
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
        return;
      }

      if (callbackData === 'menu_recurring') {
        await ctx.answerCbQuery();
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
        return;
      }

      // Recurring Add Wizard Callbacks
      if (callbackData === 'recurring_add_new') {
        await ctx.answerCbQuery();
        if (!session.recurringData) session.recurringData = {};
        session.recurringMode = true;
        session.recurringStep = 'description';
        await ctx.reply(
          'What is the description for this recurring expense?',
          Markup.keyboard([['❌ Cancel']]).resize()
        );
        return;
      }

      if (callbackData.startsWith('recurring_add_payer_')) {
        await ctx.answerCbQuery();
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

        await ctx.reply(summary, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Confirm', callback_data: 'recurring_confirm' }],
              [{ text: '❌ Cancel', callback_data: 'recurring_cancel' }],
            ],
          },
          parse_mode: 'Markdown',
        });
        return;
      }

      if (callbackData === 'recurring_confirm') {
        await ctx.answerCbQuery();
        try {
          const { description, amount, day, payer } = session.recurringData || {};
          
          if (!description || !amount || !day || !payer) {
            await ctx.reply('❌ Error: Missing required information. Please start over.');
            session.recurringMode = false;
            session.recurringStep = undefined;
            session.recurringData = undefined;
            return;
          }

          const user = await prisma.user.findFirst({
            where: { role: payer as 'Bryan' | 'HweiYeen' },
          });

          if (!user) {
            await ctx.reply('❌ Error: User not found in database.');
            session.recurringMode = false;
            session.recurringStep = undefined;
            session.recurringData = undefined;
            return;
          }

          const recurringExpense = await prisma.recurringExpense.create({
            data: {
              description,
              amountOriginal: amount,
              payerId: user.id,
              dayOfMonth: day,
              isActive: true,
            },
          });

          const payerName = USER_NAMES[user.id.toString()] || payer;
          const nextRunDate = getNextRecurringDate(day);
          const nextRunDateStr = formatDate(nextRunDate, 'dd MMM yyyy \'at\' HH:mm \'SGT\'');

          await ctx.reply(
            `✅ Recurring expense added!\n\n` +
            `Description: ${description}\n` +
            `Amount: SGD $${amount.toFixed(2)}\n` +
            `Day of month: ${day}\n` +
            `Payer: ${payerName}\n\n` +
            `📅 **Next Run:** ${nextRunDateStr}\n` +
            `🆔 **ID:** ${recurringExpense.id.toString()}\n\n` +
            `Will create transaction: **${description}** - SGD $${amount.toFixed(2)} (Bills, FULL split)`,
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
          console.error('Error adding recurring expense:', error);
          await ctx.reply('❌ Sorry, I encountered an error adding the recurring expense. Please try again.');
          session.recurringMode = false;
          session.recurringStep = undefined;
          session.recurringData = undefined;
        }
        return;
      }

      // Test recurring expense handler
      if (callbackData.startsWith('recurring_test_')) {
        await ctx.answerCbQuery();
        try {
          const recurringExpenseId = BigInt(callbackData.replace('recurring_test_', ''));
          
          // Get the recurring expense to pass to the service
          const recurringExpense = await prisma.recurringExpense.findUnique({
            where: { id: recurringExpenseId },
            include: { payer: true },
          });
          
          if (!recurringExpense) {
            await ctx.reply('❌ Error: Recurring expense not found.');
            return;
          }
          
          // Process the recurring expense immediately
          const result = await this.recurringExpenseService.processSingleRecurringExpense(recurringExpense);
          
          // Check if processing was successful
          if (!result) {
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
          
          await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error: any) {
          console.error('Error testing recurring expense:', error);
          await ctx.reply(`❌ Error testing recurring expense: ${error.message || 'Unknown error'}`);
        }
        return;
      }

      if (callbackData === 'menu_edit_last') {
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

      // Action Confirmation Callbacks
      if (callbackData === 'settle_confirm') {
        await ctx.answerCbQuery();
        const result = await prisma.transaction.updateMany({
          where: { isSettled: false },
          data: { isSettled: true },
        });
        if (result.count > 0) await ctx.reply(`🤝 All Settled! Marked ${result.count} transactions as paid.`);
        else await ctx.reply('✅ All expenses are already settled!');
        return;
      }

      if (callbackData === 'settle_cancel') {
        await ctx.answerCbQuery();
        await ctx.reply('Settlement cancelled.');
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
        const id = BigInt(callbackData.replace('edit_last_delete_', ''));
        await prisma.transaction.delete({ where: { id } });
        await ctx.reply('🗑️ Transaction deleted.');
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
        session.manualCategory = callbackData.replace('manual_category_', '');
        session.manualAddStep = 'payer';
        await ctx.reply(`Category: ${session.manualCategory}\n\nWho paid?`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Bryan', callback_data: 'manual_payer_bryan' }],
              [{ text: 'Hwei Yeen', callback_data: 'manual_payer_hweiyeen' }],
            ],
          },
        });
        return;
      }

      if (callbackData.startsWith('manual_payer_')) {
        await ctx.answerCbQuery();
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
          await ctx.reply(`✅ Recorded $${session.manualAmount?.toFixed(2)} paid by ${role}.`, Markup.removeKeyboard());
        }
        session.manualAddMode = false;
        return;
      }

      // Receipt Callbacks
      if (callbackData.startsWith('confirm_receipt_')) {
        await ctx.answerCbQuery();
        const receiptId = callbackData.replace('confirm_receipt_', '');
        const pending = session.pendingReceipts?.[receiptId];
        if (!pending) {
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
          await ctx.reply(`✅ Receipt from ${pending.merchant} recorded!`);
          delete session.pendingReceipts[receiptId];
        }
        return;
      }

      // Transaction action callbacks
      if (callbackData.startsWith('tx_settle_')) {
        await ctx.answerCbQuery();
        const id = BigInt(callbackData.replace('tx_settle_', ''));
        
        try {
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
            await ctx.editMessageText(card, {
              parse_mode: 'Markdown',
              reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
            });
          }
        } catch (error: any) {
          console.error('Error settling transaction:', error);
          await ctx.answerCbQuery('Error settling transaction', { show_alert: true });
        }
        return;
      }

      if (callbackData.startsWith('tx_delete_')) {
        await ctx.answerCbQuery();
        const id = BigInt(callbackData.replace('tx_delete_', ''));
        
        try {
          await prisma.transaction.delete({ where: { id } });
          await ctx.deleteMessage();
          await ctx.reply('🗑️ Transaction deleted.');
        } catch (error: any) {
          console.error('Error deleting transaction:', error);
          await ctx.answerCbQuery('Error deleting transaction', { show_alert: true });
        }
        return;
      }

      if (callbackData.startsWith('tx_edit_')) {
        await ctx.answerCbQuery();
        const id = callbackData.replace('tx_edit_', '');
        session.editingTxId = id;
        session.editMode = 'ai_natural_language';
        await ctx.reply('What would you like to change for this transaction?', {
          reply_markup: { force_reply: true }
        });
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


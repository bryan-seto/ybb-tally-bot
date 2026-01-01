import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma';
import { USER_NAMES } from '../../config';
import { ICallbackHandler } from './ICallbackHandler';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';
import { formatDate, getNextRecurringDate } from '../../utils/dateHelpers';

/**
 * Handler for recurring expense callbacks
 */
export class RecurringExpenseCallbackHandler implements ICallbackHandler {
  constructor(
    private expenseService: ExpenseService,
    private historyService: HistoryService,
    private recurringExpenseService: RecurringExpenseService,
    private showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {}

  canHandle(data: string): boolean {
    return data === 'menu_recurring' || data.startsWith('recurring_');
  }

  async handle(ctx: any, data: string): Promise<void> {
    const session = ctx.session;

    if (data === 'menu_recurring') {
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

    if (data === 'recurring_view') {
      await ctx.answerCbQuery();
      await this.showActiveRecurringExpenses(ctx);
      return;
    }

    // Recurring Add Wizard Callbacks
    if (data === 'recurring_add_new') {
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

    if (data.startsWith('recurring_add_payer_')) {
      await ctx.answerCbQuery();
      
      const payerRole = data.replace('recurring_add_payer_', '') === 'bryan' ? 'Bryan' : 'HweiYeen';
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

    if (data === 'recurring_confirm') {
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

        // Validate and convert day to number if needed
        const dayOfMonth = typeof day === 'number' ? day : parseInt(String(day));
        if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
          await ctx.reply('❌ Error: Invalid day of month. Please start over.');
          session.recurringMode = false;
          session.recurringStep = undefined;
          session.recurringData = undefined;
          return;
        }

        // Validate amount
        const amountValue = typeof amount === 'number' ? amount : parseFloat(String(amount));
        if (isNaN(amountValue) || amountValue <= 0) {
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
        // Re-throw to let Router handle it (but we've already handled user notification)
        throw error;
      }
      return;
    }

    // Test recurring expense handler
    if (data.startsWith('recurring_test_')) {
      await ctx.answerCbQuery();
      
      const recurringExpenseId = BigInt(data.replace('recurring_test_', ''));
      
      // Get the recurring expense to pass to the service
      const recurringExpense = await prisma.recurringExpense.findUnique({
        where: { id: recurringExpenseId },
        include: { payer: true },
      });
      
      if (!recurringExpense) {
        await ctx.reply('❌ Error: Recurring expense not found.');
        return;
      }
      
      // Process the recurring expense immediately (force mode to bypass day-of-month and already-processed checks)
      const result = await this.recurringExpenseService.processSingleRecurringExpense(recurringExpense, true);
      
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
      return;
    }

    if (data === 'recurring_cancel') {
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


import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma';
import { USER_NAMES } from '../../config';
import { ICallbackHandler } from './ICallbackHandler';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';
import { formatDate } from '../../utils/dateHelpers';

/**
 * Handler for transaction action callbacks
 */
export class TransactionCallbackHandler implements ICallbackHandler {
  constructor(
    private expenseService: ExpenseService,
    private historyService: HistoryService,
    private recurringExpenseService: RecurringExpenseService,
    private showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {}

  canHandle(data: string): boolean {
    return data.startsWith('tx_') || 
           data.startsWith('edit_last_') || 
           data.startsWith('undo_expense_');
  }

  async handle(ctx: any, data: string): Promise<void> {
    const session = ctx.session;

    // Transaction view callback (from history list)
    if (data.startsWith('tx_view_')) {
      await ctx.answerCbQuery();
      
      const id = BigInt(data.replace('tx_view_', ''));
      const transaction = await this.historyService.getTransactionById(id);
      
      if (!transaction) {
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

      await ctx.editMessageText(card, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
      });
      return;
    }

    // Transaction action callbacks
    if (data.startsWith('tx_settle_')) {
      await ctx.answerCbQuery();
      
      const id = BigInt(data.replace('tx_settle_', ''));
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
      return;
    }

    if (data.startsWith('tx_delete_')) {
      await ctx.answerCbQuery();
      
      const id = BigInt(data.replace('tx_delete_', ''));
      await prisma.transaction.delete({ where: { id } });
      await ctx.deleteMessage();
      await ctx.reply('🗑️ Transaction deleted.');
      return;
    }

    if (data.startsWith('tx_edit_')) {
      await ctx.answerCbQuery();
      
      const id = data.replace('tx_edit_', '');
      session.editingTxId = id;
      session.editMode = 'ai_natural_language';
      await ctx.reply('What would you like to change for this transaction?', {
        reply_markup: { force_reply: true }
      });
      return;
    }

    // Handle undo expense
    if (data.startsWith('undo_expense_')) {
      await ctx.answerCbQuery();
      
      try {
        const transactionId = BigInt(data.replace('undo_expense_', ''));
        await prisma.transaction.delete({ where: { id: transactionId } });
        await ctx.editMessageText('❌ Expense cancelled.');
      } catch (error: any) {
        // Handle double-tap: Record already deleted (P2025)
        if (error.code === 'P2025') {
          await ctx.editMessageText('❌ Expense already cancelled.');
          return;
        }
        // Re-throw other errors to let Router handle them
        throw error;
      }
      return;
    }

    if (data.startsWith('edit_last_delete_')) {
      await ctx.answerCbQuery();
      
      const id = BigInt(data.replace('edit_last_delete_', ''));
      await prisma.transaction.delete({ where: { id } });
      await ctx.reply('🗑️ Transaction deleted.');
      return;
    }

    if (data === 'edit_last_cancel') {
      await ctx.answerCbQuery();
      await ctx.editMessageText('Edit cancelled.');
      return;
    }
  }
}


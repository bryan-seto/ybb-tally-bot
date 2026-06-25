import { Context, Markup } from 'telegraf';
import { ICallbackHandler } from './ICallbackHandler';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';
import { escapeMd } from '../../utils/markdownUtils';

/**
 * Handler for history navigation callbacks
 */
export class HistoryCallbackHandler implements ICallbackHandler {
  constructor(
    private expenseService: ExpenseService,
    private historyService: HistoryService,
    private recurringExpenseService: RecurringExpenseService,
    private showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {}

  canHandle(data: string): boolean {
    return data === 'view_history' || data === 'menu_history' || data.startsWith('history_load_') || data.startsWith('history_tx_');
  }

  async handle(ctx: any, data: string): Promise<void> {
    if (data === 'view_history' || data === 'menu_history') {
      await ctx.answerCbQuery();
      await this.showHistoryView(ctx);
      return;
    }

    if (data.startsWith('history_load_')) {
      await ctx.answerCbQuery();
      const offset = parseInt(data.replace('history_load_', ''));
      await this.showHistory(ctx, offset);
      return;
    }

    // Tap on an individual transaction row → show detail card
    if (data.startsWith('history_tx_')) {
      await ctx.answerCbQuery();
      const txId = BigInt(data.replace('history_tx_', ''));
      const transaction = await this.historyService.getTransactionById(txId);
      if (!transaction) {
        await ctx.answerCbQuery('Transaction not found', { show_alert: true });
        return;
      }
      const card = this.historyService.formatTransactionDetail(transaction);
      const keyboard = Markup.inlineKeyboard([
        [{ text: '« Back to History', callback_data: 'view_history' }],
      ]);
      try {
        await ctx.editMessageText(card, {
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup,
        });
      } catch {
        await ctx.reply(card, {
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup,
        });
      }
      return;
    }
  }

  /**
   * Show transaction history list
   * Handles both callback query context (edit message) and regular message context (reply)
   */
  private async showHistory(ctx: any, offset: number = 0) {
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

      // Add per-transaction tappable buttons (one per row)
      const keyboard: any[] = transactions.map(tx => [
        Markup.button.callback(
          `/${tx.id} ${tx.status === 'settled' ? '✅' : '🔴'} ${tx.merchant.slice(0, 20)}`,
          `history_tx_${tx.id}`
        ),
      ]);

      // Add pagination button if there are more transactions
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
      message += '\n\n💡 **Tip:** Tap an ID to view details. To edit: type \'edit /15 20\' (change amount) or \'edit /15 lunch\' (change name).';

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
}



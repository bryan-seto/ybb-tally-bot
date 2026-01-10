import { BaseMessageHandler } from './BaseMessageHandler';
import { HistoryService, TransactionDetail } from '../../services/historyService';
import { Markup } from 'telegraf';

/**
 * Handler for transaction ID commands (e.g., /77, /74)
 * Shows transaction detail card when user sends a transaction ID
 */
export class TransactionDetailHandler extends BaseMessageHandler {
  constructor(
    expenseService: any,
    aiService: any,
    historyService: HistoryService,
    sessionManager: any,
    showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {
    super(expenseService, aiService, historyService, sessionManager, undefined, showDashboard);
  }

  canHandle(text: string, session: any): boolean {
    // Match transaction ID pattern: /77, /74, etc.
    const txIdMatch = text.match(/^\/(\d+)$/);
    return !!txIdMatch;
  }

  async handle(ctx: any, text: string): Promise<void> {
    const txIdMatch = text.match(/^\/(\d+)$/);
    if (!txIdMatch) {
      return;
    }

    try {
      const transactionId = BigInt(txIdMatch[1]);
      await this.showTransactionDetail(ctx, transactionId);
    } catch (error: any) {
      console.error('Error parsing transaction ID:', error);
      await ctx.reply(`❌ Invalid transaction ID: ${txIdMatch[1]}`);
    }
  }

  /**
   * Show transaction detail card
   * Public method so it can be used by other handlers (e.g., EditHandler)
   * @param ctx - Telegram context
   * @param transactionId - Transaction ID to fetch (if transactionDetail not provided)
   * @param transactionDetail - Optional pre-fetched transaction detail to avoid re-fetching
   */
  async showTransactionDetail(ctx: any, transactionId: bigint, transactionDetail?: TransactionDetail): Promise<void> {
    try {
      // Use provided transaction detail or fetch from database
      const transaction = transactionDetail || await this.historyService.getTransactionById(transactionId);

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
        Markup.button.callback('✨ AI Edit', `tx_edit_${transactionId}`),
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

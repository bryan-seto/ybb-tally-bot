import { BaseMessageHandler } from './BaseMessageHandler';
import { ExpenseService } from '../../services/expenseService';
import { AIService } from '../../services/ai';
import { HistoryService } from '../../services/historyService';
import { SessionManager } from './SessionManager';

/**
 * Handler for manual expense entry flow
 * Multi-step process: description → amount → category (via callback)
 */
export class ManualAddHandler extends BaseMessageHandler {
  constructor(
    expenseService: ExpenseService,
    aiService: AIService,
    historyService: HistoryService,
    sessionManager: SessionManager
  ) {
    super(expenseService, aiService, historyService, sessionManager);
  }

  canHandle(text: string, session: any): boolean {
    // Only handle if in manual add mode
    return this.sessionManager.isManualAddMode(session);
  }

  async handle(ctx: any, text: string): Promise<void> {
    const session = ctx.session || {};

    if (session.manualAddStep === 'description') {
      session.manualDescription = text;
      session.manualAddStep = 'amount';
      await ctx.reply(`Description: ${text}\n\nAmount in SGD?`);
    } else if (session.manualAddStep === 'amount') {
      // Validate: must be a positive number (integers and decimals allowed, negatives/zero rejected)
      const trimmed = text.trim();
      const amount = parseFloat(trimmed);
      if (isNaN(amount) || amount <= 0 || !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
        if (amount < 0 || trimmed.startsWith('-')) {
          await ctx.reply('❌ Amount must be positive. Please enter a number (e.g. 12.50):');
        } else if (amount === 0) {
          await ctx.reply('❌ Amount must be greater than zero. Please enter a number (e.g. 5):');
        } else {
          await ctx.reply('❌ Invalid amount. Please enter a number (e.g. 12.50):');
        }
        return;
      }
      session.manualAmount = amount;
      session.manualAddStep = 'category';
      
      await ctx.reply('Select a category:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🍔 Food', callback_data: 'manual_category_Food' }, { text: '🚗 Transport', callback_data: 'manual_category_Transport' }],
            [{ text: '🛒 Groceries', callback_data: 'manual_category_Groceries' }, { text: '🛍️ Shopping', callback_data: 'manual_category_Shopping' }],
            [{ text: '🏠 Utilities', callback_data: 'manual_category_Bills' }, { text: '🎬 Entertainment', callback_data: 'manual_category_Entertainment' }],
            [{ text: '🏥 Medical', callback_data: 'manual_category_Medical' }, { text: '✈️ Travel', callback_data: 'manual_category_Travel' }],
            [{ text: 'Other', callback_data: 'manual_category_Other' }],
          ],
        },
      });
    }
  }
}

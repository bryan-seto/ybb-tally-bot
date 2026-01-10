import { BaseMessageHandler } from './BaseMessageHandler';
import { ExpenseService } from '../../services/expenseService';
import { AIService } from '../../services/ai';
import { HistoryService } from '../../services/historyService';
import { SessionManager } from './SessionManager';
import { getUserAName, getUserBName } from '../../config';

/**
 * Handler for recurring expense setup flow
 * Multi-step process: description → amount → day → payer (via callback)
 */
export class RecurringHandler extends BaseMessageHandler {
  constructor(
    expenseService: ExpenseService,
    aiService: AIService,
    historyService: HistoryService,
    sessionManager: SessionManager
  ) {
    super(expenseService, aiService, historyService, sessionManager);
  }

  canHandle(text: string, session: any): boolean {
    // Only handle if in recurring mode
    return this.sessionManager.isRecurringMode(session);
  }

  async handle(ctx: any, text: string): Promise<void> {
    const session = ctx.session || {};
    
    if (!session.recurringData) {
      session.recurringData = {};
    }

    if (session.recurringStep === 'description') {
      if (!text || text.trim().length === 0) {
        await ctx.reply('Please enter a valid description:');
        return;
      }
      session.recurringData.description = text.trim();
      session.recurringStep = 'amount';
      await ctx.reply(`Description: ${text}\n\nWhat is the amount in SGD?`);
    } else if (session.recurringStep === 'amount') {
      const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Invalid amount. Please enter a positive number:');
        return;
      }
      session.recurringData.amount = amount;
      session.recurringStep = 'day';
      await ctx.reply(`Amount: SGD $${amount.toFixed(2)}\n\nWhich day of the month should this expense be processed? (1-31)`);
    } else if (session.recurringStep === 'day') {
      const day = parseInt(text.trim());
      if (isNaN(day) || day < 1 || day > 31) {
        await ctx.reply('Invalid day. Please enter a number between 1 and 31:');
        return;
      }
      session.recurringData.day = day;
      session.recurringStep = 'payer';
      await ctx.reply(`Day of month: ${day}\n\nWho pays for this expense?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: getUserAName(), callback_data: 'recurring_add_payer_bryan' }],
            [{ text: getUserBName(), callback_data: 'recurring_add_payer_hweiyeen' }],
          ],
        },
      });
    }
  }
}

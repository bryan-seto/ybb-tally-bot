import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma';
import { ICallbackHandler } from './ICallbackHandler';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';

/**
 * Handler for settlement flow callbacks
 */
export class SettleCallbackHandler implements ICallbackHandler {
  constructor(
    private expenseService: ExpenseService,
    private historyService: HistoryService,
    private recurringExpenseService: RecurringExpenseService,
    private showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {}

  canHandle(data: string): boolean {
    return data === 'settle_up' || data === 'menu_settle' || data === 'settle_confirm' || data === 'settle_cancel';
  }

  async handle(ctx: any, data: string): Promise<void> {
    const session = ctx.session;

    if (data === 'settle_up' || data === 'menu_settle') {
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

    if (data === 'settle_confirm') {
      await ctx.answerCbQuery();
      
      const result = await prisma.transaction.updateMany({
        where: { isSettled: false },
        data: { isSettled: true },
      });
      
      if (result.count > 0) {
        await ctx.reply(`🤝 All Settled! Marked ${result.count} transactions as paid.`);
        // Return to dashboard after settlement
        if (this.showDashboard) {
          await this.showDashboard(ctx, false);
        }
      } else {
        await ctx.reply('✅ All expenses are already settled!');
      }
      return;
    }

    if (data === 'settle_cancel') {
      await ctx.answerCbQuery();
      await ctx.reply('Settlement cancelled.');
      return;
    }
  }
}



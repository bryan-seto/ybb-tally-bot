import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma';
import { ICallbackHandler } from './ICallbackHandler';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';
import { getNow } from '../../utils/dateHelpers';

/**
 * Handler for manual add flow callbacks
 */
export class ManualAddCallbackHandler implements ICallbackHandler {
  constructor(
    private expenseService: ExpenseService,
    private historyService: HistoryService,
    private recurringExpenseService: RecurringExpenseService,
    private showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {}

  canHandle(data: string): boolean {
    return data.startsWith('manual_') || data.startsWith('confirm_receipt_');
  }

  async handle(ctx: any, data: string): Promise<void> {
    const session = ctx.session;

    // Manual Add Callbacks
    if (data.startsWith('manual_category_')) {
      await ctx.answerCbQuery();
      
      session.manualCategory = data.replace('manual_category_', '');
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

    if (data.startsWith('manual_payer_')) {
      await ctx.answerCbQuery();
      
      const role = data.replace('manual_payer_', '') === 'bryan' ? 'Bryan' : 'HweiYeen';
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
    if (data.startsWith('confirm_receipt_')) {
      await ctx.answerCbQuery();
      
      const receiptId = data.replace('confirm_receipt_', '');
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
  }
}


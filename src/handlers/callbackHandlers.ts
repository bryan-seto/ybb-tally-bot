import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { USER_NAMES } from '../config';
import { getNow } from '../utils/dateHelpers';

export class CallbackHandlers {
  constructor(private expenseService: ExpenseService) {}

  async handleCallback(ctx: any) {
    if (!ctx.session) ctx.session = {};
    const callbackData = ctx.callbackQuery.data;
    const session = ctx.session;

    if (callbackData === 'settle_confirm') {
      await ctx.answerCbQuery();
      const result = await prisma.transaction.updateMany({
        where: { isSettled: false },
        data: { isSettled: true },
      });

      if (result.count > 0) {
        await ctx.reply('🤝 All Settled! Balance reset.');
      } else {
        await ctx.reply('✅ All expenses are already settled!');
      }
      return;
    }

    if (callbackData.startsWith('manual_category_')) {
      await ctx.answerCbQuery();
      const category = callbackData.replace('manual_category_', '');
      session.manualCategory = category;
      session.manualAddStep = 'payer';
      await ctx.reply(`Category: ${category}\n\nWho paid?`, {
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
        await ctx.reply(`✅ Recorded! Paid by ${role}.`);
      }
      session.manualAddMode = false;
      return;
    }
  }
}


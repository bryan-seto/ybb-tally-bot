import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma';
import { ICallbackHandler } from './ICallbackHandler';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';
import { analyticsBus, AnalyticsEventType } from '../../events/analyticsBus';

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
    return data === 'settle_up' || 
           data === 'menu_settle' || 
           data.startsWith('settle_confirm_') || 
           data === 'settle_cancel';
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
      
      // Fetch unsettled transactions for preview
      const unsettled = await prisma.transaction.findMany({
        where: { isSettled: false },
        orderBy: { id: 'desc' }
      });
      
      if (unsettled.length === 0) {
        await ctx.reply('✅ All expenses are already settled! No outstanding balance.');
        return;
      }
      
      const watermarkID = unsettled[0].id.toString(); // Convert to string
      const totalAmount = unsettled.reduce((sum, t) => sum + Number(t.amountSGD), 0);
      const transactionCount = unsettled.length;
      
      await ctx.reply(
        `${balanceMessage}\n\n` +
        `Ready to settle ${transactionCount} transactions for SGD $${totalAmount.toFixed(2)}?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Yes, Settle', callback_data: `settle_confirm_${watermarkID}` }],
              [{ text: '❌ Cancel', callback_data: 'settle_cancel' }],
            ],
          },
          parse_mode: 'Markdown',
        }
      );
      return;
    }

    if (data.startsWith('settle_confirm_')) {
      await ctx.answerCbQuery();
      
      try {
        // Parse and validate watermark ID
        const rawId = data.replace('settle_confirm_', '');
        
        // CRITICAL: Validate ID format to prevent injection
        if (!/^\d+$/.test(rawId)) {
          await ctx.reply('❌ Invalid settlement request. Please try again.');
          return;
        }
        
        // Convert to BigInt safely
        const watermarkID = BigInt(rawId);
        
        // Count transactions before settlement for logging
        const transactionsToSettle = await prisma.transaction.findMany({
          where: { 
            isSettled: false,
            id: { lte: watermarkID } // Watermark constraint
          },
          select: { id: true, amountSGD: true },
        });
        
        const transactionIds = transactionsToSettle.map(tx => tx.id.toString());
        const transactionCount = transactionsToSettle.length;
        
        // Idempotency check
        if (transactionCount === 0) {
          await ctx.editMessageText('✅ All expenses are already settled!');
          return;
        }
        
        // Execute settlement with watermark constraint
        const result = await prisma.transaction.updateMany({
          where: {
            isSettled: false,
            id: { lte: watermarkID } // Only settle up to watermark
          },
          data: { isSettled: true },
        });
        
        // Log the settlement operation (legacy systemLog)
        const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
        if (userId) {
          try {
            // Check if user exists before logging
            const userExists = await prisma.user.findUnique({
              where: { id: userId },
              select: { id: true },
            });
            
            if (userExists) {
              await prisma.systemLog.create({
                data: {
                  userId,
                  event: 'settlement_executed',
                  metadata: {
                    method: 'callback_confirm',
                    transactionCount: result.count,
                    watermarkID: rawId, // Store as string
                    transactionIds: transactionIds.slice(0, 100), // Limit to first 100 IDs
                    timestamp: new Date().toISOString(),
                  },
                },
              });
            }
          } catch (logError) {
            console.error('Error logging settlement:', logError);
          }
        }

        // Emit analytics event
        if (userId) {
          const totalAmount = transactionsToSettle.reduce((sum, tx) => sum + Number(tx.amountSGD), 0);
          analyticsBus.emit(AnalyticsEventType.SETTLEMENT_EXECUTED, {
            userId,
            transactionCount: result.count,
            totalAmount,
            watermarkId: rawId,
            transactionIds: transactionsToSettle.map(tx => tx.id),
            chatId: ctx.chat?.id ? BigInt(ctx.chat.id) : undefined,
            chatType: ctx.chat?.type,
          });
        }
        
        // Success response
        await ctx.editMessageText(
          `🤝 All Settled! Marked ${result.count} transaction${result.count > 1 ? 's' : ''} as paid.`
        );
        
        // Return to dashboard after settlement
        if (this.showDashboard) {
          await this.showDashboard(ctx, false);
        }
      } catch (error: any) {
        console.error('Error executing settlement:', error);
        await ctx.editMessageText('❌ Sorry, an error occurred during settlement. Please try again.');
      }
      return;
    }

    if (data === 'settle_cancel') {
      await ctx.answerCbQuery();
      try {
        // Edit the message to show cancellation and remove buttons
        await ctx.editMessageText('❌ Settlement cancelled.', {
          reply_markup: { inline_keyboard: [] } // Remove buttons
        });
      } catch (editError) {
        // If edit fails (e.g., message too old), try to reply
        try {
          await ctx.reply('❌ Settlement cancelled.');
        } catch (replyError) {
          console.error('Error handling cancel:', replyError);
        }
      }
      return;
    }
  }
}



import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma';
import { ICallbackHandler } from './ICallbackHandler';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';
import { analyticsBus, AnalyticsEventType } from '../../events/analyticsBus';
import { getUserNameByRole, USER_A_ROLE_KEY, USER_B_ROLE_KEY } from '../../config';

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
           data.startsWith('settle_pay_full_') ||
           data.startsWith('settle_ok_') ||
           data === 'settle_cancel';
  }

  async handle(ctx: any, data: string): Promise<void> {
    const session = ctx.session;

    if (data === 'settle_up' || data === 'menu_settle') {
      await ctx.answerCbQuery();
      
      const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
      if (!userId) {
        await ctx.reply('❌ Unable to identify user. Please try again.');
        return;
      }
      
      // Calculate net balance to determine who owes whom
      const netBalance = await this.expenseService.calculateNetBalance();
      
      // Check if already settled
      if (netBalance.netOutstanding === 0) {
        await ctx.reply('✅ All expenses are already settled! No outstanding balance.');
        return;
      }
      
      // Get current user's role
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      
      if (!user) {
        await ctx.reply('❌ User not found. Please try again.');
        return;
      }
      
      const userRole = user.role as 'Bryan' | 'HweiYeen';
      const userAName = getUserNameByRole(USER_A_ROLE_KEY);
      const userBName = getUserNameByRole(USER_B_ROLE_KEY);
      
      // Determine who owes and who is owed
      const currentUserOwes = userRole === 'Bryan' ? netBalance.bryanOwes : netBalance.hweiYeenOwes;
      const otherUserName = userRole === 'Bryan' ? userBName : userAName;
      
      // Check if current user owes money
      if (currentUserOwes === 0) {
        // User is owed money - show friendly message
        const userOwesThem = userRole === 'Bryan' ? netBalance.hweiYeenOwes : netBalance.bryanOwes;
        const otherUserOwes = userRole === 'Bryan' ? userBName : userAName;
        
        await ctx.reply(
          `😊 You don't need to pay anything!\n\n` +
          `${otherUserOwes} owes you $${userOwesThem.toFixed(2)}, so ${otherUserOwes} will be the one settling up.\n` +
          `You're all good - just wait for them to pay!`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📜 History', callback_data: 'view_history' }],
                [{ text: '☰ Menu', callback_data: 'open_menu' }],
              ],
            },
            parse_mode: 'Markdown',
          }
        );
        return;
      }
      
      // User owes money - show settlement prompt
      const netOutstanding = netBalance.netOutstanding;
      const currentUserName = userRole === 'Bryan' ? userAName : userBName;
      
      await ctx.reply(
        `${currentUserName} owes $${netOutstanding.toFixed(2)} to ${otherUserName}.\n\n` +
        `How much would you like to pay?\n\n` +
        `💡 You only need to pay what you owe - you don't have to pay more.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: `💰 Pay $${netOutstanding.toFixed(2)}`, callback_data: `settle_pay_full_${netOutstanding.toFixed(2)}` }],
              [{ text: '❌ Cancel', callback_data: 'settle_cancel' }],
            ],
          },
          parse_mode: 'Markdown',
        }
      );
      
      // Set session state for payment input mode
      if (!session) {
        ctx.session = {};
      }
      ctx.session.paymentMode = true;
      ctx.session.paymentOutstanding = netOutstanding;
      ctx.session.paymentUserOwes = currentUserOwes;
      ctx.session.paymentOwedTo = otherUserName;
      
      return;
    }

    // Handle "Pay Full Amount" button click — show confirmation card first
    if (data.startsWith('settle_pay_full_')) {
      await ctx.answerCbQuery();

      const amountStr = data.replace('settle_pay_full_', '');
      const amount = parseFloat(amountStr);

      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('❌ Invalid payment amount. Please try again.');
        return;
      }

      // Get other user's name for the confirmation card
      const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
      let otherUserName = 'the other party';
      if (userId) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user) {
          const userRole = user.role as 'Bryan' | 'HweiYeen';
          const userAName = getUserNameByRole(USER_A_ROLE_KEY);
          const userBName = getUserNameByRole(USER_B_ROLE_KEY);
          otherUserName = userRole === 'Bryan' ? userBName : userAName;
        }
      }

      await ctx.reply(
        `⚖️ Confirm payment of SGD $${amount.toFixed(2)} to ${otherUserName}?\n\nThis will be logged as a settlement.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Yes, confirm', callback_data: `settle_ok_${amount.toFixed(2)}` }],
              [{ text: '❌ Never mind', callback_data: 'settle_cancel' }],
            ],
          },
          parse_mode: 'Markdown',
        }
      );
      return;
    }

    // Finalise payment after confirmation
    if (data.startsWith('settle_ok_')) {
      await ctx.answerCbQuery();
      const amount = parseFloat(data.replace('settle_ok_', ''));
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('❌ Invalid amount. Please try again.');
        return;
      }
      const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
      if (!userId) {
        await ctx.reply('❌ Unable to identify user.');
        return;
      }
      try {
        await this.expenseService.recordPayment(userId, amount, 'Settlement payment');
        // Clear session state so message router doesn't stay in payment-input mode
        if (ctx.session) {
          ctx.session.paymentMode = false;
          delete ctx.session.paymentOutstanding;
          delete ctx.session.paymentUserOwes;
          delete ctx.session.paymentOwedTo;
        }
        // Role-based butler success message
        const payerUser = await prisma.user.findUnique({ where: { id: userId } }).catch(() => null);
        const payerRole = payerUser?.role as 'Bryan' | 'HweiYeen' | undefined;
        const salutation = payerRole === 'HweiYeen' ? 'Madam Hwei Yeen — we\'re all square!' : 'The slate is clean, Sir Bryan — you\'re all square!';
        // Resolve recipient name for success message
        const userAName = getUserNameByRole(USER_A_ROLE_KEY);
        const userBName = getUserNameByRole(USER_B_ROLE_KEY);
        const recipientName = payerRole === 'Bryan' ? userBName : userAName;
        await ctx.reply(`🎉 Done! SGD $${amount.toFixed(2)} paid to ${recipientName}.\n\n${salutation}`);
        if (this.showDashboard) {
          await this.showDashboard(ctx, true);
        }
      } catch (error: any) {
        console.error('Error recording payment:', error);
        await ctx.reply('❌ Error recording payment. Please try again.');
      }
      return;
    }

    // Legacy settlement handler (keep for backward compatibility)
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
        
        // Success response — use reply (not editMessageText) so the harness
        // can detect it as a new message even when showDashboard fires next.
        await ctx.reply(
          `🤝 All Settled! Marked ${result.count} transaction${result.count > 1 ? 's' : ''} as paid.`
        );
        
        // Return to dashboard after settlement
        if (this.showDashboard) {
          await this.showDashboard(ctx, false);
        }
      } catch (error: any) {
        console.error('Error executing settlement:', error);
        await ctx.reply('❌ Sorry, an error occurred during settlement. Please try again.');
      }
      return;
    }

    if (data === 'settle_cancel') {
      await ctx.answerCbQuery();
      
      // Clear payment mode from session
      if (session) {
        session.paymentMode = false;
        delete session.paymentOutstanding;
        delete session.paymentUserOwes;
        delete session.paymentOwedTo;
      }
      
      try {
        // Edit the message to show cancellation and remove buttons
        await ctx.editMessageText('No rush — the ledger will wait. 📒', {
          reply_markup: { inline_keyboard: [] } // Remove buttons
        });
      } catch (editError) {
        // If edit fails (e.g., message too old), try to reply
        try {
          await ctx.reply('No rush — the ledger will wait. 📒');
        } catch (replyError) {
          console.error('Error handling cancel:', replyError);
        }
      }
      return;
    }
  }
}



import { BaseMessageHandler } from './BaseMessageHandler';
import { ExpenseService } from '../../services/expenseService';
import { AIService } from '../../services/ai';
import { HistoryService } from '../../services/historyService';
import { SessionManager } from './SessionManager';
import { extractPaymentAmount } from '../../utils/paymentAmountExtractor';
import { getUserNameByRole, USER_A_ROLE_KEY, USER_B_ROLE_KEY } from '../../config';

/**
 * Handler for payment input flow during partial settlement
 * Handles text-based payment amount entry with clarification prompts
 */
export class PaymentHandler extends BaseMessageHandler {
  constructor(
    expenseService: ExpenseService,
    aiService: AIService,
    historyService: HistoryService,
    sessionManager: SessionManager,
    getBotUsername?: () => string,
    showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {
    super(expenseService, aiService, historyService, sessionManager, getBotUsername, showDashboard);
  }

  canHandle(text: string, session: any): boolean {
    // Only handle if in payment mode
    return session?.paymentMode === true;
  }

  async handle(ctx: any, text: string): Promise<void> {
    const session = ctx.session || {};
    const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;

    if (!userId) {
      await ctx.reply('❌ Unable to identify user. Please try again.');
      this.sessionManager.clearPaymentMode(session);
      return;
    }

    const outstanding = session.paymentOutstanding || 0;
    const owedTo = session.paymentOwedTo || 'the other user';

    // Extract and validate payment amount
    const extractionResult = extractPaymentAmount(text);

    // If clarification is needed, prompt user
    if (extractionResult.needsClarification) {
      await ctx.reply(
        `🤔 ${extractionResult.reason}\n\n` +
        `(You owe $${outstanding.toFixed(2)})`,
        {
          parse_mode: 'Markdown',
        }
      );
      // Keep payment mode active - user can try again
      return;
    }

    // Amount was extracted successfully
    const amount = extractionResult.amount!;

    // Validate amount is positive
    if (amount <= 0) {
      await ctx.reply(
        `😅 You need to pay a positive amount!\n\n` +
        `The amount must be greater than $0.00 and less than or equal to $${outstanding.toFixed(2)}.\n\n` +
        `Try again?`,
        {
          parse_mode: 'Markdown',
        }
      );
      // Keep payment mode active
      return;
    }

    // Validate amount is within outstanding balance
    if (amount > outstanding) {
      const userAName = getUserNameByRole(USER_A_ROLE_KEY);
      const userBName = getUserNameByRole(USER_B_ROLE_KEY);
      const owedToName = session.paymentOwedTo || (session.paymentUserOwes && userBName) || userAName;
      
      try {
        await ctx.reply(
          `🙂 Hey! You only owe $${outstanding.toFixed(2)} to ${owedToName}, so you don't need to pay $${amount.toFixed(2)}.\n\n` +
          `Maximum you can pay: $${outstanding.toFixed(2)}\n` +
          `You entered: $${amount.toFixed(2)}\n\n` +
          `💡 You can pay less if you want (like $${Math.floor(outstanding * 0.6).toFixed(2)} or $${Math.floor(outstanding * 0.8).toFixed(2)}), but no more than what you owe.\n\n` +
          `Try again with a smaller amount?`,
          {
            parse_mode: 'Markdown',
          }
        );
      } catch (replyError: any) {
        console.error('Error sending overpayment error message:', replyError);
        // Fallback: try to send a simpler message
        try {
          await ctx.reply('❌ The payment amount exceeds what you owe. Please enter a smaller amount.');
        } catch (fallbackError) {
          console.error('Error sending fallback message:', fallbackError);
        }
      }
      // Keep payment mode active
      return;
    }

    // Amount is valid - record payment
    try {
      const description = amount === outstanding 
        ? 'Settlement payment' 
        : `Partial payment to ${owedTo}`;

      // Record payment with state validation and ACID transaction
      const result = await this.expenseService.recordPayment(
        userId,
        amount,
        description
      );

      // Clear payment mode from session
      this.sessionManager.clearPaymentMode(session);

      // Success response
      if (result.wasSettled) {
        await ctx.reply(
          `✅ Payment of $${amount.toFixed(2)} recorded.\n\n` +
          `🎉 All settled! Balance cleared.\n` +
          `All transactions marked as settled.`,
          {
            parse_mode: 'Markdown',
          }
        );
      } else {
        const remainingBalance = result.newBalance.netOutstanding;
        const whoIsOwed = result.newBalance.whoIsOwed;
        const owedToName = whoIsOwed === 'Bryan' 
          ? getUserNameByRole(USER_A_ROLE_KEY) 
          : getUserNameByRole(USER_B_ROLE_KEY);
        
        await ctx.reply(
          `✅ Payment of $${amount.toFixed(2)} recorded.\n\n` +
          `Remaining balance: $${remainingBalance.toFixed(2)} to ${owedToName}.\n` +
          `Payment has been added to your transaction history.`,
          {
            parse_mode: 'Markdown',
          }
        );
      }

      // Return to dashboard after payment
      if (this.showDashboard) {
        await this.showDashboard(ctx, false);
      }

    } catch (error: any) {
      console.error('Error recording payment:', error);
      
      // Clear payment mode on error
      this.sessionManager.clearPaymentMode(session);

      // Check if it's a state validation error
      if (error.message?.includes('exceeds outstanding balance') || error.message?.includes('Balance may have changed')) {
        await ctx.reply(
          `🙂 ${error.message}\n\n` +
          `Please click "Settle Up" again to see the current balance.`,
          {
            parse_mode: 'Markdown',
          }
        );
      } else {
        await ctx.reply(
          `❌ Sorry, an error occurred while recording your payment: ${error.message || 'Unknown error'}\n\n` +
          `Please try again or contact support if the issue persists.`,
          {
            parse_mode: 'Markdown',
          }
        );
      }
    }
  }
}

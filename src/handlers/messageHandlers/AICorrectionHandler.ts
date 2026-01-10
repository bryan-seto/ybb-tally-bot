import { BaseMessageHandler } from './BaseMessageHandler';
import { ExpenseService } from '../../services/expenseService';
import { AIService } from '../../services/ai';
import { HistoryService } from '../../services/historyService';
import { SessionManager } from './SessionManager';
import { prisma } from '../../lib/prisma';
import { executeCorrectionActions } from './CorrectionActionExecutor';

/**
 * Handler for AI correction commands when bot is tagged (e.g., "@bot split venchi 50-50")
 * This handler processes natural language commands to edit recent unsettled transactions
 */
export class AICorrectionHandler extends BaseMessageHandler {
  constructor(
    expenseService: ExpenseService,
    aiService: AIService,
    historyService: HistoryService,
    sessionManager: SessionManager,
    getBotUsername?: () => string
  ) {
    super(expenseService, aiService, historyService, sessionManager, getBotUsername);
  }

  canHandle(text: string, session: any): boolean {
    // Only handle if text starts with @bot tag
    // This handler is checked BEFORE other handlers when bot is tagged
    if (!text.trim().startsWith('@')) {
      return false;
    }

    // Don't handle if in manual add or edit mode (unless explicitly tagged)
    // Actually, if bot is tagged, we should handle it regardless of mode
    // The caller (MessageHandlers) should clear session modes before routing here
    
    return true; // If bot is tagged, this handler should handle it
  }

  async handle(ctx: any, text: string): Promise<void> {
    console.log('[handleAICorrection] Called with text:', text);
    let statusMsg: any = null;
    try {
      const session = ctx.session || {};
      
      // If user tags the bot, they likely want to override any manual flow
      if (session.manualAddMode || session.searchMode || session.editingTxId) {
        console.log('[handleAICorrection] Clearing manual modes for AI correction');
        this.sessionManager.clearSession(session);
      }

      // Get bot username to remove from text if present
      let botUsername: string | undefined;
      if (this.getBotUsername) {
        botUsername = this.getBotUsername();
      } else {
        // Fallback: fetch from Telegram API if getter not provided
        const botInfo = await ctx.telegram.getMe();
        botUsername = botInfo.username;
      }

      // Remove bot tag from text if present
      let cleanedText = text;
      if (botUsername) {
        cleanedText = text.replace(new RegExp(`@${botUsername}\\s*`, 'g'), '').trim();
      }

      // 1. Get recent unsettled transactions
      console.log('[handleAICorrection] Fetching recent transactions');
      const recentTransactions = await prisma.transaction.findMany({
        where: { isSettled: false },
        orderBy: { date: 'desc' },
        take: 10,
        include: {
          payer: true,
        },
      });

      console.log('[handleAICorrection] Found transactions:', recentTransactions.length);
      
      if (recentTransactions.length === 0) {
        console.log('[handleAICorrection] No transactions, sending error');
        await ctx.reply('❌ No unsettled transactions found to edit.');
        return;
      }

      // 2. Initial loading message
      console.log('[handleAICorrection] Sending thinking message');
      statusMsg = await ctx.reply('🔍 <i>Thinking...</i>', { parse_mode: 'HTML' });
      console.log('[handleAICorrection] Thinking message sent, ID:', statusMsg.message_id);

      // 3. Set up fallback callback for real-time status updates
      let statusMsgId: number | null = null;
      
      const onFallback = async (failed: string, next: string) => {
        // If we haven't sent a status message yet, send one
        if (!statusMsgId) {
          const msg = await ctx.reply(`⚠️ Limit hit for ${failed}. Switching to ${next}...`);
          statusMsgId = msg.message_id;
        } else {
          // Optional: Edit existing message if multiple switches happen
          try {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsgId,
              undefined,
              `⚠️ Limit hit for ${failed}. Switching to ${next}...`
            );
          } catch (e) {
            // Ignore edit errors
          }
        }
      };

      // 4. Process with AI (use cleaned text without bot tag)
      const result = await this.aiService.processCorrection(
        cleanedText,
        recentTransactions.map(tx => ({
          id: tx.id,
          description: tx.description || 'Unknown',
          amountSGD: tx.amountSGD,
          category: tx.category || 'Other',
          bryanPercentage: tx.bryanPercentage ?? 0.7,
          hweiYeenPercentage: tx.hweiYeenPercentage ?? 0.3,
          paidBy: tx.payer.name,
          payerRole: tx.payer.role,
          status: tx.isSettled ? 'settled' as const : 'unsettled' as const,
          date: tx.date.toISOString().split('T')[0], // YYYY-MM-DD format
        })),
        onFallback
      );

      if (result.confidence === 'low' || result.actions.every(a => a.action === 'UNKNOWN')) {
        // Cleanup fallback warning if it exists
        if (statusMsgId) {
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId);
          } catch (e) {
            // Ignore delete errors
          }
        }
        
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          '🤔 Sorry, I didn\'t understand those instructions. Try: "@bot split venchi 50-50"'
        );
        return;
      }

      // 5. Cleanup fallback warning before sending final result
      if (statusMsgId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, statusMsgId);
        } catch (e) {
          // Ignore delete errors (msg might be too old or already deleted)
        }
      }

      // 6. Execute actions using shared utility
      const { results } = await executeCorrectionActions(ctx, result.actions, statusMsg);

      // 7. Final summary replace
      const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
      const finalMessage = results.length > 0
        ? `<b>Summary:</b>\n${results.join('\n')}\n\n${balanceMessage}`
        : '🤔 I found no valid actions to take.';

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        finalMessage,
        { parse_mode: 'HTML' }
      );
    } catch (error: any) {
      console.error('Error handling AI correction:', error);
      if (statusMsg) {
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            '❌ Sorry, something went wrong while processing your request.'
          );
        } catch (editError) {
          // If editing fails, send a new message
          await ctx.reply('❌ Sorry, something went wrong while processing your request.');
        }
      } else {
        await ctx.reply('❌ Sorry, something went wrong while processing your request.');
      }
    }
  }
}

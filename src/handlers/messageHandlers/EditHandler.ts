import { BaseMessageHandler } from './BaseMessageHandler';
import { ExpenseService } from '../../services/expenseService';
import { AIService } from '../../services/ai';
import { HistoryService, TransactionDetail } from '../../services/historyService';
import { SplitRulesService } from '../../services/splitRulesService';
import { SessionManager } from './SessionManager';
import { EditService } from '../../services/editService';
import { Markup } from 'telegraf';
import { prisma } from '../../lib/prisma';
import { TransactionDetailHandler } from './TransactionDetailHandler';
import { executeCorrectionActions } from './CorrectionActionExecutor';

/**
 * Handler for edit operations:
 * - Edit commands: "edit /15 20"
 * - AI edit mode: when session.editMode === 'ai_natural_language'
 * - Transaction edit mode: when session.editingTxId && session.editingField
 */
export class EditHandler extends BaseMessageHandler {
  private transactionDetailHandler: TransactionDetailHandler;

  constructor(
    expenseService: ExpenseService,
    aiService: AIService,
    historyService: HistoryService,
    sessionManager: SessionManager,
    showDashboard?: (ctx: any, editMode: boolean) => Promise<void>,
    splitRulesService?: SplitRulesService
  ) {
    super(expenseService, aiService, historyService, sessionManager, undefined, showDashboard, splitRulesService);
    // Create TransactionDetailHandler instance for showing transaction details
    this.transactionDetailHandler = new TransactionDetailHandler(
      expenseService,
      aiService,
      historyService,
      sessionManager,
      showDashboard
    );
  }

  canHandle(text: string, session: any): boolean {
    // Priority 2: Handle edit command pattern "edit /15 20"
    const editMatch = text.match(/^edit\s+\/?(\d+)\s+(.+)$/i);
    if (editMatch) {
      return true;
    }

    // Priority 2: Handle AI edit mode
    if (session.editMode === 'ai_natural_language' && session.editingTxId) {
      return true;
    }

    // Priority 3: Handle transaction edit mode
    if (session.editingTxId && session.editingField) {
      return true;
    }

    return false;
  }

  async handle(ctx: any, text: string): Promise<void> {
    const session = ctx.session || {};

    // Check for edit command first
    const editMatch = text.match(/^edit\s+\/?(\d+)\s+(.+)$/i);
    if (editMatch) {
      await this.handleEditCommand(ctx, text, editMatch);
      return;
    }

    // Check for AI edit mode
    if (session.editMode === 'ai_natural_language' && session.editingTxId) {
      await this.handleAIEditMode(ctx, text, session);
      return;
    }

    // Check for transaction edit mode
    if (session.editingTxId && session.editingField) {
      await this.handleTransactionEdit(ctx, text, session);
      return;
    }
  }

  /**
   * Handle edit command (e.g., "edit /15 20")
   */
  private async handleEditCommand(ctx: any, text: string, editMatch: RegExpMatchArray): Promise<void> {
    let statusMsg: any = null;
    try {
      // Show initial loading message
      statusMsg = await ctx.reply('⏳ Processing edit...', { parse_mode: 'HTML' });

      const editService = new EditService(this.aiService);
      const userId = BigInt(ctx.from.id);

      // Update status before AI processing
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          '⏳ Understanding your change...',
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        // Ignore edit errors, continue anyway
      }

      const result = await editService.processEditCommand(userId, text);

      // Update status before final result
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          '⏳ Updating transaction...',
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        // Ignore edit errors, continue anyway
      }

      // Delete loading message before showing result
      if (statusMsg) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch (e) {
          // Ignore delete errors
        }
      }

      if (result.success && result.transaction) {
        // Check if we have changes to show in diff view
        if (result.changes && result.changes.length > 0) {
          // Format diff view message
          let diffMessage = `✅ **Updated /${editMatch[1]}**\n\n`;
          result.changes.forEach((change) => {
            if (change.field === 'amountSGD') {
              // change.old and change.new are already numbers
              diffMessage += `💵 Amount: $${Number(change.old).toFixed(2)} ➡️ $${Number(change.new).toFixed(2)}\n`;
            } else if (change.field === 'description') {
              diffMessage += `📝 Description: "${change.old}" ➡️ "${change.new}"\n`;
            } else if (change.field === 'category') {
              diffMessage += `📂 Category: ${change.old} ➡️ ${change.new}\n`;
            }
          });

          await ctx.reply(diffMessage, { parse_mode: 'Markdown' });
        } else {
          // Fallback: show generic success message if no changes array (shouldn't happen)
          console.warn('[EditHandler] Edit succeeded but no changes array. Result:', JSON.stringify(result));
          await ctx.reply(result.message || `✅ Updated transaction /${editMatch[1]}`, { parse_mode: 'Markdown' });
        }

        // Refresh dashboard (always refresh if edit succeeded)
        if (this.showDashboard) {
          try {
            await this.showDashboard(ctx, false);
          } catch (dashboardError: any) {
            console.error('[EditHandler] Error refreshing dashboard after edit:', dashboardError);
            // Don't fail the edit operation if dashboard refresh fails
          }
        } else {
          console.warn('[EditHandler] showDashboard is not available for dashboard refresh');
        }
      } else {
        // Error case
        await ctx.reply(result.message || '❌ Sorry, I couldn\'t update that transaction.', { parse_mode: 'Markdown' });
      }
    } catch (error: any) {
      console.error('Error handling edit command:', error);
      // Cleanup loading message on error
      if (statusMsg) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch (e) {
          // Ignore delete errors
        }
      }
      await ctx.reply('❌ Sorry, something went wrong while processing your edit request.');
    }
  }

  /**
   * Handle AI edit mode (when user is editing a transaction via natural language)
   */
  private async handleAIEditMode(ctx: any, text: string, session: any): Promise<void> {
    console.log('[handleAIEditMode] Called with text:', text);
    let statusMsg: any = null;
    try {
      // Cancellation handling (FIRST STEP)
      const normalizedText = text.trim().toLowerCase();
      if (normalizedText === 'cancel' || normalizedText === 'stop' || normalizedText === 'exit') {
        this.sessionManager.clearSession(session);
        await ctx.reply('Edit cancelled.');
        return;
      }

      // Fetch the specific transaction
      const transactionId = BigInt(session.editingTxId);
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { payer: true },
      });

      if (!transaction) {
        this.sessionManager.clearSession(session);
        await ctx.reply('❌ Transaction not found.');
        return;
      }

      // Format transaction for AI context (matching handleAICorrection format)
      const formattedTransaction = {
        id: transaction.id,
        description: transaction.description || 'Unknown',
        amountSGD: transaction.amountSGD,
        category: transaction.category || 'Other',
        bryanPercentage: transaction.bryanPercentage ?? 0.7,
        hweiYeenPercentage: transaction.hweiYeenPercentage ?? 0.3,
        paidBy: transaction.payer.name,
        payerRole: transaction.payer.role,
        status: transaction.isSettled ? 'settled' as const : 'unsettled' as const,
        date: transaction.date.toISOString().split('T')[0], // YYYY-MM-DD format
      };

      // Send thinking message
      statusMsg = await ctx.reply('🔍 <i>Processing your edit...</i>', { parse_mode: 'HTML' });

      // Set up fallback callback for real-time status updates
      let fallbackMsgId: number | null = null;
      
      const onFallback = async (failed: string, next: string) => {
        // If we haven't sent a status message yet, send one
        if (!fallbackMsgId) {
          const msg = await ctx.reply(`⚠️ Limit hit for ${failed}. Switching to ${next}...`);
          fallbackMsgId = msg.message_id;
        } else {
          // Optional: Edit existing message if multiple switches happen
          try {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              fallbackMsgId,
              undefined,
              `⚠️ Limit hit for ${failed}. Switching to ${next}...`
            );
          } catch (e) {
            // Ignore edit errors
          }
        }
      };

      // Process with AI
      const result = await this.aiService.processCorrection(text, [formattedTransaction], onFallback);

      if (result.confidence === 'low' || result.actions.every(a => a.action === 'UNKNOWN')) {
        // Cleanup fallback warning if it exists
        if (fallbackMsgId) {
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, fallbackMsgId);
          } catch (e) {
            // Ignore delete errors
          }
        }
        
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          '🤔 Sorry, I didn\'t understand those instructions. Try: "change amount to $50" or "split 50-50"'
        );
        this.sessionManager.clearSession(session);
        return;
      }

      // Cleanup fallback warning before processing results
      if (fallbackMsgId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, fallbackMsgId);
        } catch (e) {
          // Ignore delete errors (msg might be too old or already deleted)
        }
      }

      // Execute actions using shared utility
      const { results, updatedTransaction: rawUpdatedTransaction } = await executeCorrectionActions(ctx, result.actions, statusMsg);

      if (results.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          '🤔 I found no valid actions to take.'
        );
        this.sessionManager.clearSession(session);
        return;
      }

      // Use the returned transaction if available, otherwise fall back to fetching
      let transactionDetail: TransactionDetail | null = null;
      if (rawUpdatedTransaction) {
        // Format the transaction returned from the update operation
        transactionDetail = this.historyService.formatTransactionModel(rawUpdatedTransaction);
      } else {
        // Fallback: fetch from database (e.g., after delete or no changes)
        transactionDetail = await this.historyService.getTransactionById(transactionId);
      }

      if (transactionDetail) {
        // Delete the status message and show the updated transaction card
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch (deleteError) {
          // If deletion fails, continue anyway
        }
        await this.transactionDetailHandler.showTransactionDetail(ctx, transactionId, transactionDetail);
      } else {
        // If transaction was deleted, show summary
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          results.join('\n'),
          { parse_mode: 'HTML' }
        );
      }

      // Clear session state
      this.sessionManager.clearSession(session);
    } catch (error: any) {
      console.error('Error handling AI edit mode:', error);
      if (statusMsg) {
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            '❌ Sorry, something went wrong while processing your request.'
          );
        } catch (editError) {
          await ctx.reply('❌ Sorry, something went wrong while processing your request.');
        }
      } else {
        await ctx.reply('❌ Sorry, something went wrong while processing your request.');
      }
      this.sessionManager.clearSession(session);
    }
  }

  /**
   * Handle transaction edit mode (when user is manually editing a specific field)
   */
  private async handleTransactionEdit(ctx: any, text: string, session: any): Promise<void> {
    try {
      const txId = session.editingTxId;
      const field = session.editingField;

      console.log(`[handleTransactionEdit] Editing transaction ${txId}, field: ${field}, value: ${text}`);

      if (field === 'amount') {
        const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply('Invalid amount. Please enter a positive number:');
          return;
        }

        const updated = await prisma.transaction.update({
          where: { id: BigInt(txId) },
          data: { amountSGD: amount },
        });

        this.sessionManager.clearSession(session);
        await ctx.reply(
          `✅ Amount updated to $${amount.toFixed(2)} for transaction /${txId}\n\n` +
          `${updated.description || 'No description'}`,
          Markup.removeKeyboard()
        );
      } else if (field === 'category') {
        const category = text.trim();
        const validCategories = ['Food', 'Transport', 'Groceries', 'Shopping', 'Bills', 'Entertainment', 'Medical', 'Travel', 'Other'];
        
        if (!validCategories.includes(category)) {
          await ctx.reply(
            `Invalid category. Please choose one of:\n${validCategories.join(', ')}`
          );
          return;
        }

        const updated = await prisma.transaction.update({
          where: { id: BigInt(txId) },
          data: { category },
        });

        this.sessionManager.clearSession(session);
        await ctx.reply(
          `✅ Category updated to ${category} for transaction /${txId}\n\n` +
          `${updated.description || 'No description'}`,
          Markup.removeKeyboard()
        );
      } else if (field === 'split') {
        // Parse split like "50-50" or "70-30"
        const splitMatch = text.match(/^(\d+)-(\d+)$/);
        if (!splitMatch) {
          await ctx.reply('Invalid format. Please enter split as "XX-YY" (e.g., "50-50" or "70-30")');
          return;
        }

        const bryanPercent = parseInt(splitMatch[1]);
        const hweiYeenPercent = parseInt(splitMatch[2]);

        if (bryanPercent + hweiYeenPercent !== 100) {
          await ctx.reply('Split percentages must add up to 100. Try again:');
          return;
        }

        const updated = await prisma.transaction.update({
          where: { id: BigInt(txId) },
          data: {
            bryanPercentage: bryanPercent / 100,
            hweiYeenPercentage: hweiYeenPercent / 100,
          },
        });

        this.sessionManager.clearSession(session);
        await ctx.reply(
          `✅ Split updated to ${bryanPercent}-${hweiYeenPercent} for transaction /${txId}\n\n` +
          `${updated.description || 'No description'}`,
          Markup.removeKeyboard()
        );
      }
    } catch (error: any) {
      console.error('Error handling transaction edit:', error);
      this.sessionManager.clearSession(session);
      await ctx.reply('❌ Sorry, something went wrong updating the transaction.', Markup.removeKeyboard());
    }
  }

  // executeCorrectionActions is now in shared utility CorrectionActionExecutor
}

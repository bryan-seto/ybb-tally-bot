import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { AIService, CorrectionAction } from '../services/ai';
import { HistoryService, TransactionDetail } from '../services/historyService';
import { formatDate, getNow } from '../utils/dateHelpers';
import { USER_NAMES } from '../config';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { format, parseISO } from 'date-fns';

const TIMEZONE = 'Asia/Singapore';

export class MessageHandlers {
  constructor(
    private expenseService: ExpenseService,
    private aiService: AIService,
    private historyService: HistoryService,
    private getBotUsername?: () => string
  ) {}

  async handleText(ctx: any) {
    try {
      console.log('[handleText] Called');
      if (!ctx.session) ctx.session = {};
      const text = ctx.message.text.trim();
      const session = ctx.session;
      console.log('[handleText] Text received:', text);

      // Handle transaction ID commands (e.g., /77, /74)
      const txIdMatch = text.match(/^\/(\d+)$/);
      if (txIdMatch) {
        try {
          const transactionId = BigInt(txIdMatch[1]);
          await this.showTransactionDetail(ctx, transactionId);
          return;
        } catch (error: any) {
          console.error('Error parsing transaction ID:', error);
          await ctx.reply(`❌ Invalid transaction ID: ${txIdMatch[1]}`);
          return;
        }
      }

      // Handle cancel
      if (text === '❌ Cancel') {
        this.clearSession(session);
        await ctx.reply('❌ Operation cancelled.', Markup.removeKeyboard());
        return;
      }

      // --- PRIORITY 1: Check for bot tag FIRST (AI commands override everything) ---
      let botUsername: string | undefined;
      if (this.getBotUsername) {
        botUsername = this.getBotUsername();
        console.log('[handleText] Bot username (cached):', botUsername);
      } else {
        // Fallback: fetch from Telegram API if getter not provided
        const botInfo = await ctx.telegram.getMe();
        botUsername = botInfo.username;
        console.log('[handleText] Bot username (fetched):', botUsername);
      }
      
      if (botUsername) {
        console.log('[handleText] Checking for tag:', `@${botUsername}`);
        const isBotTagged = text.includes(`@${botUsername}`);
        console.log('[handleText] Is bot tagged?', isBotTagged);

        if (isBotTagged) {
          // If user tags the bot, they likely want to override any manual flow
          if (session.manualAddMode || session.searchMode || session.editingTxId) {
            console.log('[handleText] Clearing manual modes for AI correction');
            this.clearSession(session);
          }
          console.log('[handleText] Calling handleAICorrection');
          await this.handleAICorrection(ctx, text);
          return;
        }
      } else {
        console.log('[handleText] Bot username not available, skipping AI correction check');
      }
      // ---------------------------------------------------------------------------

      // PRIORITY 2: Handle AI edit mode
      if (session.editMode === 'ai_natural_language' && session.editingTxId) {
        await this.handleAIEditMode(ctx, text, session);
        return;
      }

      // PRIORITY 3: Handle transaction edit mode
      if (session.editingTxId && session.editingField) {
        await this.handleTransactionEdit(ctx, text, session);
        return;
      }

      // PRIORITY 4: Handle manual add flow
      if (session.manualAddMode) {
        console.log('[handleText] Manual add mode detected');
        await this.handleManualAddFlow(ctx, text, session);
        return;
      }

      // PRIORITY 4.5: Handle recurring add flow
      if (session.recurringMode) {
        console.log('[handleText] Recurring add mode detected');
        await this.handleRecurringAddFlow(ctx, text, session);
        return;
      }

      // PRIORITY 5: Handle search flow
      if (session.searchMode) {
        console.log('[handleText] Search mode detected');
        await this.handleSearchFlow(ctx, text, session);
        return;
      }
      
      console.log('[handleText] No action taken for this message');
    } catch (error: any) {
      console.error('Error in handleText:', error);
      // Only respond if this was clearly meant for the bot
      if (ctx.message?.text?.includes('@')) {
        try {
          await ctx.reply('❌ Sorry, something went wrong. Please try again.');
        } catch (replyError) {
          console.error('Failed to send error message:', replyError);
        }
      }
    }
  }

  private clearSession(session: any) {
    session.manualAddMode = false;
    session.manualAddStep = undefined;
    session.recurringMode = false;
    session.recurringStep = undefined;
    session.editLastMode = false;
    session.editLastAction = undefined;
    session.searchMode = false;
    session.awaitingAmountConfirmation = false;
    session.awaitingPayer = false;
    session.editingTxId = undefined;
    session.editingField = undefined;
    session.editMode = undefined;
  }

  private async handleManualAddFlow(ctx: any, text: string, session: any) {
    if (session.manualAddStep === 'description') {
      session.manualDescription = text;
      session.manualAddStep = 'amount';
      await ctx.reply(`Description: ${text}\n\nAmount in SGD?`);
    } else if (session.manualAddStep === 'amount') {
      const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('Invalid amount. Please enter a number:');
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

  private async handleRecurringAddFlow(ctx: any, text: string, session: any) {
    if (!session.recurringData) session.recurringData = {};

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
            [{ text: 'Bryan', callback_data: 'recurring_add_payer_bryan' }],
            [{ text: 'Hwei Yeen', callback_data: 'recurring_add_payer_hweiyeen' }],
          ],
        },
      });
    }
  }

  private async handleSearchFlow(ctx: any, text: string, session: any) {
    try {
      const transactions = await prisma.transaction.findMany({
        where: {
          OR: [
            { description: { contains: text, mode: 'insensitive' } },
            { category: { contains: text, mode: 'insensitive' } },
          ],
        },
        include: { payer: true },
        orderBy: { date: 'desc' },
        take: 10,
      });

      if (transactions.length === 0) {
        await ctx.reply(`🔍 No transactions found matching "${text}".`, Markup.removeKeyboard());
      } else {
        let message = `🔍 **Search Results for "${text}":**\n\n`;
        transactions.forEach((t) => {
          const dateStr = formatDate(t.date, 'dd MMM yy');
          message += `/${t.id} ${dateStr} - ${t.description || 'No desc'} ($${t.amountSGD.toFixed(2)}) - ${t.payer.name}\n`;
        });
        await ctx.reply(message, { parse_mode: 'Markdown', ...Markup.removeKeyboard() });
      }
      session.searchMode = false;
    } catch (error) {
      console.error('Search error:', error);
      await ctx.reply('Error performing search.', Markup.removeKeyboard());
      session.searchMode = false;
    }
  }

  /**
   * Execute correction actions returned by AI service
   * Returns array of result messages and the updated transaction (if any)
   */
  private async executeCorrectionActions(
    ctx: any,
    actions: CorrectionAction[],
    statusMsg: any
  ): Promise<{ results: string[]; updatedTransaction?: any }> {
    const results: string[] = [];
    let updatedTransaction: any = undefined;
    for (const step of actions) {
      if (step.action === 'UNKNOWN') continue;

      // Update status message for current action
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `⏳ <i>${step.statusMessage}</i>`,
        { parse_mode: 'HTML' }
      );

      // Small delay for natural feel
      await new Promise(resolve => setTimeout(resolve, 500));

      // Execute DB logic
      try {
        if (step.action === 'UPDATE_SPLIT' && step.transactionId && step.data) {
          const updated = await prisma.transaction.update({
            where: { id: step.transactionId },
            data: {
              bryanPercentage: step.data.bryanPercentage,
              hweiYeenPercentage: step.data.hweiYeenPercentage,
            },
            include: {
              payer: true,
            },
          });
          updatedTransaction = updated;
          const bryanSplit = Math.round((step.data.bryanPercentage ?? 0.7) * 100);
          const hweiYeenSplit = Math.round((step.data.hweiYeenPercentage ?? 0.3) * 100);
          results.push(`✅ Split updated for "${updated.description}" to ${bryanSplit}-${hweiYeenSplit}`);
        } else if (step.action === 'UPDATE_AMOUNT' && step.transactionId && step.data) {
          const updated = await prisma.transaction.update({
            where: { id: step.transactionId },
            data: { amountSGD: step.data.amountSGD },
            include: {
              payer: true,
            },
          });
          updatedTransaction = updated;
          results.push(`✅ Amount updated for "${updated.description}" to $${updated.amountSGD.toFixed(2)}`);
        } else if (step.action === 'UPDATE_CATEGORY' && step.transactionId && step.data) {
          const updated = await prisma.transaction.update({
            where: { id: step.transactionId },
            data: { category: step.data.category },
            include: {
              payer: true,
            },
          });
          updatedTransaction = updated;
          results.push(`✅ Category updated for "${updated.description}" to ${updated.category}`);
        } else if (step.action === 'DELETE' && step.transactionId) {
          const deleted = await prisma.transaction.delete({
            where: { id: step.transactionId },
          });
          // Don't set updatedTransaction for DELETE actions
          results.push(`🗑️ Deleted "${deleted.description}"`);
        } else if (step.action === 'UPDATE_PAYER' && step.transactionId && step.data?.payerKey) {
          const payerRole = step.data.payerKey === 'BRYAN' ? 'Bryan' : 'HweiYeen';
          const user = await prisma.user.findFirst({ where: { role: payerRole } });
          if (!user) {
            throw new Error(`User with role ${payerRole} not found`);
          }
          const updated = await prisma.transaction.update({
            where: { id: step.transactionId },
            data: { payerId: user.id },
            include: {
              payer: true,
            },
          });
          updatedTransaction = updated;
          results.push(`✅ Payer updated to ${payerRole}`);
        } else if (step.action === 'UPDATE_STATUS' && step.transactionId && step.data?.isSettled !== undefined) {
          const updated = await prisma.transaction.update({
            where: { id: step.transactionId },
            data: { isSettled: step.data.isSettled },
            include: {
              payer: true,
            },
          });
          updatedTransaction = updated;
          const statusText = step.data.isSettled ? 'settled' : 'unsettled';
          results.push(`✅ Status updated to ${statusText}`);
        } else if (step.action === 'UPDATE_DATE' && step.transactionId && step.data?.date) {
          // Fetch current transaction to preserve time components
          const currentTx = await prisma.transaction.findUnique({
            where: { id: step.transactionId },
          });
          if (!currentTx) {
            throw new Error('Transaction not found');
          }
          
          // Step A: Get current transaction date in Singapore timezone
          const currentZoned = toZonedTime(currentTx.date, TIMEZONE);
          
          // Step B: Extract time portion strictly (HH:mm:ss.SSS)
          const timeString = format(currentZoned, 'HH:mm:ss.SSS');
          
          // Step C: Validate input date format (YYYY-MM-DD)
          const dateStr = step.data.date;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
          }
          
          // Step D: Compose ISO string with Singapore timezone offset
          const isoString = `${dateStr}T${timeString}+08:00`;
          
          // Step E: Parse ISO string and convert from Singapore timezone to UTC
          // parseISO correctly parses the string with +08:00 timezone and converts to UTC
          // This preserves the exact wall-clock time in Singapore timezone
          const parsedDate = parseISO(isoString);
          // Use fromZonedTime to ensure proper timezone handling
          // First convert the parsed UTC date back to Singapore view to verify,
          // then convert back to UTC (this ensures consistency)
          const verifyZoned = toZonedTime(parsedDate, TIMEZONE);
          const finalDate = fromZonedTime(verifyZoned, TIMEZONE);
          
          // Observability logging
          console.log('[UPDATE_DATE] Input Date:', dateStr);
          console.log('[UPDATE_DATE] Frozen Time (SG):', timeString);
          console.log('[UPDATE_DATE] Combined String:', isoString);
          console.log('[UPDATE_DATE] Final UTC:', finalDate.toISOString());
          
          // Step F: Save to database
          const updated = await prisma.transaction.update({
            where: { id: step.transactionId },
            data: { date: finalDate },
            include: {
              payer: true,
            },
          });
          updatedTransaction = updated;
          const { formatDate } = await import('../utils/dateHelpers');
          results.push(`✅ Date updated to ${formatDate(finalDate, 'dd MMM yyyy')}`);
        } else if (step.action === 'UPDATE_TIME' && step.transactionId && step.data?.time) {
          // Fetch current transaction to preserve date components
          const currentTx = await prisma.transaction.findUnique({
            where: { id: step.transactionId },
          });
          if (!currentTx) {
            throw new Error('Transaction not found');
          }
          
          const timeStr = step.data.time; // Expected format: HH:MM (24-hour, e.g., "14:30", "21:00")
          
          // Validate and parse time string (HH:MM format)
          const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
          if (!timeMatch) {
            throw new Error(`Invalid time format: ${timeStr}. Expected HH:MM (24-hour format)`);
          }
          
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          
          if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            throw new Error(`Invalid time values: ${timeStr}. Hours must be 0-23, minutes must be 0-59`);
          }
          
          // Get existing date in Singapore timezone
          const existingDate = currentTx.date;
          const year = existingDate.getFullYear();
          const month = String(existingDate.getMonth() + 1).padStart(2, '0');
          const day = String(existingDate.getDate()).padStart(2, '0');
          const hoursStr = String(hours).padStart(2, '0');
          const minutesStr = String(minutes).padStart(2, '0');
          
          // Construct date string in Singapore timezone (GMT+8)
          // Format: YYYY-MM-DDTHH:mm:00+08:00
          const singaporeDateStr = `${year}-${month}-${day}T${hoursStr}:${minutesStr}:00+08:00`;
          
          // Parse the date string - JavaScript will convert to UTC automatically
          const newDate = new Date(singaporeDateStr);
          if (isNaN(newDate.getTime())) {
            throw new Error(`Failed to parse date with timezone: ${singaporeDateStr}`);
          }
          
          const updated = await prisma.transaction.update({
            where: { id: step.transactionId },
            data: { date: newDate },
            include: {
              payer: true,
            },
          });
          updatedTransaction = updated;
          const { formatDate } = await import('../utils/dateHelpers');
          results.push(`✅ Time updated to ${timeStr}`);
        } else if (step.action === 'UPDATE_DESCRIPTION' && step.transactionId && step.data?.description) {
          const updated = await prisma.transaction.update({
            where: { id: step.transactionId },
            data: { description: step.data.description },
            include: {
              payer: true,
            },
          });
          updatedTransaction = updated;
          results.push(`✅ Description updated to "${updated.description}"`);
        }
      } catch (dbError: any) {
        console.error('Database error during action execution:', dbError);
        results.push(`❌ Failed to execute action: ${dbError.message}`);
      }
    }
    return { results, updatedTransaction };
  }

  private async handleAICorrection(ctx: any, text: string) {
    console.log('[handleAICorrection] Called with text:', text);
    let statusMsg: any = null;
    try {
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

      // 4. Process with AI
      const result = await this.aiService.processCorrection(
        text,
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

      // 6. Execute actions using shared method
      const { results } = await this.executeCorrectionActions(ctx, result.actions, statusMsg);

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

  private async handleAIEditMode(ctx: any, text: string, session: any) {
    console.log('[handleAIEditMode] Called with text:', text);
    let statusMsg: any = null;
    try {
      // Cancellation handling (FIRST STEP)
      const normalizedText = text.trim().toLowerCase();
      if (normalizedText === 'cancel' || normalizedText === 'stop' || normalizedText === 'exit') {
        this.clearSession(session);
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
        this.clearSession(session);
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
        this.clearSession(session);
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

      // Execute actions using shared method
      const { results, updatedTransaction: rawUpdatedTransaction } = await this.executeCorrectionActions(ctx, result.actions, statusMsg);

      if (results.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          '🤔 I found no valid actions to take.'
        );
        this.clearSession(session);
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
        await this.showTransactionDetail(ctx, transactionId, transactionDetail);
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
      this.clearSession(session);
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
      this.clearSession(session);
    }
  }

  private async handleTransactionEdit(ctx: any, text: string, session: any) {
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

        this.clearSession(session);
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

        this.clearSession(session);
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

        this.clearSession(session);
        await ctx.reply(
          `✅ Split updated to ${bryanPercent}-${hweiYeenPercent} for transaction /${txId}\n\n` +
          `${updated.description || 'No description'}`,
          Markup.removeKeyboard()
        );
      }
    } catch (error: any) {
      console.error('Error handling transaction edit:', error);
      this.clearSession(session);
      await ctx.reply('❌ Sorry, something went wrong updating the transaction.', Markup.removeKeyboard());
    }
  }

  /**
   * Show transaction detail card
   * @param ctx - Telegram context
   * @param transactionId - Transaction ID to fetch (if transactionDetail not provided)
   * @param transactionDetail - Optional pre-fetched transaction detail to avoid re-fetching
   */
  private async showTransactionDetail(ctx: any, transactionId: bigint, transactionDetail?: TransactionDetail) {
    try {
      // Use provided transaction detail or fetch from database
      const transaction = transactionDetail || await this.historyService.getTransactionById(transactionId);

      if (!transaction) {
        const message = `❌ Transaction \`/${transactionId}\` not found.`;
        if (ctx.message) {
          await ctx.reply(message, { parse_mode: 'Markdown' });
        } else if (ctx.callbackQuery) {
          await ctx.answerCbQuery('Transaction not found', { show_alert: true });
        }
        return;
      }

      const card = this.historyService.formatTransactionDetail(transaction);

      // Build inline keyboard buttons
      const keyboard: any[] = [];

      // Only show "Settle Up" if transaction is unsettled
      if (transaction.status === 'unsettled') {
        keyboard.push([
          Markup.button.callback('✅ Settle', `tx_settle_${transactionId}`)
        ]);
      }

      // Edit and Delete buttons
      keyboard.push([
        Markup.button.callback('✨ AI Edit', `tx_edit_${transactionId}`),
        Markup.button.callback('🗑️ Delete', `tx_delete_${transactionId}`),
      ]);

      const replyMarkup = Markup.inlineKeyboard(keyboard);

      if (ctx.message) {
        await ctx.reply(card, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup.reply_markup,
        });
      } else if (ctx.callbackQuery) {
        await ctx.answerCbQuery();
        await ctx.editMessageText(card, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup.reply_markup,
        });
      }
    } catch (error: any) {
      console.error('Error showing transaction detail:', error);
      await ctx.reply('Sorry, I encountered an error retrieving transaction details. Please try again.');
    }
  }

}


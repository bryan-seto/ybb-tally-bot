import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { AIService } from '../services/ai';
import { formatDate, getNow } from '../utils/dateHelpers';
import { USER_NAMES } from '../config';

export class MessageHandlers {
  constructor(
    private expenseService: ExpenseService,
    private aiService: AIService
  ) {}

  async handleText(ctx: any) {
    if (!ctx.session) ctx.session = {};
    const text = ctx.message.text.trim();
    const session = ctx.session;

    // Handle cancel
    if (text === '❌ Cancel') {
      this.clearSession(session);
      await ctx.reply('❌ Operation cancelled.', Markup.removeKeyboard());
      return;
    }

    // Handle manual add flow
    if (session.manualAddMode) {
      await this.handleManualAddFlow(ctx, text, session);
      return;
    }

    // Handle search flow
    if (session.searchMode) {
      await this.handleSearchFlow(ctx, text, session);
      return;
    }

    // Handle AI correction commands (tag-only)
    // Check if the bot is mentioned/tagged
    const botInfo = await ctx.telegram.getMe();
    const botUsername = botInfo.username;
    const isBotTagged = text.includes(`@${botUsername}`);

    if (isBotTagged) {
      await this.handleAICorrection(ctx, text);
      return;
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

  private async handleAICorrection(ctx: any, text: string) {
    let statusMsg: any = null;
    try {
      // 1. Get recent unsettled transactions
      const recentTransactions = await prisma.transaction.findMany({
        where: { isSettled: false },
        orderBy: { date: 'desc' },
        take: 10,
        select: {
          id: true,
          description: true,
          amountSGD: true,
          category: true,
          bryanPercentage: true,
          hweiYeenPercentage: true,
        },
      });

      if (recentTransactions.length === 0) {
        await ctx.reply('❌ No unsettled transactions found to edit.');
        return;
      }

      // 2. Initial loading message
      statusMsg = await ctx.reply('🔍 <i>Thinking...</i>', { parse_mode: 'HTML' });

      // 3. Process with AI
      const result = await this.aiService.processCorrection(
        text,
        recentTransactions.map(tx => ({
          id: tx.id,
          description: tx.description || 'Unknown',
          amountSGD: tx.amountSGD,
          category: tx.category || 'Other',
          bryanPercentage: tx.bryanPercentage ?? 0.7,
          hweiYeenPercentage: tx.hweiYeenPercentage ?? 0.3,
        }))
      );

      if (result.confidence === 'low' || result.actions.every(a => a.action === 'UNKNOWN')) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          '🤔 Sorry, I didn\'t understand those instructions. Try: "@bot split venchi 50-50"'
        );
        return;
      }

      // 4. Execute actions one by one with status updates
      const results: string[] = [];
      for (const step of result.actions) {
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
            });
            const bryanSplit = Math.round((step.data.bryanPercentage ?? 0.7) * 100);
            const hweiYeenSplit = Math.round((step.data.hweiYeenPercentage ?? 0.3) * 100);
            results.push(`✅ Split updated for "${updated.description}" to ${bryanSplit}-${hweiYeenSplit}`);
          } else if (step.action === 'UPDATE_AMOUNT' && step.transactionId && step.data) {
            const updated = await prisma.transaction.update({
              where: { id: step.transactionId },
              data: { amountSGD: step.data.amountSGD },
            });
            results.push(`✅ Amount updated for "${updated.description}" to $${updated.amountSGD.toFixed(2)}`);
          } else if (step.action === 'UPDATE_CATEGORY' && step.transactionId && step.data) {
            const updated = await prisma.transaction.update({
              where: { id: step.transactionId },
              data: { category: step.data.category },
            });
            results.push(`✅ Category updated for "${updated.description}" to ${updated.category}`);
          } else if (step.action === 'DELETE' && step.transactionId) {
            const deleted = await prisma.transaction.delete({
              where: { id: step.transactionId },
            });
            results.push(`🗑️ Deleted "${deleted.description}"`);
          }
        } catch (dbError: any) {
          console.error('Database error during action execution:', dbError);
          results.push(`❌ Failed to execute action: ${dbError.message}`);
        }
      }

      // 5. Final summary replace
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


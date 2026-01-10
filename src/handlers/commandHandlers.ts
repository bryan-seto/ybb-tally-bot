import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { AnalyticsService } from '../services/analyticsService';
import { HistoryService } from '../services/historyService';
import { formatDate, getNow } from '../utils/dateHelpers';
import { USER_NAMES, CONFIG, USER_IDS, getUserNameByRole, USER_A_ROLE_KEY, USER_B_ROLE_KEY } from '../config';

export class CommandHandlers {
  constructor(
    private expenseService: ExpenseService,
    private analyticsService: AnalyticsService,
    private historyService?: HistoryService
  ) {}

  async handleBalance(ctx: Context) {
    const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
    await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });
  }

  async handlePending(ctx: Context) {
    try {
      const pendingTransactions = await this.expenseService.getAllPendingTransactions();
      
      if (pendingTransactions.length === 0) {
        await ctx.reply('✅ All expenses are settled! No pending transactions.');
        return;
      }

      // Get dynamic names from config
      const userAName = getUserNameByRole(USER_A_ROLE_KEY);
      const userBName = getUserNameByRole(USER_B_ROLE_KEY);

      let message = `📋 **All Pending Transactions (${pendingTransactions.length}):**\n\n`;
      
      pendingTransactions.forEach((t, index) => {
        const dateStr = formatDate(t.date, 'dd MMM yyyy');
        message += `${index + 1}. **${t.description}**\n`;
        message += `   Amount: SGD $${t.amount.toFixed(2)}\n`;
        
        // Map database payer name to config name using role
        const payerDisplayName = t.payerRole === USER_A_ROLE_KEY ? userAName : userBName;
        message += `   Paid by: ${payerDisplayName}\n`;
        
        message += `   Category: ${t.category}\n`;
        message += `   Date: ${dateStr}\n`;
        
        if (t.bryanOwes > 0) {
          message += `   💰 ${userAName} owes: SGD $${t.bryanOwes.toFixed(2)}\n`;
        } else if (t.hweiYeenOwes > 0) {
          message += `   💰 ${userBName} owes: SGD $${t.hweiYeenOwes.toFixed(2)}\n`;
        }
        
        message += '\n';
      });

      const balanceMessage = await this.expenseService.getOutstandingBalanceMessage();
      message += balanceMessage;

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error getting pending transactions:', error);
      await ctx.reply('Sorry, I encountered an error retrieving pending transactions. Please try again.');
    }
  }

  async handleSettle(ctx: Context) {
    try {
      // Fetch all unsettled transactions (shared system)
      const unsettled = await prisma.transaction.findMany({
        where: { isSettled: false },
        orderBy: { id: 'desc' }
      });
      
      if (unsettled.length === 0) {
        await ctx.reply('✅ All expenses are already settled! No outstanding balance.');
        return;
      }
      
      // Calculate watermark and totals
      const watermarkID = unsettled[0].id; // Max ID (already sorted desc)
      const totalAmount = unsettled.reduce((sum, t) => sum + Number(t.amountSGD), 0);
      const transactionCount = unsettled.length;
      
      // CRITICAL: Explicit BigInt to string conversion
      const watermarkString = watermarkID.toString();
      
      // Validate watermark is valid (safety check)
      if (!/^\d+$/.test(watermarkString)) {
        throw new Error('Invalid watermark ID format');
      }
      
      // Create confirmation keyboard
      const confirmationKeyboard = Markup.inlineKeyboard([
        [{ 
          text: '✅ Confirm', 
          callback_data: `settle_confirm_${watermarkString}` // Use string, not BigInt
        }],
        [{ text: '❌ Cancel', callback_data: 'settle_cancel' }]
      ]);
      
      // Show preview
      await ctx.reply(
        `Ready to settle ${transactionCount} transactions for SGD $${totalAmount.toFixed(2)}?\n\n` +
        `⚠️ This will mark all unsettled transactions as paid.`,
        { 
          parse_mode: 'Markdown',
          reply_markup: confirmationKeyboard.reply_markup
        }
      );
      
      // Log the settlement attempt
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
                event: 'settle_command_attempted',
                metadata: {
                  method: 'command',
                  transactionCount,
                  totalAmount,
                  watermarkID: watermarkString, // Store as string in JSON
                  timestamp: new Date().toISOString(),
                },
              },
            });
          }
        } catch (logError) {
          console.error('Error logging settlement attempt:', logError);
        }
      }
    } catch (error: any) {
      console.error('Error handling settle command:', error);
      await ctx.reply('Sorry, I encountered an error. Please try again.');
    }
  }

  async handleFixed(ctx: Context) {
    // Security check: Only allow founder (Bryan) to execute
    const userId = ctx.from?.id?.toString();
    if (userId !== USER_IDS.BRYAN) {
      return; // Silently ignore if not founder
    }

    try {
      // Retrieve broken_groups from settings
      const setting = await prisma.settings.findUnique({
        where: { key: 'broken_groups' },
      });

      if (!setting || !setting.value || setting.value.trim() === '') {
        await ctx.reply('✅ No broken groups to notify. All systems operational!');
        return;
      }

      const groupIds = setting.value.split(',').filter(id => id.trim() !== '');
      
      if (groupIds.length === 0) {
        await ctx.reply('✅ No broken groups to notify. All systems operational!');
        return;
      }

      // Broadcast resolution message to all broken groups
      let successCount = 0;
      let failCount = 0;

      for (const groupId of groupIds) {
        try {
          await ctx.telegram.sendMessage(
            groupId.trim(),
            `✅ **Issue Resolved**\n\n` +
            `The bot is back online and fully operational. Thank you for your patience!`,
            { parse_mode: 'Markdown' }
          );
          successCount++;
        } catch (error: any) {
          console.error(`Failed to send message to group ${groupId}:`, error);
          failCount++;
        }
      }

      // Clear the broken_groups setting
      await prisma.settings.update({
        where: { key: 'broken_groups' },
        data: { value: '' },
      });

      // Reply to admin with summary
      const summary = `✅ **Successfully broadcasted fix notification**\n\n` +
        `• Groups notified: ${successCount}\n` +
        (failCount > 0 ? `• Failed: ${failCount}\n` : '') +
        `• Broken groups list cleared.`;
      
      await ctx.reply(summary, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error handling /fixed command:', error);
      await ctx.reply('❌ Error processing /fixed command. Please try again.');
    }
  }

  async handleHistory(ctx: Context) {
    if (!this.historyService) {
      await ctx.reply('History service not available.');
      return;
    }

    try {
      const transactions = await this.historyService.getRecentTransactions(20, 0);
      const totalCount = await this.historyService.getTotalTransactionCount();

      if (transactions.length === 0) {
        await ctx.reply('📜 **Transaction History**\n\nNo transactions found.', { parse_mode: 'Markdown' });
        return;
      }

      // Build the list message
      const lines = ['📜 **Transaction History**\n'];
      
      for (const tx of transactions) {
        const line = this.historyService.formatTransactionListItem(tx);
        lines.push(line);
      }

      const message = lines.join('\n');

      // Add pagination button if there are more transactions
      const keyboard: any[] = [];
      if (20 < totalCount) {
        keyboard.push([
          Markup.button.callback('⬇️ Load More', `history_load_20`)
        ]);
      }

      const replyMarkup = keyboard.length > 0 ? Markup.inlineKeyboard(keyboard) : undefined;

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup?.reply_markup,
      });
    } catch (error: any) {
      console.error('Error showing history:', error);
      await ctx.reply('Sorry, I encountered an error retrieving history. Please try again.');
    }
  }

  async handleDetailedBalance(ctx: Context) {
    try {
      const detailedBalanceMessage = await this.expenseService.getDetailedBalanceMessage();
      await ctx.reply(detailedBalanceMessage, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Error getting detailed balance:', error);
      await ctx.reply('Sorry, I encountered an error retrieving detailed balance. Please try again.');
    }
  }
}


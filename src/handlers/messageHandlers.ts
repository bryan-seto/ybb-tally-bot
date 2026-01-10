import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { AIService, CorrectionAction } from '../services/ai';
import { HistoryService, TransactionDetail } from '../services/historyService';
import { EditService } from '../services/editService';
import { SplitRulesService, ValidationError } from '../services/splitRulesService';
import { formatDate, getNow } from '../utils/dateHelpers';
import { USER_NAMES, getUserAName, getUserBName, USER_A_ROLE_KEY, USER_B_ROLE_KEY } from '../config';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { format, parseISO } from 'date-fns';
import { analyticsBus, AnalyticsEventType } from '../events/analyticsBus';
import { MessageRouter } from './messageHandlers/MessageRouter';
import { SessionManager } from './messageHandlers/SessionManager';

const TIMEZONE = 'Asia/Singapore';

export class MessageHandlers {
  private router: MessageRouter;
  private sessionManager: SessionManager;

  constructor(
    private expenseService: ExpenseService,
    private aiService: AIService,
    private historyService: HistoryService,
    private getBotUsername?: () => string,
    private showDashboard?: (ctx: any, editMode: boolean) => Promise<void>,
    private splitRulesService?: SplitRulesService
  ) {
    // Create session manager
    this.sessionManager = new SessionManager();
    
    // Create router with all dependencies
    this.router = new MessageRouter(
      expenseService,
      aiService,
      historyService,
      this.sessionManager,
      getBotUsername,
      showDashboard,
      splitRulesService
    );
  }

  async handleText(ctx: any) {
    try {
      console.log('[handleText] Called');
      if (!ctx.session) ctx.session = {};
      const text = ctx.message?.text?.trim() || '';
      const session = ctx.session;
      console.log('[handleText] Text received:', text);

      // Handle cancel
      if (text === '❌ Cancel') {
        this.sessionManager.clearSession(session);
        await ctx.reply('❌ Operation cancelled.', Markup.removeKeyboard());
        return;
      }

      // Try router first (for extracted handlers)
      // Router handles: AICorrectionHandler, TransactionDetailHandler, EditHandler, QuickExpenseHandler
      const routerHandled = await this.router.process(ctx, text);
      
      // If router handled it, return early
      if (routerHandled !== undefined) {
        return;
      }
      
      // If router didn't handle it, continue with existing logic
      // TODO: Extract remaining handlers (ManualAddHandler, RecurringHandler, SplitSettingsHandler, SearchHandler)

      // Bot tag checking is now handled by AICorrectionHandler via router
      // If bot is tagged, AICorrectionHandler will handle it (highest priority in router)

      // Quick expense is now handled by QuickExpenseHandler via router
      // Transaction ID commands are handled by TransactionDetailHandler via router

      // AI edit mode and transaction edit mode are now handled by EditHandler via router

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

      // PRIORITY 4.6: Handle split settings custom input
      if (session.waitingForSplitInput && session.splitSettingsCategory) {
        await this.handleSplitSettingsInput(ctx, text, session);
        return; // CRITICAL: Must return to prevent other handlers from processing
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
    // Use SessionManager for consistency
    this.sessionManager.clearSession(session);
    // Additional session fields specific to MessageHandlers
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
            [{ text: getUserAName(), callback_data: 'recurring_add_payer_bryan' }],
            [{ text: getUserBName(), callback_data: 'recurring_add_payer_hweiyeen' }],
          ],
        },
      });
    }
  }

  /**
   * Handle custom split percentage input from user
   */
  private async handleSplitSettingsInput(ctx: any, text: string, session: any): Promise<void> {
    if (!this.splitRulesService) {
      console.error('[handleSplitSettingsInput] SplitRulesService not available');
      await ctx.reply('❌ Split settings service not available. Please try again.');
      session.waitingForSplitInput = false;
      session.splitSettingsCategory = undefined;
      return;
    }

    const input = parseInt(text.trim());

    // Validation: Must be integer between 0-100
    if (isNaN(input) || input < 0 || input > 100) {
      await ctx.reply('❌ Please enter a whole number between 0 and 100.');
      return; // Stay in input mode
    }

    const category = session.splitSettingsCategory;
    const bryan = input / 100;
    const hwei = (100 - input) / 100;

    try {
      await this.splitRulesService.updateSplitRule(category, bryan, hwei);

      // Cleanup session state
      session.waitingForSplitInput = false;
      session.splitSettingsCategory = undefined;

      // Success message with user names
      const userAName = getUserAName();
      const userBName = getUserBName();
      await ctx.reply(`✅ Updated ${category}: ${userAName} ${input}% / ${userBName} ${100 - input}%`);
    } catch (error: any) {
      if (error instanceof ValidationError) {
        await ctx.reply(`❌ Invalid split: ${error.message}`);
      } else {
        console.error('[handleSplitSettingsInput] Error:', error);
        await ctx.reply('❌ Error updating split. Please try again.');
      }
      // Stay in input mode on error (user can try again or cancel)
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

  // executeCorrectionActions is now in shared utility CorrectionActionExecutor

  /**
   * Handle quick expense one-liner (e.g., "130 groceries")
   * Note: This method is still here but should be removed after QuickExpenseHandler is fully tested
   */
  private async handleQuickExpense(ctx: any, text: string) {
    console.log('[DEBUG] handleQuickExpense triggered with:', text);
    console.log('[DEBUG] handleQuickExpense context:', {
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type
    });
    let statusMsg: any = null;
    try {
      // Send initial status message
      statusMsg = await ctx.reply('👀 Processing expense...', { parse_mode: 'HTML' });
      console.log('[DEBUG] handleQuickExpense: Status message sent');

      // Set up fallback callback for real-time status updates
      let fallbackMsgId: number | null = null;
      
      const onFallback = async (failed: string, next: string) => {
        if (!fallbackMsgId) {
          const msg = await ctx.reply(`⚠️ Limit hit for ${failed}. Switching to ${next}...`);
          fallbackMsgId = msg.message_id;
        } else {
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

      // Parse via LLM
      console.log('[DEBUG] handleQuickExpense: Calling aiService.processQuickExpense...');
      const parsed = await this.aiService.processQuickExpense(text, onFallback);
      console.log('[DEBUG] handleQuickExpense: AI parsing result:', parsed);

      // Cleanup fallback warning if it exists
      if (fallbackMsgId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, fallbackMsgId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      // Update status message
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        '⏳ Saving expense...',
        { parse_mode: 'HTML' }
      );

      // Get user ID
      const userId = BigInt(ctx.from.id);
      console.log('[DEBUG] handleQuickExpense: User ID:', userId.toString());

      // Create smart expense
      console.log('[DEBUG] handleQuickExpense: Calling createSmartExpense with:', {
        userId: userId.toString(),
        amount: parsed.amount,
        category: parsed.category,
        description: parsed.description
      });
      const { transaction, balanceMessage } = await this.expenseService.createSmartExpense(
        userId,
        parsed.amount,
        parsed.category,
        parsed.description
      );
      console.log('[DEBUG] handleQuickExpense: Transaction created successfully:', {
        transactionId: transaction.id.toString(),
        amount: transaction.amountSGD
      });

      // Get fun confirmation message
      const funConfirmation = this.expenseService.getFunConfirmation(parsed.category);

      // Get split details for display
      let splitDetails = '';
      if (this.splitRulesService && transaction.bryanPercentage !== null && transaction.hweiYeenPercentage !== null) {
        const userAName = getUserAName();
        const userBName = getUserBName();
        const userAPercent = Math.round(transaction.bryanPercentage * 100);
        const userBPercent = Math.round(transaction.hweiYeenPercentage * 100);
        const userAAmount = parsed.amount * transaction.bryanPercentage;
        const userBAmount = parsed.amount * transaction.hweiYeenPercentage;
        splitDetails = `\n📊 Split: ${userAName} ${userAPercent}% ($${userAAmount.toFixed(2)}) / ${userBName} ${userBPercent}% ($${userBAmount.toFixed(2)})`;
      }

      // Generate tip footer (20% chance = 1/5 times)
      const tipFooter = Math.random() < 0.2 ? "\n\n💡 Tip: Tap 'Undo' if you made a mistake!" : "";

      // Build final message
      const finalMessage = `${funConfirmation} ${parsed.description} - $${parsed.amount.toFixed(2)} (${parsed.category})${splitDetails}\n\n${balanceMessage}${tipFooter}`;

      // Create inline keyboard with Undo button
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('↩️ Undo', `undo_expense_${transaction.id}`)]
      ]);

      // Update status message with final result
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        finalMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: keyboard.reply_markup,
        }
      );

      // Show fresh dashboard after expense save
      if (this.showDashboard) {
        await this.showDashboard(ctx, false);
      }
    } catch (error: any) {
      console.error('[FATAL] handleQuickExpense crashed:', error);
      console.error('[FATAL] handleQuickExpense error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        text: text
      });
      if (statusMsg) {
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            '❌ Sorry, I couldn\'t process that expense. Please try again or use the format: "130 groceries"'
          );
        } catch (editError) {
          await ctx.reply('❌ Sorry, I couldn\'t process that expense. Please try again or use the format: "130 groceries"');
        }
      } else {
        await ctx.reply('❌ Sorry, I couldn\'t process that expense. Please try again or use the format: "130 groceries"');
      }
    }
  }

}









import { Markup } from 'telegraf';
import { ExpenseService } from '../services/expenseService';
import { AIService } from '../services/ai';
import { HistoryService } from '../services/historyService';
import { SplitRulesService } from '../services/splitRulesService';
import { MessageRouter } from './messageHandlers/MessageRouter';
import { SessionManager } from './messageHandlers/SessionManager';

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
      // All handlers are now extracted and handled by MessageRouter:
      // - AICorrectionHandler (Priority 0)
      // - TransactionDetailHandler (Priority 1)
      // - EditHandler (Priority 2)
      // - QuickExpenseHandler (Priority 3)
      // - ManualAddHandler (Priority 4)
      // - RecurringHandler (Priority 4.5)
      // - SplitSettingsHandler (Priority 4.6)
      
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

  // handleManualAddFlow is now in ManualAddHandler

  // handleRecurringAddFlow is now in RecurringHandler
  // handleSplitSettingsInput is now in SplitSettingsHandler

  // executeCorrectionActions is now in shared utility CorrectionActionExecutor

  // handleQuickExpense is now in QuickExpenseHandler

}









import { IMessageHandler } from './IMessageHandler';
import { ExpenseService } from '../../services/expenseService';
import { AIService } from '../../services/ai';
import { HistoryService } from '../../services/historyService';
import { SplitRulesService } from '../../services/splitRulesService';
import { SessionManager } from './SessionManager';
import { TransactionDetailHandler } from './TransactionDetailHandler';
import { QuickExpenseHandler } from './QuickExpenseHandler';
import { EditHandler } from './EditHandler';
import { AICorrectionHandler } from './AICorrectionHandler';

/**
 * Router that dispatches text messages to appropriate handlers
 * 
 * Responsibilities:
 * - Route messages to correct handler based on canHandle() matching
 * - Provide global error boundary (catch errors, log, notify user)
 * - Ensure bot stays alive even when handlers throw errors
 * - Manage session initialization
 */
export class MessageRouter {
  private handlers: IMessageHandler[] = [];

  constructor(
    expenseService: ExpenseService,
    aiService: AIService,
    historyService: HistoryService,
    sessionManager: SessionManager,
    getBotUsername?: () => string,
    showDashboard?: (ctx: any, editMode: boolean) => Promise<void>,
    splitRulesService?: SplitRulesService
  ) {
    // Register all handlers in priority order (first matching handler wins)
    // IMPORTANT: Order matters! More specific handlers should come before more generic ones.
    this.handlers = [
      // Priority 0: AI Correction (@bot ...) - Check bot tags FIRST (highest priority when tagged)
      new AICorrectionHandler(expenseService, aiService, historyService, sessionManager, getBotUsername),
      
      // Priority 1: Transaction ID commands (/77, /74)
      new TransactionDetailHandler(expenseService, aiService, historyService, sessionManager, showDashboard),
      
      // Priority 2: Edit commands (edit /15 20)
      new EditHandler(expenseService, aiService, historyService, sessionManager, showDashboard, splitRulesService),
      
      // Priority 3: Quick expense (130 groceries)
      new QuickExpenseHandler(expenseService, aiService, historyService, sessionManager, getBotUsername, showDashboard, splitRulesService),
      
      // Priority 5: Manual add flow (multi-step) - will be added after extraction
      // new ManualAddHandler(...),
      
      // Priority 6: Recurring expense flow - will be added after extraction
      // new RecurringHandler(...),
    ];
  }

  /**
   * Process a text message by routing it to the appropriate handler
   * @param ctx - Telegram context object
   * @param text - The trimmed text message
   */
  async process(ctx: any, text: string): Promise<boolean | undefined> {
    // Initialize session if it doesn't exist
    if (!ctx.session) {
      ctx.session = {};
    }

    try {
      // Find the first handler that can handle this message (deterministic: first match wins)
      const handler = this.handlers.find(h => h.canHandle(text, ctx.session));

      if (!handler) {
        // Unknown message - return undefined to indicate router didn't handle it
        return undefined;
      }

      // Execute the handler
      await handler.handle(ctx, text);
      return true; // Handler processed the message

    } catch (error: any) {
      // Global error boundary - catch any errors thrown by handlers
      console.error('[MessageRouter] Error processing message:', error);
      console.error('[MessageRouter] Message text was:', text);
      
      // Notify user of error
      try {
        await ctx.reply('❌ Sorry, something went wrong while processing your message.');
      } catch (notifyError) {
        // If we can't notify, log it but don't crash
        console.error('[MessageRouter] Failed to notify user of error:', notifyError);
      }
      
      // Bot stays alive - error is caught and handled
      // Return undefined to indicate error occurred but was handled
      return undefined;
    }
  }
}

import { ICallbackHandler } from './ICallbackHandler';
import { DashboardCallbackHandler } from './DashboardCallbackHandler';
import { SettleCallbackHandler } from './SettleCallbackHandler';
import { MenuCallbackHandler } from './MenuCallbackHandler';
import { RecurringExpenseCallbackHandler } from './RecurringExpenseCallbackHandler';
import { TransactionCallbackHandler } from './TransactionCallbackHandler';
import { HistoryCallbackHandler } from './HistoryCallbackHandler';
import { ManualAddCallbackHandler } from './ManualAddCallbackHandler';
import { SplitSettingsCallbackHandler } from './SplitSettingsCallbackHandler';
import { ExpenseService } from '../../services/expenseService';
import { HistoryService } from '../../services/historyService';
import { RecurringExpenseService } from '../../services/recurringExpenseService';
import { SplitRulesService } from '../../services/splitRulesService';
import { showLoading, hideLoading } from './utils';

/**
 * Router that dispatches callback queries to appropriate handlers
 * 
 * Responsibilities:
 * - Route callbacks to correct handler based on canHandle() matching
 * - Manage loading state lifecycle (show before, hide after)
 * - Provide global error boundary (catch errors, log, notify user)
 * - Ensure bot stays alive even when handlers throw errors
 */
export class CallbackRouter {
  private handlers: ICallbackHandler[] = [];

  constructor(
    expenseService: ExpenseService,
    historyService: HistoryService,
    recurringExpenseService: RecurringExpenseService,
    showDashboard?: (ctx: any, editMode: boolean) => Promise<void>,
    splitRulesService?: SplitRulesService
  ) {
    // Register all handlers in priority order (first matching handler wins)
    // IMPORTANT: Order matters! More specific handlers should come before more generic ones.
    // - SettleCallbackHandler handles 'menu_settle' explicitly, so it comes before MenuCallbackHandler
    // - TransactionCallbackHandler uses prefix matching (tx_, edit_last_, undo_expense_)
    // - Other handlers use exact matches or specific prefixes
    this.handlers = [
      new DashboardCallbackHandler(showDashboard),
      new SettleCallbackHandler(expenseService, historyService, recurringExpenseService, showDashboard),
      new TransactionCallbackHandler(expenseService, historyService, recurringExpenseService, showDashboard),
      new RecurringExpenseCallbackHandler(expenseService, historyService, recurringExpenseService, showDashboard),
      new HistoryCallbackHandler(expenseService, historyService, recurringExpenseService, showDashboard),
      new ManualAddCallbackHandler(expenseService, historyService, recurringExpenseService, showDashboard),
      ...(splitRulesService ? [new SplitSettingsCallbackHandler(splitRulesService)] : []),
      new MenuCallbackHandler(expenseService, historyService, recurringExpenseService, showDashboard),
    ];
  }

  /**
   * Process a callback query by routing it to the appropriate handler
   * @param ctx - Telegram context object
   * @param data - The callback_data string from the callback query
   */
  async process(ctx: any, data: string): Promise<void> {
    // Initialize session if it doesn't exist
    if (!ctx.session) {
      ctx.session = {};
    }

    let loadingMsgId: number | null = null;

    try {
      // 1. Show loading indicator
      loadingMsgId = await showLoading(ctx);

      // 2. Find the first handler that can handle this callback (deterministic: first match wins)
      const handler = this.handlers.find(h => h.canHandle(data));

      if (!handler) {
        // Unknown callback - log and notify user
        console.error('[CallbackRouter] No handler found for callback data:', data);
        await ctx.answerCbQuery('Unknown command', { show_alert: true });
        return;
      }

      // 3. Execute the handler
      await handler.handle(ctx, data);

    } catch (error: any) {
      // 4. Global error boundary - catch any errors thrown by handlers
      console.error('[CallbackRouter] Error processing callback:', error);
      console.error('[CallbackRouter] Callback data was:', data);
      
      // Notify user of error
      try {
        await ctx.answerCbQuery('Error processing request', { show_alert: true });
      } catch (notifyError) {
        // If we can't notify via answerCbQuery, log it but don't crash
        console.error('[CallbackRouter] Failed to notify user of error:', notifyError);
      }
      
      // Bot stays alive - error is caught and handled
    } finally {
      // 5. Always hide loading indicator, even if error occurred
      // hideLoading handles null gracefully, so we can always call it
      await hideLoading(ctx, loadingMsgId);
    }
  }
}


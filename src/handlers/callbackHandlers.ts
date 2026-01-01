import { Context, Markup } from 'telegraf';
import { ExpenseService } from '../services/expenseService';
import { HistoryService } from '../services/historyService';
import { RecurringExpenseService } from '../services/recurringExpenseService';
import { CallbackRouter } from './callbacks/CallbackRouter';

export class CallbackHandlers {
  private router: CallbackRouter;

  constructor(
    private expenseService: ExpenseService,
    private historyService: HistoryService,
    private recurringExpenseService: RecurringExpenseService,
    private showDashboard?: (ctx: any, editMode: boolean) => Promise<void>
  ) {
    // Initialize the router with all dependencies
    this.router = new CallbackRouter(
      expenseService,
      historyService,
      recurringExpenseService,
      showDashboard
    );
  }

  /**
   * Handle callback query by delegating to the router
   * @param ctx - Telegram context object
   */
  async handleCallback(ctx: any): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data) return;

    // Delegate to Router
    await this.router.process(ctx, data);
  }
}

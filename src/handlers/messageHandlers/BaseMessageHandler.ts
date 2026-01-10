import { IMessageHandler } from './IMessageHandler';
import { ExpenseService } from '../../services/expenseService';
import { AIService } from '../../services/ai';
import { HistoryService } from '../../services/historyService';
import { SplitRulesService } from '../../services/splitRulesService';
import { SessionManager } from './SessionManager';

/**
 * Base class for all message handlers with common dependencies
 * Prevents code duplication and ensures consistent dependency injection
 */
export abstract class BaseMessageHandler implements IMessageHandler {
  protected constructor(
    protected expenseService: ExpenseService,
    protected aiService: AIService,
    protected historyService: HistoryService,
    protected sessionManager: SessionManager,
    protected getBotUsername?: () => string,
    protected showDashboard?: (ctx: any, editMode: boolean) => Promise<void>,
    protected splitRulesService?: SplitRulesService
  ) {}

  // Abstract methods - must be implemented by subclasses
  abstract canHandle(text: string, session: any): boolean;
  abstract handle(ctx: any, text: string): Promise<void>;
}

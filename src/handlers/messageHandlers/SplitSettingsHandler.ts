import { BaseMessageHandler } from './BaseMessageHandler';
import { ExpenseService } from '../../services/expenseService';
import { AIService } from '../../services/ai';
import { HistoryService } from '../../services/historyService';
import { SessionManager } from './SessionManager';
import { SplitRulesService, ValidationError } from '../../services/splitRulesService';
import { getUserAName, getUserBName } from '../../config';

/**
 * Handler for custom split percentage input
 * Handles user input when configuring split rules for categories
 */
export class SplitSettingsHandler extends BaseMessageHandler {
  constructor(
    expenseService: ExpenseService,
    aiService: AIService,
    historyService: HistoryService,
    sessionManager: SessionManager,
    splitRulesService?: SplitRulesService
  ) {
    super(expenseService, aiService, historyService, sessionManager, undefined, undefined, splitRulesService);
  }

  canHandle(text: string, session: any): boolean {
    // Only handle if waiting for split input
    return !!(session.waitingForSplitInput && session.splitSettingsCategory);
  }

  async handle(ctx: any, text: string): Promise<void> {
    const session = ctx.session || {};

    if (!this.splitRulesService) {
      console.error('[SplitSettingsHandler] SplitRulesService not available');
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
        console.error('[SplitSettingsHandler] Error:', error);
        await ctx.reply('❌ Error updating split. Please try again.');
      }
      // Stay in input mode on error (user can try again or cancel)
    }
  }
}

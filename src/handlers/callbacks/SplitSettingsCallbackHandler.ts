import { Context, Markup } from 'telegraf';
import { ICallbackHandler } from './ICallbackHandler';
import { SplitRulesService, ValidationError } from '../../services/splitRulesService';
import { getUserAName, getUserBName } from '../../config';

/**
 * Handler for split settings callbacks
 * Manages category-based split percentage configuration
 */
export class SplitSettingsCallbackHandler implements ICallbackHandler {
  constructor(private splitRulesService: SplitRulesService) {}

  canHandle(data: string): boolean {
    return (
      data === 'OPEN_SPLIT_SETTINGS' ||
      data.startsWith('SPLIT_EDIT_') ||
      data.startsWith('SPLIT_SET_') ||
      data.startsWith('SPLIT_CUSTOM_')
    );
  }

  /**
   * CRITICAL: Clear input state to prevent zombie states
   * Call this at the start of handle() for all callbacks EXCEPT SPLIT_CUSTOM_
   */
  private clearInputState(ctx: any): void {
    if (ctx.session) {
      ctx.session.waitingForSplitInput = false;
      ctx.session.splitSettingsCategory = undefined;
    }
  }

  async handle(ctx: any, data: string): Promise<void> {
    // SAFETY FIRST: Clear input state immediately
    // Exception: SPLIT_CUSTOM_ will set the state, so we skip clearing for that case
    if (!data.startsWith('SPLIT_CUSTOM_')) {
      this.clearInputState(ctx);
    }

    if (data === 'OPEN_SPLIT_SETTINGS') {
      await this.handleOpenSplitSettings(ctx);
    } else if (data.startsWith('SPLIT_EDIT_')) {
      const category = data.replace('SPLIT_EDIT_', '');
      await this.handleEditSplit(ctx, category);
    } else if (data.startsWith('SPLIT_SET_')) {
      // Format: SPLIT_SET_{Category}_{BryInt}
      const parts = data.replace('SPLIT_SET_', '').split('_');
      const category = parts.slice(0, -1).join('_'); // Handle categories with underscores
      const bryInt = parseInt(parts[parts.length - 1]);
      await this.handlePresetSplit(ctx, category, bryInt);
    } else if (data.startsWith('SPLIT_CUSTOM_')) {
      const category = data.replace('SPLIT_CUSTOM_', '');
      await this.handleCustomInput(ctx, category);
    }
  }

  /**
   * Get emoji for category
   */
  private getCategoryEmoji(category: string): string {
    const emojiMap: Record<string, string> = {
      'Groceries': '🛒',
      'Food': '🍔',
      'Bills': '💸',
      'Shopping': '🛍️',
      'Travel': '✈️',
      'Entertainment': '🎬',
      'Transport': '🚗',
      'Medical': '🏥',
      'Other': '📦',
    };
    return emojiMap[category] || '📦';
  }

  /**
   * Get list of all known categories
   */
  private getKnownCategories(): string[] {
    return [
      'Groceries',
      'Food',
      'Bills',
      'Shopping',
      'Travel',
      'Entertainment',
      'Transport',
      'Medical',
      'Other',
    ];
  }

  /**
   * Render main split settings menu with all categories
   */
  private async handleOpenSplitSettings(ctx: any): Promise<void> {
    await ctx.answerCbQuery();

    try {
      // Get all known categories (not from config, which may be empty)
      const knownCategories = this.getKnownCategories();

      // Fetch all split rules in parallel for better performance
      const rules = await Promise.all(
        knownCategories.map(category => 
          this.splitRulesService.getSplitRule(category)
        )
      );

      // Build list of categories with their current splits
      const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

      // Iterate over categories and their fetched rules
      for (let i = 0; i < knownCategories.length; i++) {
        const category = knownCategories[i];
        const rule = rules[i];
        const bryPercent = Math.round(rule.userAPercent * 100);
        const hweiPercent = Math.round(rule.userBPercent * 100);
        const emoji = this.getCategoryEmoji(category);
        buttons.push([
          {
            text: `${emoji} ${category} (${bryPercent}/${hweiPercent})`,
            callback_data: `SPLIT_EDIT_${category}`,
          },
        ]);
      }

      // Add back button
      buttons.push([{ text: '« Back to Main Menu', callback_data: 'back_to_dashboard' }]);

      await ctx.editMessageText(
        '⚙️ **Split Rules Settings**\n\nSelect a category to edit:',
        {
          reply_markup: {
            inline_keyboard: buttons,
          },
          parse_mode: 'Markdown',
        }
      );
    } catch (error: any) {
      console.error('[SplitSettingsCallbackHandler] Error in handleOpenSplitSettings:', error);
      await ctx.reply('❌ Error loading split settings. Please try again.');
    }
  }

  /**
   * Render edit menu for a specific category
   */
  private async handleEditSplit(ctx: any, category: string): Promise<void> {
    await ctx.answerCbQuery();

    try {
      const rule = await this.splitRulesService.getSplitRule(category);
      const currentBry = Math.round(rule.userAPercent * 100);
      const currentHwei = Math.round(rule.userBPercent * 100);
      const userAName = getUserAName();
      const userBName = getUserBName();

      await ctx.editMessageText(
        `Editing split for **${category}**.\n\nCurrent: ${userAName} ${currentBry}% / ${userBName} ${currentHwei}%`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: `${userAName} 50% / ${userBName} 50%`, callback_data: `SPLIT_SET_${category}_50` },
                { text: `${userAName} 60% / ${userBName} 40%`, callback_data: `SPLIT_SET_${category}_60` },
              ],
              [
                { text: `${userAName} 70% / ${userBName} 30%`, callback_data: `SPLIT_SET_${category}_70` },
              ],
              [
                { text: 'Custom Input', callback_data: `SPLIT_CUSTOM_${category}` },
                { text: '« Back', callback_data: 'OPEN_SPLIT_SETTINGS' },
              ],
            ],
          },
          parse_mode: 'Markdown',
        }
      );
    } catch (error: any) {
      console.error('[SplitSettingsCallbackHandler] Error in handleEditSplit:', error);
      await ctx.reply('❌ Error loading category. Please try again.');
    }
  }

  /**
   * Handle preset split selection
   */
  private async handlePresetSplit(ctx: any, category: string, bryInt: number): Promise<void> {
    // Validate integer
    if (isNaN(bryInt) || bryInt < 0 || bryInt > 100) {
      await ctx.answerCbQuery('❌ Invalid percentage', { show_alert: true });
      return;
    }

    try {
      const bryanDec = bryInt / 100;
      const hweiDec = (100 - bryInt) / 100;
      const userAName = getUserAName();
      const userBName = getUserBName();

      await this.splitRulesService.updateSplitRule(category, bryanDec, hweiDec);
      await ctx.answerCbQuery(`✅ Updated: ${userAName} ${bryInt}% / ${userBName} ${100 - bryInt}%`);

      // Re-render main split menu
      await this.handleOpenSplitSettings(ctx);
    } catch (error: any) {
      console.error('[SplitSettingsCallbackHandler] Error in handlePresetSplit:', error);
      if (error instanceof ValidationError) {
        await ctx.answerCbQuery(`❌ ${error.message}`, { show_alert: true });
      } else {
        await ctx.answerCbQuery('❌ Error updating split', { show_alert: true });
      }
    }
  }

  /**
   * Handle custom input mode - set session state and prompt user
   */
  private async handleCustomInput(ctx: any, category: string): Promise<void> {
    await ctx.answerCbQuery();

    // ENABLE STATE: Set session flags for input mode
    if (!ctx.session) {
      ctx.session = {};
    }
    ctx.session.waitingForSplitInput = true;
    ctx.session.splitSettingsCategory = category;

    try {
      const userAName = getUserAName();
      await ctx.editMessageText(
        `Enter ${userAName}'s percentage (0-100) for **${category}**:`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Cancel', callback_data: `SPLIT_EDIT_${category}` }],
            ],
          },
          parse_mode: 'Markdown',
        }
      );
    } catch (error: any) {
      console.error('[SplitSettingsCallbackHandler] Error in handleCustomInput:', error);
      // Clear state on error
      this.clearInputState(ctx);
      await ctx.reply('❌ Error. Please try again.');
    }
  }
}


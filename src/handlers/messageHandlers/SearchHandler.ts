import { BaseMessageHandler } from './BaseMessageHandler';
import { ExpenseService } from '../../services/expenseService';
import { AIService } from '../../services/ai';
import { HistoryService } from '../../services/historyService';
import { SessionManager } from './SessionManager';
import { prisma } from '../../lib/prisma';
import { Markup } from 'telegraf';
import { formatDate } from '../../utils/dateHelpers';

/**
 * Handler for transaction search functionality
 * Searches transactions by description or category (case-insensitive)
 */
export class SearchHandler extends BaseMessageHandler {
  constructor(
    expenseService: ExpenseService,
    aiService: AIService,
    historyService: HistoryService,
    sessionManager: SessionManager
  ) {
    super(expenseService, aiService, historyService, sessionManager);
  }

  canHandle(text: string, session: any): boolean {
    // Only handle if in search mode
    return this.sessionManager.isSearchMode(session);
  }

  async handle(ctx: any, text: string): Promise<void> {
    const session = ctx.session || {};

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
}

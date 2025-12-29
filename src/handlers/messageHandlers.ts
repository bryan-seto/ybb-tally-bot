import { Context, Markup } from 'telegraf';
import { prisma } from '../lib/prisma';
import { ExpenseService } from '../services/expenseService';
import { formatDate, getNow } from '../utils/dateHelpers';
import { USER_NAMES } from '../config';

export class MessageHandlers {
  constructor(private expenseService: ExpenseService) {}

  async handleText(ctx: any) {
    if (!ctx.session) ctx.session = {};
    const text = ctx.message.text.trim();
    const textLower = text.toLowerCase();
    const session = ctx.session;
    const chatId = ctx.chat.id;

    // Handle transaction ID commands (e.g., /101)
    const transactionIdMatch = text.match(/^\/(\d+)$/);
    if (transactionIdMatch) {
      // Logic for showTransactionDetail...
      return;
    }

    // Handle cancel
    if (text === '❌ Cancel') {
      this.clearSession(session);
      await ctx.reply('❌ Operation cancelled.', Markup.removeKeyboard());
      return;
    }

    // Handle manual add flow
    if (session.manualAddMode) {
      await this.handleManualAddFlow(ctx, text, session);
      return;
    }

    // Handle recurring flow
    if (session.recurringMode) {
      await this.handleRecurringFlow(ctx, text, session);
      return;
    }

    // Handle search flow
    if (session.searchMode) {
      await this.handleSearchFlow(ctx, text, session);
      return;
    }
  }

  private clearSession(session: any) {
    session.manualAddMode = false;
    session.manualAddStep = undefined;
    session.recurringMode = false;
    session.recurringStep = undefined;
    session.editLastMode = false;
    session.editLastAction = undefined;
    session.searchMode = false;
    session.awaitingAmountConfirmation = false;
    session.awaitingPayer = false;
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
      // ... category selection keyboard
    }
  }

  private async handleRecurringFlow(ctx: any, text: string, session: any) {
    // ... logic from bot.ts
  }

  private async handleSearchFlow(ctx: any, text: string, session: any) {
    // ... logic from bot.ts
  }
}


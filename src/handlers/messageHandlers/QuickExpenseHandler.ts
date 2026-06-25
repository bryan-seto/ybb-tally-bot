import { BaseMessageHandler } from './BaseMessageHandler';
import { ExpenseService } from '../../services/expenseService';
import { AIService } from '../../services/ai';
import { HistoryService } from '../../services/historyService';
import { SplitRulesService } from '../../services/splitRulesService';
import { SessionManager } from './SessionManager';
import { Markup } from 'telegraf';
import { getUserAName, getUserBName } from '../../config';
import { parseQuickExpense, parseMultipleExpenses } from '../../utils/quickExpenseParser';
import { formatFxAmountString } from '../../utils/fxFormat';

/** Wrap a Telegram API call with a timeout. Rejects with an error on timeout. */
async function withTelegramTimeout<T>(promise: Promise<T>, ms = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Telegram API timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Handler for quick expense one-liners (e.g., "130 groceries", "5.50 coffee")
 */
export class QuickExpenseHandler extends BaseMessageHandler {
  constructor(
    expenseService: ExpenseService,
    aiService: AIService,
    historyService: HistoryService,
    sessionManager: SessionManager,
    getBotUsername?: () => string,
    showDashboard?: (ctx: any, editMode: boolean) => Promise<void>,
    splitRulesService?: SplitRulesService
  ) {
    super(expenseService, aiService, historyService, sessionManager, getBotUsername, showDashboard, splitRulesService);
  }

  canHandle(text: string, session: any): boolean {
    // Don't handle if in manual add or edit mode
    if (this.sessionManager.isManualAddMode(session) || this.sessionManager.isEditMode(session)) {
      return false;
    }

    // Don't handle if the bot itself is mentioned anywhere in the message.
    // startsWith('@') guards plain @OtherUser mentions at the start.
    // The includes() guard catches mid-sentence bot tags like "hey @bot split venchi".
    if (text.trim().startsWith('@')) {
      return false;
    }
    const botUsername = this.getBotUsername?.();
    if (botUsername && text.includes(`@${botUsername}`)) {
      return false;
    }

    // Don't handle if text starts with 'edit' (edit commands)
    if (text.trim().toLowerCase().startsWith('edit ')) {
      return false;
    }

    // Multi-line: if there are ≥2 non-empty lines and the first parseable line
    // looks like an expense, hand off to handle() which runs the full batch path.
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      // Accept if at least the first line looks like an expense (letters + digits)
      const firstLine = lines[0];
      const hasLetters = /[a-zA-Z]/.test(firstLine);
      const hasNumbers = /\d/.test(firstLine);
      if (hasLetters && hasNumbers) {
        return true;
      }
    }

    // Priority 1.5: Check for Quick Expense pattern (before other handlers)
    // Pattern 1: Number first (e.g., "2 coffee", "130 groceries")
    const quickExpensePattern = /^\d+(\.\d{1,2})?\s+[a-zA-Z].*/;
    const patternMatches = quickExpensePattern.test(text);
    if (patternMatches) {
      return true;
    }
    
    // Pattern 2: Description first (e.g., "coffee 2", "lunch 15.50")
    // Check if text contains both letters and numbers (likely an expense)
    const hasLetters = /[a-zA-Z]/.test(text);
    const hasNumbers = /\d/.test(text);
    const looksLikeExpense = hasLetters && hasNumbers && text.trim().split(/\s+/).length >= 2;
    if (looksLikeExpense && !text.startsWith('/')) {
      return true;
    }

    return false;
  }

  async handle(ctx: any, text: string): Promise<void> {
    console.log('[DEBUG] handleQuickExpense triggered with:', text);
    console.log('[DEBUG] handleQuickExpense context:', {
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type
    });
    let statusMsg: any = null;
    try {
      // ── Multi-line batch path ──────────────────────────────────────────
      // If the message has ≥2 non-empty lines, attempt to parse each line
      // individually. Record all parseable lines; report skipped lines.
      const inputLines = text.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      if (inputLines.length >= 2) {
        const { parsed: batchParsed, failedLines } = parseMultipleExpenses(text);

        if (batchParsed.length > 0) {
          statusMsg = await ctx.reply('👀 Processing expenses...', { parse_mode: 'HTML' });

          const userId = BigInt(ctx.from.id);
          const tgMsgId = ctx.message?.message_id ? BigInt(ctx.message.message_id) : undefined;
          const confirmations: string[] = [];
          let lastBalanceMessage = '';
          let skippedDuplicates = 0;

          for (const expense of batchParsed) {
            await withTelegramTimeout(
              ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                `⏳ Saving expense ${confirmations.length + 1} of ${batchParsed.length}...`,
                { parse_mode: 'HTML' }
              )
            );

            const batchIndex = batchParsed.indexOf(expense);
            const { transaction, balanceMessage, duplicate } = await this.expenseService.createSmartExpense(
              userId,
              expense.amount,
              expense.category,
              expense.description,
              expense.currency ?? 'SGD',
              tgMsgId,
              batchIndex
            );
            lastBalanceMessage = balanceMessage;

            if (duplicate) {
              skippedDuplicates++;
              continue;
            }

            // Build per-line display
            const parsedCurrency: string = expense.currency ?? 'SGD';
            const amountDisplay = formatFxAmountString(
              transaction.amountSGD,
              parsedCurrency,
              transaction.originalAmount,
              transaction.fxRate,
            );
            const funConfirmation = this.expenseService.getFunConfirmation(expense.category);
            confirmations.push(`${funConfirmation} ${expense.description} — ${amountDisplay} (${expense.category})`);
          }

          const summaryLines = confirmations.join('\n');
          let skippedNote = '';
          if (failedLines.length > 0) {
            skippedNote = `\n\n⚠️ Couldn't parse ${failedLines.length} line${failedLines.length > 1 ? 's' : ''}:\n${failedLines.map((l: string) => `• ${l}`).join('\n')}`;
          }

          // If ALL were duplicates, say so and bail early quietly
          if (confirmations.length === 0 && skippedDuplicates > 0) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              undefined,
              `⚠️ Already recorded (duplicate message) — nothing added.`,
              { parse_mode: 'HTML' }
            );
            return;
          }

          const recordedCount = confirmations.length;
          const finalMessage = `✅ Recorded ${recordedCount} expense${recordedCount > 1 ? 's' : ''}:\n${summaryLines}\n\n${lastBalanceMessage}${skippedNote}`;

          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            finalMessage,
            { parse_mode: 'Markdown' }
          );

          if (this.showDashboard) {
            await this.showDashboard(ctx, false);
          }
          return;
        }
        // If zero lines parsed, fall through to single-expense path
        // (which will try AI on the full text)
      }

      // ── Single-expense path (original logic) ─────────────────────────
      // Send initial status message
      statusMsg = await ctx.reply('👀 Processing expense...', { parse_mode: 'HTML' });
      console.log('[DEBUG] handleQuickExpense: Status message sent');

      // Try regex parsing first (saves LLM costs)
      let parsed;
      const regexParsed = parseQuickExpense(text);
      
      if (regexParsed) {
        console.log('[DEBUG] handleQuickExpense: Regex parsing succeeded, skipping AI:', regexParsed);
        parsed = regexParsed;
      } else {
        console.log('[DEBUG] handleQuickExpense: Regex parsing failed, using AI...');
        
        // Set up fallback callback (silent - quota errors will be shown in final error message)
        const onFallback = async (failed: string, next: string) => {
          // Don't show fallback messages - they're noisy and quota errors will be shown in the final error message
          // Just log for debugging
          console.log(`[DEBUG] Model ${failed} failed, trying ${next}...`);
        };

        // Parse via LLM (fallback for complex patterns)
        console.log('[DEBUG] handleQuickExpense: Calling aiService.processQuickExpense...');
        parsed = await this.aiService.processQuickExpense(text, onFallback);
        console.log('[DEBUG] handleQuickExpense: AI parsing result:', parsed);
      }

      // Update status message
      await withTelegramTimeout(
        ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          '⏳ Saving expense...',
          { parse_mode: 'HTML' }
        )
      );

      // Get user ID
      const userId = BigInt(ctx.from.id);
      const tgMsgId = ctx.message?.message_id ? BigInt(ctx.message.message_id) : undefined;
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
        parsed.description,
        (parsed as any).currency ?? 'SGD',
        tgMsgId,
        0
      );
      console.log('[DEBUG] handleQuickExpense: Transaction created successfully:', {
        transactionId: transaction.id.toString(),
        amount: transaction.amountSGD
      });

      // Stale manual rate warning (non-SGD only)
      const parsedCurrency: string = (parsed as any).currency ?? 'SGD';
      let staleRateWarning = '';
      if (parsedCurrency !== 'SGD') {
        try {
          const isStale = await this.expenseService.fxRateService.isManualRateStale(parsedCurrency);
          if (isStale) {
            staleRateWarning = `\n\n⚠️ You set this ${parsedCurrency} rate over 14 days ago — still correct? /clearrate ${parsedCurrency}`;
          }
        } catch {
          // Non-fatal: stale check failure shouldn't break expense recording
        }
      }

      // Get fun confirmation message
      const funConfirmation = this.expenseService.getFunConfirmation(parsed.category);

      // Get split details for display
      let splitDetails = '';
      if (this.splitRulesService && transaction.bryanPercentage !== null && transaction.hweiYeenPercentage !== null) {
        const userAName = getUserAName();
        const userBName = getUserBName();
        const userAPercent = Math.round(transaction.bryanPercentage * 100);
        const userBPercent = Math.round(transaction.hweiYeenPercentage * 100);
        // Split amounts are always in SGD (amountSGD * percentage)
        const userAAmount = transaction.amountSGD * transaction.bryanPercentage;
        const userBAmount = transaction.amountSGD * transaction.hweiYeenPercentage;
        splitDetails = `\n📊 Split: ${userAName} ${userAPercent}% (S$${userAAmount.toFixed(2)}) / ${userBName} ${userBPercent}% (S$${userBAmount.toFixed(2)})`;
      }

      // Generate tip footer (20% chance = 1/5 times)
      const tipFooter = Math.random() < 0.2 ? "\n\n💡 Tip: Tap 'Undo' if you made a mistake!" : "";

      // Build confirmation headline: show original amount + SGD conversion for FX expenses
      const parsedCurrencyUpper: string = (parsed as any).currency ?? 'SGD';
      const amountDisplay = formatFxAmountString(
        transaction.amountSGD,
        parsedCurrencyUpper,
        transaction.originalAmount,
        transaction.fxRate,
      );

      // Build final message
      const finalMessage = `${funConfirmation} ${parsed.description} — ${amountDisplay} (${parsed.category})${splitDetails}\n\n${balanceMessage}${tipFooter}`;

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

      // Send stale rate warning as a separate reply (so tests can detect via ctx.reply)
      if (staleRateWarning) {
        await ctx.reply(staleRateWarning.trim());
      }

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
      
      // Check if it's a quota/rate limit error
      // Check both the error message and the error chain (some errors wrap quota errors)
      const errorMsg = error.message?.toLowerCase() || '';
      const errorStack = error.stack?.toLowerCase() || '';
      const fullErrorText = (errorMsg + ' ' + errorStack).toLowerCase();
      
      const isQuotaError = fullErrorText.includes('quota') || 
                          fullErrorText.includes('rate limit') || 
                          fullErrorText.includes('429') ||
                          fullErrorText.includes('exceeded') ||
                          fullErrorText.includes('free tier') ||
                          fullErrorText.includes('limits ran out') ||
                          fullErrorText.includes('too many requests') ||
                          error.status === 429 ||
                          error.code === 429 ||
                          error.name === 'QuotaExceededError';
      
      let userMessage: string;
      if (isQuotaError) {
        userMessage = '🚫 AI daily free limits ran out. Upgrade to get more limits.\n\n💡 Tip: Use simple format like "5 coffee" or "120 pork" to avoid AI usage.';
      } else {
        userMessage = '❌ Sorry, I couldn\'t process that expense. Please try again or use the format: "5 coffee" or "120 pork"';
      }
      
      if (statusMsg) {
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            userMessage
          );
        } catch (editError) {
          await ctx.reply(userMessage);
        }
      } else {
        await ctx.reply(userMessage);
      }
    }
  }
}

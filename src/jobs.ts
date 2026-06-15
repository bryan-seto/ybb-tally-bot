import cron from 'node-cron';
import { prisma } from './lib/prisma';
import { YBBTallyBot } from './bot';
import { ExpenseService } from './services/expenseService';
import { RecurringExpenseService } from './services/recurringExpenseService';
import { getDayOfMonth, getNow } from './utils/dateHelpers';
import { CONFIG } from './config';
import { shouldUseWebhook } from './utils/transportMode';

/**
 * Ensure Telegram's registered webhook URL matches our expected WEBHOOK_URL.
 * Runs on startup and every 5 minutes to win any race against stale deployments
 * (e.g. an old Render instance that also holds the same bot token and resets the
 * webhook to its own URL when it cold-starts).
 *
 * Pure function: testable without side-effects by injecting getTelegram/getExpectedUrl.
 */
export async function assertWebhook(
  getTelegram: () => { getWebhookInfo: () => Promise<{ url?: string }>; setWebhook: (url: string, opts?: object) => Promise<unknown> },
  getExpectedUrl: () => string,
): Promise<{ corrected: boolean; was: string; now: string }> {
  const telegram = getTelegram();
  const expectedUrl = getExpectedUrl();
  const info = await telegram.getWebhookInfo();
  const currentUrl = info.url ?? '';

  if (currentUrl === expectedUrl) {
    return { corrected: false, was: currentUrl, now: currentUrl };
  }

  console.warn(`[WebhookWatchdog] Mismatch detected — was: ${currentUrl}, correcting to: ${expectedUrl}`);
  await telegram.setWebhook(expectedUrl, { drop_pending_updates: false });
  console.log(`[WebhookWatchdog] ✅ Webhook corrected to: ${expectedUrl}`);
  return { corrected: true, was: currentUrl, now: expectedUrl };
}

export function setupJobs(bot: YBBTallyBot, expenseService: ExpenseService) {
  const recurringExpenseService = new RecurringExpenseService(expenseService);

  // Recurring expenses at 09:00 Asia/Singapore time = 01:00 UTC
  cron.schedule('0 1 * * *', async () => {
    try {
      const today = getDayOfMonth();
      const recurringExpenses = await prisma.recurringExpense.findMany({
        where: { dayOfMonth: today, isActive: true },
        include: { payer: true },
      });

      if (recurringExpenses.length === 0) {
        return; // No recurring expenses to process today
      }

      // Process all recurring expenses and collect saved transactions
      const savedTransactions = [];
      let balanceMessage = '';
      for (const expense of recurringExpenses) {
        const result = await recurringExpenseService.processSingleRecurringExpense(expense);
        if (result) {
          savedTransactions.push(result.transaction);
          balanceMessage = result.message; // Use the last message (they should all be the same)
        }
      }

      // Build the standard format message
      let summary = `✅ **Recorded ${savedTransactions.length} expense${savedTransactions.length > 1 ? 's' : ''}:**\n`;
      
      savedTransactions.forEach(tx => {
        summary += `• **${tx.description}**: SGD $${tx.amountSGD.toFixed(2)} (Bills)\n`;
      });

      summary += `\n${balanceMessage}`;

      await bot.sendToPrimaryGroup(summary, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error processing recurring expenses:', error);
    }
  });

  // Daily backup at 02:00 Asia/Singapore time = 18:00 UTC (previous day)
  cron.schedule('0 18 * * *', async () => {
    try {
      await bot.sendBackupToUser(Number(CONFIG.BACKUP_RECIPIENT_ID));
    } catch (error) {
      console.error('Error in daily backup job:', error);
    }
  });

  // Webhook watchdog — every 5 minutes, re-assert the correct webhook URL.
  // Guards against stale parallel deployments (e.g. Render) resetting the webhook
  // to their own URL after a cold-start, which would silently swallow all updates.
  const environment = CONFIG.NODE_ENV || 'development';
  if (shouldUseWebhook(environment, CONFIG.WEBHOOK_URL)) {
    const expectedWebhookUrl = `${CONFIG.WEBHOOK_URL}/webhook`;

    cron.schedule('*/5 * * * *', async () => {
      try {
        const result = await assertWebhook(
          () => bot.getBot().telegram,
          () => expectedWebhookUrl,
        );
        if (result.corrected) {
          console.warn(`[WebhookWatchdog] ⚠️ Corrected stale webhook (was: ${result.was})`);
        }
      } catch (error) {
        console.error('[WebhookWatchdog] Error checking webhook:', error);
      }
    });

    console.log(`[WebhookWatchdog] Monitoring webhook every 5 min → ${expectedWebhookUrl}`);
  }
}


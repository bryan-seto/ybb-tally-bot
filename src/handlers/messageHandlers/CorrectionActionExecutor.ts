import { CorrectionAction } from '../../services/ai';
import { prisma } from '../../lib/prisma';
import { USER_A_ROLE_KEY, USER_B_ROLE_KEY } from '../../config';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { format, parseISO } from 'date-fns';
import { analyticsBus, AnalyticsEventType } from '../../events/analyticsBus';

const TIMEZONE = 'Asia/Singapore';

/**
 * Shared utility for executing correction actions returned by AI service
 * Used by both EditHandler and AICorrectionHandler
 * 
 * @param ctx - Telegram context
 * @param actions - Array of correction actions from AI service
 * @param statusMsg - Status message to update during execution
 * @returns Array of result messages and the updated transaction (if any)
 */
export async function executeCorrectionActions(
  ctx: any,
  actions: CorrectionAction[],
  statusMsg: any
): Promise<{ results: string[]; updatedTransaction?: any }> {
  const results: string[] = [];
  let updatedTransaction: any = undefined;
  
  for (const step of actions) {
    if (step.action === 'UNKNOWN') continue;

    // Update status message for current action
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `⏳ <i>${step.statusMessage}</i>`,
      { parse_mode: 'HTML' }
    );

    // Small delay for natural feel
    await new Promise(resolve => setTimeout(resolve, 500));

    // Execute DB logic
    try {
      const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
      const chatId = ctx.chat?.id ? BigInt(ctx.chat.id) : undefined;
      const chatType = ctx.chat?.type;

      if (step.action === 'UPDATE_SPLIT' && step.transactionId && step.data) {
        const updated = await prisma.transaction.update({
          where: { id: step.transactionId },
          data: {
            bryanPercentage: step.data.bryanPercentage,
            hweiYeenPercentage: step.data.hweiYeenPercentage,
          },
          include: {
            payer: true,
          },
        });
        updatedTransaction = updated;
        const bryanSplit = Math.round((step.data.bryanPercentage ?? 0.7) * 100);
        const hweiYeenSplit = Math.round((step.data.hweiYeenPercentage ?? 0.3) * 100);
        results.push(`✅ Split updated for "${updated.description}" to ${bryanSplit}-${hweiYeenSplit}`);
        
        // Emit analytics event
        if (userId) {
          analyticsBus.emit(AnalyticsEventType.TRANSACTION_UPDATED, {
            userId,
            transactionId: step.transactionId,
            changes: { bryanPercentage: step.data.bryanPercentage, hweiYeenPercentage: step.data.hweiYeenPercentage },
            chatId,
            chatType,
          });
        }
      } else if (step.action === 'UPDATE_AMOUNT' && step.transactionId && step.data) {
        const updated = await prisma.transaction.update({
          where: { id: step.transactionId },
          data: { amountSGD: step.data.amountSGD },
          include: {
            payer: true,
          },
        });
        updatedTransaction = updated;
        results.push(`✅ Amount updated for "${updated.description}" to $${updated.amountSGD.toFixed(2)}`);
        
        // Emit analytics event
        if (userId) {
          analyticsBus.emit(AnalyticsEventType.TRANSACTION_UPDATED, {
            userId,
            transactionId: step.transactionId,
            changes: { amountSGD: step.data.amountSGD },
            chatId,
            chatType,
          });
        }
      } else if (step.action === 'UPDATE_CATEGORY' && step.transactionId && step.data) {
        const updated = await prisma.transaction.update({
          where: { id: step.transactionId },
          data: { category: step.data.category },
          include: {
            payer: true,
          },
        });
        updatedTransaction = updated;
        results.push(`✅ Category updated for "${updated.description}" to ${updated.category}`);
        
        // Emit analytics event
        if (userId) {
          analyticsBus.emit(AnalyticsEventType.TRANSACTION_UPDATED, {
            userId,
            transactionId: step.transactionId,
            changes: { category: step.data.category },
            chatId,
            chatType,
          });
        }
      } else if (step.action === 'DELETE' && step.transactionId) {
        const deleted = await prisma.transaction.delete({
          where: { id: step.transactionId },
        });
        // Don't set updatedTransaction for DELETE actions
        results.push(`🗑️ Deleted "${deleted.description}"`);
        
        // Emit analytics event
        if (userId) {
          analyticsBus.emit(AnalyticsEventType.TRANSACTION_DELETED, {
            userId,
            transactionId: step.transactionId,
            chatId,
            chatType,
          });
        }
      } else if (step.action === 'UPDATE_PAYER' && step.transactionId && step.data?.payerKey) {
        const payerRole = step.data.payerKey === 'BRYAN' ? USER_A_ROLE_KEY : USER_B_ROLE_KEY;
        const user = await prisma.user.findFirst({ where: { role: payerRole } });
        if (!user) {
          throw new Error(`User with role ${payerRole} not found`);
        }
        const updated = await prisma.transaction.update({
          where: { id: step.transactionId },
          data: { payerId: user.id },
          include: {
            payer: true,
          },
        });
        updatedTransaction = updated;
        results.push(`✅ Payer updated to ${payerRole}`);
        
        // Emit analytics event
        if (userId) {
          analyticsBus.emit(AnalyticsEventType.TRANSACTION_UPDATED, {
            userId,
            transactionId: step.transactionId,
            changes: { payerId: user.id.toString() },
            chatId,
            chatType,
          });
        }
      } else if (step.action === 'UPDATE_STATUS' && step.transactionId && step.data?.isSettled !== undefined) {
        const updated = await prisma.transaction.update({
          where: { id: step.transactionId },
          data: { isSettled: step.data.isSettled },
          include: {
            payer: true,
          },
        });
        updatedTransaction = updated;
        const statusText = step.data.isSettled ? 'settled' : 'unsettled';
        results.push(`✅ Status updated to ${statusText}`);
        
        // Emit analytics event
        if (userId) {
          analyticsBus.emit(AnalyticsEventType.TRANSACTION_UPDATED, {
            userId,
            transactionId: step.transactionId,
            changes: { isSettled: step.data.isSettled },
            chatId,
            chatType,
          });
        }
      } else if (step.action === 'UPDATE_DATE' && step.transactionId && step.data?.date) {
        // Fetch current transaction to preserve time components
        const currentTx = await prisma.transaction.findUnique({
          where: { id: step.transactionId },
        });
        if (!currentTx) {
          throw new Error('Transaction not found');
        }
        
        // Step A: Get current transaction date in Singapore timezone
        const currentZoned = toZonedTime(currentTx.date, TIMEZONE);
        
        // Step B: Extract time portion strictly (HH:mm:ss.SSS)
        const timeString = format(currentZoned, 'HH:mm:ss.SSS');
        
        // Step C: Validate input date format (YYYY-MM-DD)
        const dateStr = step.data.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
        }
        
        // Step D: Compose ISO string with Singapore timezone offset
        const isoString = `${dateStr}T${timeString}+08:00`;
        
        // Step E: Parse ISO string and convert from Singapore timezone to UTC
        // parseISO correctly parses the string with +08:00 timezone and converts to UTC
        // This preserves the exact wall-clock time in Singapore timezone
        const parsedDate = parseISO(isoString);
        // Use fromZonedTime to ensure proper timezone handling
        // First convert the parsed UTC date back to Singapore view to verify,
        // then convert back to UTC (this ensures consistency)
        const verifyZoned = toZonedTime(parsedDate, TIMEZONE);
        const finalDate = fromZonedTime(verifyZoned, TIMEZONE);
        
        // Observability logging
        console.log('[UPDATE_DATE] Input Date:', dateStr);
        console.log('[UPDATE_DATE] Frozen Time (SG):', timeString);
        console.log('[UPDATE_DATE] Combined String:', isoString);
        console.log('[UPDATE_DATE] Final UTC:', finalDate.toISOString());
        
        // Step F: Save to database
        const updated = await prisma.transaction.update({
          where: { id: step.transactionId },
          data: { date: finalDate },
          include: {
            payer: true,
          },
        });
        updatedTransaction = updated;
        const { formatDate } = await import('../../utils/dateHelpers');
        results.push(`✅ Date updated to ${formatDate(finalDate, 'dd MMM yyyy')}`);
        
        // Emit analytics event
        if (userId) {
          analyticsBus.emit(AnalyticsEventType.TRANSACTION_UPDATED, {
            userId,
            transactionId: step.transactionId,
            changes: { date: finalDate.toISOString() },
            chatId,
            chatType,
          });
        }
      } else if (step.action === 'UPDATE_TIME' && step.transactionId && step.data?.time) {
        // Fetch current transaction to preserve date components
        const currentTx = await prisma.transaction.findUnique({
          where: { id: step.transactionId },
        });
        if (!currentTx) {
          throw new Error('Transaction not found');
        }
        
        const timeStr = step.data.time; // Expected format: HH:MM (24-hour, e.g., "14:30", "21:00")
        
        // Validate and parse time string (HH:MM format)
        const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
        if (!timeMatch) {
          throw new Error(`Invalid time format: ${timeStr}. Expected HH:MM (24-hour format)`);
        }
        
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
          throw new Error(`Invalid time values: ${timeStr}. Hours must be 0-23, minutes must be 0-59`);
        }
        
        // Get existing date in Singapore timezone
        const existingDate = currentTx.date;
        const year = existingDate.getFullYear();
        const month = String(existingDate.getMonth() + 1).padStart(2, '0');
        const day = String(existingDate.getDate()).padStart(2, '0');
        const hoursStr = String(hours).padStart(2, '0');
        const minutesStr = String(minutes).padStart(2, '0');
        
        // Construct date string in Singapore timezone (GMT+8)
        // Format: YYYY-MM-DDTHH:mm:00+08:00
        const singaporeDateStr = `${year}-${month}-${day}T${hoursStr}:${minutesStr}:00+08:00`;
        
        // Parse the date string - JavaScript will convert to UTC automatically
        const newDate = new Date(singaporeDateStr);
        if (isNaN(newDate.getTime())) {
          throw new Error(`Failed to parse date with timezone: ${singaporeDateStr}`);
        }
        
        const updated = await prisma.transaction.update({
          where: { id: step.transactionId },
          data: { date: newDate },
          include: {
            payer: true,
          },
        });
        updatedTransaction = updated;
        const { formatDate } = await import('../../utils/dateHelpers');
        results.push(`✅ Time updated to ${timeStr}`);
        
        // Emit analytics event
        if (userId) {
          analyticsBus.emit(AnalyticsEventType.TRANSACTION_UPDATED, {
            userId,
            transactionId: step.transactionId,
            changes: { date: newDate.toISOString() },
            chatId,
            chatType,
          });
        }
      } else if (step.action === 'UPDATE_DESCRIPTION' && step.transactionId && step.data?.description) {
        const updated = await prisma.transaction.update({
          where: { id: step.transactionId },
          data: { description: step.data.description },
          include: {
            payer: true,
          },
        });
        updatedTransaction = updated;
        results.push(`✅ Description updated to "${updated.description}"`);
        
        // Emit analytics event
        if (userId) {
          analyticsBus.emit(AnalyticsEventType.TRANSACTION_UPDATED, {
            userId,
            transactionId: step.transactionId,
            changes: { description: step.data.description },
            chatId,
            chatType,
          });
        }
      }
    } catch (dbError: any) {
      console.error('Database error during action execution:', dbError);
      results.push(`❌ Failed to execute action: ${dbError.message}`);
    }
  }
  
  return { results, updatedTransaction };
}

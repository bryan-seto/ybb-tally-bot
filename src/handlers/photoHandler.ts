import { Context } from 'telegraf';
import { AIService } from '../services/ai';
import { prisma } from '../lib/prisma';
import { CONFIG } from '../config';
import { getNow } from '../utils/dateHelpers';
import { ExpenseService } from '../services/expenseService';

interface PendingPhoto {
  fileId: string;
  filePath: string;
}

interface PhotoCollection {
  photos: PendingPhoto[];
  timer: NodeJS.Timeout | null;
  statusMessageId?: number;
  isCreatingStatus?: boolean;
  userId: bigint;
}

export class PhotoHandler {
  private photoCollections: Map<number, PhotoCollection> = new Map();

  constructor(
    private aiService: AIService,
    private expenseService: ExpenseService
  ) {}

  async handlePhoto(ctx: any) {
    try {
      const chatId = ctx.chat.id;
      const userId = BigInt(ctx.from.id);

      let collection = this.photoCollections.get(chatId);
      if (!collection) {
        collection = { photos: [], timer: null, userId };
        this.photoCollections.set(chatId, collection);
      }

      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.telegram.getFile(photo.file_id);
      
      if (!file.file_path) {
        await ctx.reply('Error: Could not get file path from Telegram.');
        return;
      }

      collection.photos.push({ fileId: photo.file_id, filePath: file.file_path });

      if (collection.timer) clearTimeout(collection.timer);

      const count = collection.photos.length;
      const statusText = `📥 Collecting receipts... (${count} photo${count > 1 ? 's' : ''} received)`;
      
      if (collection.statusMessageId) {
        try {
          await ctx.telegram.editMessageText(chatId, collection.statusMessageId, undefined, statusText);
        } catch {
          // Message might have been deleted or edited too quickly
        }
      } else if (!collection.isCreatingStatus) {
        collection.isCreatingStatus = true;
        try {
          const statusMsg = await ctx.reply(statusText);
          collection.statusMessageId = statusMsg.message_id;
        } catch (err) {
          console.error('Error creating status message:', err);
        } finally {
          collection.isCreatingStatus = false;
        }
      }

      collection.timer = setTimeout(async () => {
        await this.processPhotoBatch(ctx, chatId, collection!);
      }, 10000);

    } catch (error) {
      console.error('Error handling photo:', error);
      throw error;
    }
  }

  private async processPhotoBatch(ctx: any, chatId: number, collection: PhotoCollection) {
    try {
      this.photoCollections.delete(chatId);
      if (collection.statusMessageId) {
        try { await ctx.telegram.deleteMessage(chatId, collection.statusMessageId); } catch {}
      }

      if (collection.photos.length === 0) return;

      const imageBuffers: Buffer[] = [];
      for (const photo of collection.photos) {
        const fileUrl = `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_TOKEN}/${photo.filePath}`;
        const response = await fetch(fileUrl);
        if (response.ok) {
          imageBuffers.push(Buffer.from(await response.arrayBuffer()));
        }
      }
      
      if (imageBuffers.length === 0) {
        await ctx.telegram.sendMessage(chatId, 'Error downloading images.');
        return;
      }

      const processingMsg = await ctx.telegram.sendMessage(chatId, '🧠 AI is analyzing your receipt(s)...');
      
      // Set up fallback callback for real-time status updates
      let fallbackMsgId: number | null = null;
      
      const onFallback = async (failed: string, next: string) => {
        // If we haven't sent a status message yet, send one
        if (!fallbackMsgId) {
          const msg = await ctx.telegram.sendMessage(chatId, `⚠️ Limit hit for ${failed}. Switching to ${next}...`);
          fallbackMsgId = msg.message_id;
        } else {
          // Optional: Edit existing message if multiple switches happen
          try {
            await ctx.telegram.editMessageText(
              chatId,
              fallbackMsgId,
              undefined,
              `⚠️ Limit hit for ${failed}. Switching to ${next}...`
            );
          } catch (e) {
            // Ignore edit errors
          }
        }
      };
      
      let receiptData;
      try {
        receiptData = await this.aiService.processReceipt(imageBuffers, collection.userId, 'image/jpeg', onFallback);
      } catch (error: any) {
        // Cleanup fallback warning on error
        if (fallbackMsgId) {
          try { await ctx.telegram.deleteMessage(chatId, fallbackMsgId); } catch {}
        }
        // Re-throw so the global error handler in bot.ts handles Sentry, Founder alert, and user apology
        throw error;
      } finally {
        try { await ctx.telegram.deleteMessage(chatId, processingMsg.message_id); } catch {}
      }

      // Cleanup fallback warning before sending final result
      if (fallbackMsgId) {
        try {
          await ctx.telegram.deleteMessage(chatId, fallbackMsgId);
        } catch (e) {
          // Ignore delete errors (msg might be too old or already deleted)
        }
      }

      if (!receiptData.isValid || (!receiptData.transactions?.length && !receiptData.total)) {
        await ctx.telegram.sendMessage(chatId, '❌ Could not find valid expense data in these images.');
        return;
      }

      // Automatically record the transactions
      const { savedTransactions, balanceMessage } = await this.expenseService.recordAISavedTransactions(
        receiptData,
        collection.userId
      );

      // Build the minimalist summary
      let summary = `✅ **Recorded ${savedTransactions.length} expense${savedTransactions.length > 1 ? 's' : ''}:**\n`;
      
      savedTransactions.forEach(tx => {
        summary += `• **${tx.description}**: SGD $${tx.amountSGD.toFixed(2)} (${tx.category})\n`;
      });

      summary += `\n${balanceMessage}`;

      await ctx.telegram.sendMessage(chatId, summary, { parse_mode: 'Markdown' });

    } catch (error: any) {
      console.error('Error processing batch:', error);
      // Re-throw so global catch in bot.ts handles notification & apology
      throw error;
    }
  }
}


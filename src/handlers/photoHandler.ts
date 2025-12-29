import { Context } from 'telegraf';
import { AIService } from '../services/ai';
import { prisma } from '../lib/prisma';
import { CONFIG } from '../config';
import { getNow } from '../utils/dateHelpers';

interface PendingPhoto {
  fileId: string;
  filePath: string;
}

interface PhotoCollection {
  photos: PendingPhoto[];
  timer: NodeJS.Timeout | null;
  statusMessageId?: number;
  userId: bigint;
}

export class PhotoHandler {
  private photoCollections: Map<number, PhotoCollection> = new Map();

  constructor(private aiService: AIService) {}

  async handlePhoto(ctx: any) {
    try {
      const chatId = ctx.chat.id;
      const userId = BigInt(ctx.from.id);
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.telegram.getFile(photo.file_id);
      
      if (!file.file_path) {
        await ctx.reply('Error: Could not get file path from Telegram.');
        return;
      }
      
      let collection = this.photoCollections.get(chatId);
      if (!collection) {
        collection = { photos: [], timer: null, userId };
        this.photoCollections.set(chatId, collection);
      }

      collection.photos.push({ fileId: photo.file_id, filePath: file.file_path });

      if (collection.timer) clearTimeout(collection.timer);

      const count = collection.photos.length;
      const statusText = `📥 Collecting receipts... (${count} photo${count > 1 ? 's' : ''} received)`;
      
      if (collection.statusMessageId) {
        try {
          await ctx.telegram.editMessageText(chatId, collection.statusMessageId, undefined, statusText);
        } catch {
          const statusMsg = await ctx.reply(statusText);
          collection.statusMessageId = statusMsg.message_id;
        }
      } else {
        const statusMsg = await ctx.reply(statusText);
        collection.statusMessageId = statusMsg.message_id;
      }

      collection.timer = setTimeout(async () => {
        await this.processPhotoBatch(ctx, chatId, collection!);
      }, 10000);

    } catch (error) {
      console.error('Error handling photo:', error);
      await ctx.reply('Error handling photo.');
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
      
      let receiptData;
      try {
        receiptData = await this.aiService.processReceipt(imageBuffers, collection.userId, 'image/jpeg');
      } catch (error: any) {
        await ctx.telegram.sendMessage(chatId, `AI processing error: ${error.message}`);
        return;
      } finally {
        try { await ctx.telegram.deleteMessage(chatId, processingMsg.message_id); } catch {}
      }

      if (!receiptData.isValid || receiptData.total === null || receiptData.total === undefined) {
        await ctx.telegram.sendMessage(chatId, '❌ Could not find valid expense data in these images.');
        return;
      }

      // Store in session for confirmation
      if (!ctx.session) ctx.session = {};
      if (!ctx.session.pendingReceipts) ctx.session.pendingReceipts = {};
      
      const receiptId = Date.now().toString();
      ctx.session.pendingReceipts[receiptId] = {
        amount: receiptData.total,
        currency: receiptData.currency || 'SGD',
        merchant: receiptData.merchant || 'Unknown Merchant',
        category: receiptData.category || 'Other',
        date: receiptData.date || getNow().toISOString(),
      };

      const amountStr = receiptData.currency === 'SGD' || !receiptData.currency 
        ? `SGD $${receiptData.total.toFixed(2)}` 
        : `${receiptData.currency} ${receiptData.total.toFixed(2)}`;
      
      const message = `💰 **Total:** ${amountStr}\n` +
                      `🏪 **Merchant:** ${receiptData.merchant || 'Unknown'}\n` +
                      `📂 **Category:** ${receiptData.category || 'Other'}\n\n` +
                      `Is this correct?`;

      await ctx.telegram.sendMessage(
        chatId,
        message,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '✅ Confirm', callback_data: `confirm_receipt_${receiptId}` }]],
          },
        }
      );
    } catch (error) {
      console.error('Error processing batch:', error);
      await ctx.telegram.sendMessage(chatId, 'Error processing receipt batch.');
    }
  }
}


import { Context } from 'telegraf';
import { AIService } from '../services/ai';
import { prisma } from '../lib/prisma';
import { CONFIG } from '../config';

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

      const processingMsg = await ctx.telegram.sendMessage(chatId, 'Processing receipt(s)...');
      
      let receiptData;
      try {
        receiptData = await this.aiService.processReceipt(imageBuffers, collection.userId, 'image/jpeg');
      } catch (error: any) {
        await ctx.telegram.sendMessage(chatId, `AI processing error: ${error.message}`);
        return;
      } finally {
        try { await ctx.telegram.deleteMessage(chatId, processingMsg.message_id); } catch {}
      }

      if (!receiptData.isValid || !receiptData.total) {
        await ctx.telegram.sendMessage(chatId, 'Invalid receipt or total not found.');
        return;
      }

      // Store in pending (this logic might need to stay in Bot or a Shared State)
      // For now, let's just send the confirmation message
      const amountStr = receiptData.currency === 'SGD' ? `SGD $${receiptData.total.toFixed(2)}` : `${receiptData.currency} ${receiptData.total.toFixed(2)}`;
      
      await ctx.telegram.sendMessage(
        chatId,
        `Total: ${amountStr}\nMerchant: ${receiptData.merchant || 'Multiple'}\nCategory: ${receiptData.category || 'Other'}\nIs this correct?`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: 'Yes', callback_data: `confirm_amount_receipt_${chatId}_${Date.now()}` }]],
          },
        }
      );
    } catch (error) {
      console.error('Error processing batch:', error);
    }
  }
}


import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ReceiptData {
  isValid: boolean;
  total?: number;
  currency?: string;
  merchant?: string;
  date?: string;
  category?: string;
  transactionCount?: number;
  individualAmounts?: number[]; // Array of individual transaction amounts in SGD
}

export class AIService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }

  /**
   * Process receipt image and extract data
   * Logs latency to SystemLog
   */
  async processReceipt(
    imageBuffer: Buffer,
    userId: bigint,
    mimeType: string = 'image/jpeg'
  ): Promise<ReceiptData> {
    const startTime = Date.now();

    try {
      const prompt = `Analyze this image. It could be:
1. A traditional receipt/invoice
2. A YouTrip transaction history screenshot
3. A banking app transaction list
4. Any other expense-related image

Extract the following information in JSON format:
{
  "isValid": true/false (true if this contains any expense/transaction data),
  "total": number (the total amount in SGD - if multiple transactions, sum all SGD amounts excluding credits/top-ups/refunds),
  "currency": string (e.g., "SGD", "USD", "THB" - use SGD if amounts are converted),
  "merchant": string (merchant/store name, or "Multiple Transactions" if multiple merchants, null if not found),
  "date": string (date in YYYY-MM-DD format - use the most recent transaction date, null if not found),
  "category": string (category like "Food", "Transport", "Shopping", "Bills", "Travel", "Other", null if not found),
  "transactionCount": number (number of individual transactions if this is a transaction list, 1 for single receipt),
  "individualAmounts": array of numbers (list of each individual transaction amount in SGD, in the order they appear. For single receipt, use [total])
}

IMPORTANT FOR YOUTRIP/BANKING SCREENSHOTS:
- Look for all expense transactions (exclude "Top Up", "Refund", or any positive/credit amounts)
- Extract the SGD converted amounts (shown as "$X.XX SGD" or similar)
- For each expense transaction, extract its SGD amount and add it to the "individualAmounts" array
- Sum ALL expense transactions to get the total
- If you see multiple transactions, set transactionCount to the number of expense transactions
- Set merchant to "Multiple Transactions" if there are multiple merchants
- The individualAmounts array should contain all the SGD amounts that were summed to get the total

Return ONLY valid JSON, no additional text.`;

      const imagePart = {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType,
        },
      };

      const result = await this.model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();

      // Parse JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const receiptData: ReceiptData = JSON.parse(jsonMatch[0]);

      const latencyMs = Date.now() - startTime;

      // Log to SystemLog
      await prisma.systemLog.create({
        data: {
          userId,
          event: 'receipt_processed',
          metadata: {
            latencyMs,
            isValid: receiptData.isValid,
            success: true,
          },
        },
      });

      return receiptData;
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;

      // Log error to SystemLog
      await prisma.systemLog.create({
        data: {
          userId,
          event: 'receipt_processed',
          metadata: {
            latencyMs,
            success: false,
            errorMsg: error.message || 'Unknown error',
          },
        },
      });

      throw error;
    }
  }
}






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
  merchants?: string[]; // Array of merchant names when multiple receipts
}

export class AIService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }

  /**
   * Process receipt image(s) and extract data
   * Logs latency to SystemLog
   * @param imageBuffers - Single buffer or array of buffers for multiple receipts
   */
  async processReceipt(
    imageBuffers: Buffer | Buffer[],
    userId: bigint,
    mimeType: string = 'image/jpeg'
  ): Promise<ReceiptData> {
    const startTime = Date.now();
    const buffers = Array.isArray(imageBuffers) ? imageBuffers : [imageBuffers];
    const isMultiple = buffers.length > 1;

    try {
      const prompt = isMultiple
        ? `I have provided ${buffers.length} images of receipts. Please analyze them together.

IMPORTANT:
- If they are multiple parts of one long receipt (e.g., top and bottom of same receipt), combine them and provide a SINGLE total.
- If they are different receipts, sum all the totals and list all the merchants.

Extract the following information in JSON format:
{
  "isValid": true/false (true if any image contains expense/transaction data),
  "total": number (the total amount in SGD - sum of all receipts if multiple, or single total if one receipt),
  "currency": string (e.g., "SGD", "USD", "THB" - use SGD if amounts are converted),
  "merchant": string (merchant/store name, or "Multiple Receipts" if different merchants, null if not found),
  "merchants": array of strings (list of all merchant names found across all receipts, empty array if not found),
  "date": string (date in YYYY-MM-DD format - use the most recent transaction date, null if not found),
  "category": string (category like "Food", "Transport", "Shopping", "Bills", "Travel", "Other", null if not found),
  "transactionCount": number (total number of individual transactions across all receipts),
  "individualAmounts": array of numbers (list of each receipt's total amount in SGD, in the order they appear)
}

Return ONLY valid JSON, no additional text.`
        : `Analyze this image. It could be:
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
  "merchants": array of strings (list of merchant names, empty array if single merchant or not found),
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

      // Prepare image parts
      const imageParts = buffers.map(buffer => ({
        inlineData: {
          data: buffer.toString('base64'),
          mimeType,
        },
      }));

      const result = await this.model.generateContent([prompt, ...imageParts]);
      const response = await result.response;
      const text = response.text();

      // Parse JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const receiptData: ReceiptData = JSON.parse(jsonMatch[0]);
      
      // Ensure merchants array exists
      if (!receiptData.merchants) {
        receiptData.merchants = receiptData.merchant ? [receiptData.merchant] : [];
      }

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






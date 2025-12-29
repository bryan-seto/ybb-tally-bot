import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import * as Sentry from "@sentry/node";

const ReceiptDataSchema = z.object({
  isValid: z.boolean(),
  transactions: z.array(z.object({
    amount: z.number(),
    merchant: z.string(),
    category: z.string(),
    date: z.string().nullable().optional(), // YYYY-MM-DD
  })).optional(),
  total: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  merchant: z.string().nullable().optional(),
  merchants: z.array(z.string()).nullable().optional(),
  date: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  categories: z.array(z.string()).nullable().optional(),
  transactionCount: z.number().nullable().optional(),
  individualAmounts: z.array(z.number()).nullable().optional(),
});

export type ReceiptData = z.infer<typeof ReceiptDataSchema>;

export class AIService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }, { apiVersion: 'v1' });
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
      const prompt = `Analyze the provided image(s) of receipts, invoices, or transaction screenshots. 
If there are multiple receipts or multiple transactions on one page, extract EACH one separately.

IMPORTANT:
- If multiple images are provided, check if they are parts of the same long receipt. If so, combine them into one transaction.
- If they are different receipts, provide individual details for each in the "transactions" array.
- For each transaction, extract:
  - amount: The total amount in SGD (numbers only).
  - merchant: The store or service provider name.
  - category: One of "Food", "Transport", "Shopping", "Bills", "Travel", "Other".
  - date: The date in YYYY-MM-DD format (if found).

Extract the following information in JSON format:
{
  "isValid": true/false (true if any image contains expense/transaction data),
  "transactions": [
    {
      "amount": number,
      "merchant": "string",
      "category": "string",
      "date": "string"
    }
  ],
  "total": number (sum of all amounts in SGD),
  "merchant": "string" (Main merchant or "Multiple Merchants"),
  "category": "string" (Main category or "Multiple Categories")
}

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

      const rawData = JSON.parse(jsonMatch[0]);
      const receiptData = ReceiptDataSchema.parse(rawData);
      
      // Ensure merchants array exists
      if (!receiptData.merchants) {
        receiptData.merchants = receiptData.merchant ? [receiptData.merchant] : [];
      }

      // Ensure categories array exists
      if (!receiptData.categories) {
        receiptData.categories = receiptData.category ? [receiptData.category] : [];
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

      // Capture to Sentry
      Sentry.withScope((scope) => {
        scope.setUser({ id: userId.toString() });
        scope.setTag("service", "AIService");
        scope.setContext("performance", { latencyMs });
        Sentry.captureException(error);
      });

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






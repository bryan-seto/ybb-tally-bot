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

export interface CorrectionAction {
  action: 'UPDATE_SPLIT' | 'UPDATE_AMOUNT' | 'UPDATE_CATEGORY' | 'DELETE' | 'UPDATE_PAYER' | 'UPDATE_STATUS' | 'UPDATE_DATE' | 'UPDATE_DESCRIPTION' | 'UNKNOWN';
  transactionId: bigint;
  data?: {
    bryanPercentage?: number;
    hweiYeenPercentage?: number;
    amountSGD?: number;
    category?: string;
    payerKey?: 'BRYAN' | 'HWEI_YEEN';
    isSettled?: boolean;
    date?: string; // ISO format YYYY-MM-DD
    description?: string;
  };
  statusMessage: string;
}

export interface CorrectionResult {
  confidence: 'low' | 'medium' | 'high';
  actions: CorrectionAction[];
}
export class AIService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    
    // Old (Deprecated)
    // this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // Stable (Good)
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Best (Recommended for New Features) but expensive
    // this.model = this.genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
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

  /**
   * Process natural language correction commands (e.g., "split venchi 50-50, and delete last")
   * Returns a structured array of actions for the bot to execute
   */
  async processCorrection(
    text: string,
    recentTransactions: Array<{
      id: bigint;
      description: string;
      amountSGD: number;
      category: string;
      bryanPercentage: number;
      hweiYeenPercentage: number;
      paidBy?: string;
      payerRole?: string;
      status?: 'settled' | 'unsettled';
      date?: string; // ISO format YYYY-MM-DD
    }>
  ): Promise<CorrectionResult> {
    const prompt = `You are a financial assistant bot. A user has sent correction command(s).
The user might request MULTIPLE changes in one message. Identify ALL actions requested.

User's command: "${text}"

Recent transactions (most recent first):
${recentTransactions.map((tx, i) => {
      const parts = [
        `${i + 1}. ID: ${tx.id}`,
        `Description: "${tx.description}"`,
        `Amount: $${tx.amountSGD}`,
        `Category: ${tx.category}`,
        `Split: ${Math.round(tx.bryanPercentage * 100)}-${Math.round(tx.hweiYeenPercentage * 100)}`
      ];
      if (tx.paidBy) parts.push(`Payer: ${tx.paidBy}`);
      if (tx.status) parts.push(`Status: ${tx.status === 'settled' ? 'Settled' : 'Unsettled'}`);
      if (tx.date) parts.push(`Date: ${tx.date}`);
      return parts.join(', ');
    }).join('\n')}

Analyze the user's intent and respond in JSON format:
{
  "actions": [
    {
      "action": "UPDATE_SPLIT" | "UPDATE_AMOUNT" | "UPDATE_CATEGORY" | "DELETE" | "UPDATE_PAYER" | "UPDATE_STATUS" | "UPDATE_DATE" | "UPDATE_DESCRIPTION" | "UNKNOWN",
      "transactionId": number (best matching transaction ID),
      "data": {
        "bryanPercentage": number (0.0-1.0, only for UPDATE_SPLIT),
        "hweiYeenPercentage": number (0.0-1.0, only for UPDATE_SPLIT),
        "amountSGD": number (only for UPDATE_AMOUNT),
        "category": string (only for UPDATE_CATEGORY),
        "payerKey": "BRYAN" | "HWEI_YEEN" (only for UPDATE_PAYER),
        "isSettled": boolean (only for UPDATE_STATUS, true for settled, false for unsettled),
        "date": string (only for UPDATE_DATE, format: YYYY-MM-DD),
        "description": string (only for UPDATE_DESCRIPTION)
      },
      "statusMessage": "string (A friendly message in present continuous tense, e.g., 'Updating split for Venchi to 50-50...')"
    }
  ],
  "confidence": "high" | "medium" | "low"
}

Examples:
- "split venchi 50-50" → One action: UPDATE_SPLIT, statusMessage: "Updating split for Venchi to 50-50..."
- "delete last two" → Two DELETE actions for the two most recent transactions
- "make the $20 one food and delete the coffee" → Two actions: UPDATE_CATEGORY for the $20 transaction, and DELETE for "coffee"
- "change amount to $15" → One action: UPDATE_AMOUNT for most recent, statusMessage: "Updating amount to $15.00..."
- "paid by Hwei Yeen" or "change payer to HY" → One action: UPDATE_PAYER, payerKey: "HWEI_YEEN", statusMessage: "Updating payer to Hwei Yeen..."
- "paid by Bryan" → One action: UPDATE_PAYER, payerKey: "BRYAN", statusMessage: "Updating payer to Bryan..."
- "settle this" or "mark as settled" → One action: UPDATE_STATUS, isSettled: true, statusMessage: "Marking transaction as settled..."
- "unsettle" or "mark as unsettled" → One action: UPDATE_STATUS, isSettled: false, statusMessage: "Marking transaction as unsettled..."
- "change date to Dec 30" or "date: 2025-12-30" → One action: UPDATE_DATE, date: "2025-12-30", statusMessage: "Updating date to 2025-12-30..."
- "change description to Taxi to Airport" → One action: UPDATE_DESCRIPTION, description: "Taxi to Airport", statusMessage: "Updating description to Taxi to Airport..."

IMPORTANT:
- For each action, create a user-friendly statusMessage in present continuous tense
- If user says "last two" or "last 3", create that many DELETE actions
- Match transactions by description keywords, amounts, or position (last, first, etc.)

PAYER MAPPING (canonical):
- If user says "paid by HY", "Hwei Yeen", "HweiYeen", "Hwei", etc. → return payerKey: "HWEI_YEEN"
- If user says "Bryan", "paid by Bryan", etc. → return payerKey: "BRYAN"

STATUS MAPPING:
- "settle", "mark as settled", "mark settled" → isSettled: true
- "unsettle", "mark as unsettled", "mark unsettled" → isSettled: false

DATE PARSING:
- Parse natural language dates: "yesterday", "last friday", "Dec 30", "2025-12-30", "today", etc.
- Always output in YYYY-MM-DD format (e.g., "2025-12-30")
- If relative date like "yesterday", calculate the actual date

Return ONLY valid JSON, no additional text.`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const responseText = response.text();

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { 
          confidence: 'low',
          actions: [{ 
            action: 'UNKNOWN',
            transactionId: BigInt(0),
            statusMessage: 'Processing your request...' 
          }]
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Transform to match CorrectionResult interface
      // Ensure transactionIds are bigints and required (not optional)
      const transformedActions: CorrectionAction[] = [];
      if (parsed.actions && Array.isArray(parsed.actions)) {
        for (const a of parsed.actions) {
          // Ensure transactionId exists and is a bigint
          if (!a.transactionId) {
            // If no transactionId provided, skip this action or use 0 as fallback
            continue;
          }
          
          transformedActions.push({
            action: a.action || 'UNKNOWN',
            transactionId: BigInt(a.transactionId), // Required, convert to BigInt
            data: a.data || undefined,
            statusMessage: a.statusMessage || 'Processing...'
          });
        }
      }

      // Ensure confidence matches the interface
      const confidence: 'low' | 'medium' | 'high' = 
        parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
          ? parsed.confidence
          : 'low';

      return {
        confidence,
        actions: transformedActions.length > 0 ? transformedActions : [{
          action: 'UNKNOWN',
          transactionId: BigInt(0),
          statusMessage: 'Processing your request...'
        }]
      };
    } catch (error: any) {
      console.error('Error processing correction:', error);
      Sentry.captureException(error);
      return { 
        confidence: 'low',
        actions: [{ 
          action: 'UNKNOWN',
          transactionId: BigInt(0),
          statusMessage: 'Processing your request...' 
        }]
      };
    }
  }
}






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

// Callback type for real-time fallback notifications
export type FallbackCallback = (failedModel: string, nextModel: string) => void | Promise<void>;

export interface AIResponse {
  text: string;           // The actual AI answer
  usedModel: string;      // The model that successfully answered
}

export interface CorrectionAction {
  action: 'UPDATE_SPLIT' | 'UPDATE_AMOUNT' | 'UPDATE_CATEGORY' | 'DELETE' | 'UPDATE_PAYER' | 'UPDATE_STATUS' | 'UPDATE_DATE' | 'UPDATE_TIME' | 'UPDATE_DESCRIPTION' | 'UNKNOWN';
  transactionId: bigint;
  data?: {
    bryanPercentage?: number;
    hweiYeenPercentage?: number;
    amountSGD?: number;
    category?: string;
    payerKey?: 'BRYAN' | 'HWEI_YEEN';
    isSettled?: boolean;
    date?: string; // ISO format YYYY-MM-DD
    time?: string; // 24-hour format HH:MM (e.g., "14:30", "21:00")
    description?: string;
  };
  statusMessage: string;
}

export interface CorrectionResult {
  confidence: 'low' | 'medium' | 'high';
  actions: CorrectionAction[];
}
// Model priority list for waterfall fallback
const MODEL_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite'
] as const;

export class AIService {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Models are created on-demand in generateContentWithFallback
  }

  /**
   * Extract JSON from AI response text
   * Handles markdown code blocks and simple substring extraction
   */
  private extractJSON(text: string): string | null {
    // First, try to extract from markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1];
    }
    
    // Simple approach: find first { and last }
    // This avoids issues with braces inside string literals
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    
    return text.substring(firstBrace, lastBrace + 1);
  }

  /**
   * Check if an error is retryable (429 rate limit or 503 overload)
   */
  private isRetryableError(error: any): boolean {
    const msg = (error.message?.toLowerCase() || '');
    const status = error.status || error.code || error.response?.status;
    
    return (
      status === 429 ||
      status === 503 ||
      msg.includes('429') ||
      msg.includes('503') ||
      msg.includes('quota') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests') ||
      msg.includes('overloaded') ||
      msg.includes('resource exhausted')
    );
  }

  /**
   * Generate content with waterfall fallback across multiple models
   */
  private async generateContentWithFallback(
    prompt: string | Array<string | { inlineData: { data: string; mimeType: string } }>,
    onFallback?: FallbackCallback
  ): Promise<AIResponse> {
    for (let i = 0; i < MODEL_PRIORITY.length; i++) {
      const modelName = MODEL_PRIORITY[i];
      try {
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Success - return with model info
        return {
          text,
          usedModel: modelName
        };
      } catch (error: any) {
        const isRetryable = this.isRetryableError(error);
        
        if (!isRetryable) {
          // Non-retryable error - throw immediately
          throw error;
        }
        
        // Retryable error - notify via callback BEFORE trying next model
        if (i < MODEL_PRIORITY.length - 1) {
          const nextModel = MODEL_PRIORITY[i + 1];
          if (onFallback) {
            await onFallback(modelName, nextModel); // Real-time notification
          }
          console.log(`Model ${modelName} failed with retryable error, switching to ${nextModel}...`);
          continue;
        } else {
          // All models exhausted
          throw new Error(`All models exhausted. Last error: ${error.message}`);
        }
      }
    }
    
    throw new Error('No models available');
  }

  /**
   * Process receipt image(s) and extract data
   * Logs latency to SystemLog
   * @param imageBuffers - Single buffer or array of buffers for multiple receipts
   */
  async processReceipt(
    imageBuffers: Buffer | Buffer[],
    userId: bigint,
    mimeType: string = 'image/jpeg',
    onFallback?: FallbackCallback
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

Return ONLY valid JSON, with no markdown formatting (no \`\`\`json code blocks), no conversational text, no explanations. The response must be pure, parseable JSON starting with { and ending with }.`;

      // Prepare image parts
      const imageParts = buffers.map(buffer => ({
        inlineData: {
          data: buffer.toString('base64'),
          mimeType,
        },
      }));

      const aiResponse = await this.generateContentWithFallback([prompt, ...imageParts], onFallback);
      const text = aiResponse.text;
      const usedModel = aiResponse.usedModel;

      // Extract and parse JSON response
      const extractedJSON = this.extractJSON(text);
      if (!extractedJSON) {
        console.error('[processReceipt] No JSON found in response:', text.substring(0, 500));
        throw new Error('No JSON found in response');
      }

      let rawData;
      try {
        rawData = JSON.parse(extractedJSON);
      } catch (parseError: any) {
        console.error('[processReceipt] JSON parse error:', {
          error: parseError.message,
          position: parseError.message.match(/position (\d+)/)?.[1],
          extractedJSON: extractedJSON.substring(0, 200),
          fullResponse: text.substring(0, 500)
        });
        Sentry.captureException(parseError, {
          extra: {
            extractedJSON: extractedJSON.substring(0, 500),
            fullResponse: text.substring(0, 1000)
          }
        });
        throw new Error(`Failed to parse JSON response: ${parseError.message}`);
      }
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

      // Log to SystemLog (include model info)
      await prisma.systemLog.create({
        data: {
          userId,
          event: 'receipt_processed',
          metadata: {
            latencyMs,
            isValid: receiptData.isValid,
            success: true,
            usedModel,
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
    }>,
    onFallback?: FallbackCallback
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
      "action": "UPDATE_SPLIT" | "UPDATE_AMOUNT" | "UPDATE_CATEGORY" | "DELETE" | "UPDATE_PAYER" | "UPDATE_STATUS" | "UPDATE_DATE" | "UPDATE_TIME" | "UPDATE_DESCRIPTION" | "UNKNOWN",
      "transactionId": number (best matching transaction ID),
      "data": {
        "bryanPercentage": number (0.0-1.0, only for UPDATE_SPLIT),
        "hweiYeenPercentage": number (0.0-1.0, only for UPDATE_SPLIT),
        "amountSGD": number (only for UPDATE_AMOUNT),
        "category": string (only for UPDATE_CATEGORY),
        "payerKey": "BRYAN" | "HWEI_YEEN" (only for UPDATE_PAYER),
        "isSettled": boolean (only for UPDATE_STATUS, true for settled, false for unsettled),
        "date": string (only for UPDATE_DATE, format: YYYY-MM-DD),
        "time": string (only for UPDATE_TIME, format: HH:MM in 24-hour format, e.g., "14:30", "21:00", "09:15" - NO AM/PM),
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
- "change time to 2:30 PM" or "time: 14:30" → One action: UPDATE_TIME, time: "14:30", statusMessage: "Updating time to 14:30..."
- "change description to Taxi to Airport" → One action: UPDATE_DESCRIPTION, description: "Taxi to Airport", statusMessage: "Updating description to Taxi to Airport..."
- "edit merchant to VENCHI and amount to $14" → Two actions: UPDATE_DESCRIPTION with description: "VENCHI", and UPDATE_AMOUNT with amountSGD: 14
- "change date to Dec 30 and category to Food" → Two actions: UPDATE_DATE and UPDATE_CATEGORY

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

TIME PARSING (STRICT 24-HOUR FORMAT):
- Parse time inputs and convert to 24-hour format (HH:MM)
- Examples: "2:30 PM" → "14:30", "9:15 AM" → "09:15", "21:00" → "21:00", "midnight" → "00:00", "noon" → "12:00"
- **CRITICAL: Always return time in 24-hour format HH:MM (e.g., "14:30", "09:15", "21:00")**
- **DO NOT return AM/PM format - only 24-hour format is allowed**
- Use leading zeros for hours < 10 (e.g., "09:15" not "9:15")

Return ONLY valid JSON, with no markdown formatting (no \`\`\`json code blocks), no conversational text, no explanations. The response must be pure, parseable JSON starting with { and ending with }.`;

    try {
      const aiResponse = await this.generateContentWithFallback(prompt, onFallback);
      const responseText = aiResponse.text;

      // Extract JSON from response
      const extractedJSON = this.extractJSON(responseText);
      if (!extractedJSON) {
        console.error('[processCorrection] No JSON found in response:', responseText.substring(0, 500));
        return { 
          confidence: 'low',
          actions: [{ 
            action: 'UNKNOWN',
            transactionId: BigInt(0),
            statusMessage: 'Processing your request...' 
          }]
        };
      }

      let parsed;
      try {
        parsed = JSON.parse(extractedJSON);
      } catch (parseError: any) {
        console.error('[processCorrection] JSON parse error:', {
          error: parseError.message,
          position: parseError.message.match(/position (\d+)/)?.[1],
          extractedJSON: extractedJSON.substring(0, 200),
          fullResponse: responseText.substring(0, 500)
        });
        Sentry.captureException(parseError, {
          extra: {
            extractedJSON: extractedJSON.substring(0, 500),
            fullResponse: responseText.substring(0, 1000)
          }
        });
        return { 
          confidence: 'low',
          actions: [{ 
            action: 'UNKNOWN',
            transactionId: BigInt(0),
            statusMessage: 'Processing your request...' 
          }]
        };
      }
      
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
      
      // Note: Rate limit errors are now handled by fallback mechanism
      // Only log non-retryable errors here
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






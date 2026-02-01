import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import * as Sentry from "@sentry/node";
import { getUserAName, getUserBName } from '../config';

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
// Priority order: Groq flash → Gemini flash → Groq thinking → Gemini thinking
// Model names: Groq models use format "groq:model-name", Gemini models use just the identifier
const MODEL_PRIORITY = [
  // Groq Flash Models (First priority - fastest, high volume)
  'groq:llama-3.1-8b-instant',
  'groq:llama-3.1-70b-versatile',
  'groq:mixtral-8x7b-32768',
  'groq:gemma-7b-it',
  // Gemini Flash Models (Second priority - reliable, good quality)
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-3.0-flash',
  // Groq Thinking Models (Third priority - better quality, slower)
  'groq:llama-3.3-70b-versatile',
  'groq:llama-4-scout-instruct',
  // Gemini Thinking Models (Last priority - highest quality, slowest)
  'gemini-3.0-pro-preview',
  'gemini-3.0-flash-thinking-exp'
] as const;

// Vision-capable models only (Gemini models support vision, Groq models do not)
const VISION_MODEL_PRIORITY = [
  // Gemini Flash Models (First priority - fastest vision models)
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-3.0-flash',
  // Gemini Thinking Models (Last priority - highest quality, slowest)
  'gemini-3.0-pro-preview',
  'gemini-3.0-flash-thinking-exp'
] as const;

export class AIService {
  private genAI: GoogleGenerativeAI;
  private groqClient: Groq | null;

  constructor(geminiApiKey: string, groqApiKey?: string) {
    this.genAI = new GoogleGenerativeAI(geminiApiKey);
    this.groqClient = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;
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
   * Check if an error is retryable (should try next model)
   * Returns true for rate limits, quota issues, model availability issues, and other transient errors
   * Note: 404 (model not found) is treated as retryable to try next model
   */
  private isRetryableError(error: any): boolean {
    const msg = (error.message?.toLowerCase() || '');
    const status = error.status || error.code || error.response?.status;
    
    // Retryable HTTP status codes (including 404 for model not found)
    if (status === 429 || status === 503 || status === 502 || status === 504 || status === 404) {
      return true;
    }
    
    // Retryable error messages
    const retryablePatterns = [
      '429',
      '503',
      '502',
      '504',
      '404',
      'not found',
      'quota',
      'rate limit',
      'too many requests',
      'overloaded',
      'resource exhausted',
      'unavailable',
      'not available',
      'service unavailable',
      'model not found',
      'model unavailable',
      'is not found',
      'not supported',
      'limit exceeded',
      'exceeded',
      'timeout',
      'deadline exceeded',
      'connection',
      'network'
    ];
    
    for (const pattern of retryablePatterns) {
      if (msg.includes(pattern)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check if an error is fatal (should NOT try other models, e.g., invalid API key)
   */
  private isFatalError(error: any): boolean {
    const msg = (error.message?.toLowerCase() || '');
    const status = error.status || error.code || error.response?.status;
    
    // Fatal HTTP status codes
    if (status === 401 || status === 403) {
      return true;
    }
    
    // Fatal error messages
    const fatalPatterns = [
      'invalid api key',
      'unauthorized',
      'forbidden',
      'authentication',
      'permission denied',
      'invalid key'
    ];
    
    for (const pattern of fatalPatterns) {
      if (msg.includes(pattern)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Generate content with waterfall fallback across multiple models
   */
  private async generateContentWithFallback(
    prompt: string | Array<string | { inlineData: { data: string; mimeType: string } }>,
    onFallback?: FallbackCallback,
    modelPriority: readonly string[] = MODEL_PRIORITY
  ): Promise<AIResponse> {
    let lastError: any = null;
    let hadQuotaError = false; // Track if ANY model failed with quota error
    
    for (let i = 0; i < modelPriority.length; i++) {
      const modelName = modelPriority[i];
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/ai.ts:224',message:'generateContentWithFallback: Trying model',data:{modelName,modelIndex:i,totalModels:modelPriority.length,provider:modelName.startsWith('groq:')?'groq':'gemini'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
      try {
        let text: string;
        const isGroqModel = modelName.startsWith('groq:');
        
        if (isGroqModel) {
          // Use Groq client
          if (!this.groqClient) {
            // Skip Groq models if API key not provided, try next model
            console.log(`Skipping Groq model ${modelName} - API key not provided`);
            lastError = new Error('Groq API key not provided');
            continue;
          }
          
          const actualModelName = modelName.replace('groq:', '');
          // Groq API only supports text prompts (no images for now)
          const promptText = Array.isArray(prompt) 
            ? prompt.map(p => typeof p === 'string' ? p : '[Image data not supported by Groq]').join('\n')
            : prompt as string;
          
          const completion = await this.groqClient.chat.completions.create({
            model: actualModelName,
            messages: [
              { role: 'user', content: promptText }
            ],
          });
          
          text = completion.choices[0]?.message?.content || '';
        } else {
          // Use Gemini client
          const model = this.genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(prompt);
          const response = await result.response;
          text = response.text();
        }
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/ai.ts:240',message:'generateContentWithFallback: Model succeeded',data:{modelName,responseLength:text.length,provider:isGroqModel?'groq':'gemini'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
        
        // Success - return with model info
        return {
          text,
          usedModel: modelName
        };
      } catch (error: any) {
        lastError = error;
        
        const isFatal = this.isFatalError(error);
        const isRetryable = this.isRetryableError(error);
        
        // Check if this is a quota error (even if not the last error)
        const errorMsg = error.message?.toLowerCase() || '';
        const errorStatus = error.status || error.code || error.response?.status;
        const isQuotaError = errorStatus === 429 || 
                            errorMsg.includes('quota') || 
                            errorMsg.includes('rate limit') ||
                            errorMsg.includes('exceeded') ||
                            errorMsg.includes('free tier') ||
                            errorMsg.includes('limits ran out') ||
                            errorMsg.includes('too many requests');
        
        if (isQuotaError) {
          hadQuotaError = true; // Track that we had quota errors
        }
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1fa2aab8-5b39-462f-acf7-40a78e91602f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'services/ai.ts:292',message:'generateContentWithFallback: Model failed',data:{modelName,modelIndex:i,error:error.message,status:error.status||error.code,isFatal,isRetryable,isQuotaError,hasNextModel:i<modelPriority.length-1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
        
        // Check for fatal errors (e.g., invalid API key) - don't try other models
        if (isFatal) {
          throw error;
        }
        
        // Notify via callback BEFORE trying next model (if available)
        // Don't show fallback messages - they're noisy and quota errors will be shown in final error
        if (i < modelPriority.length - 1) {
          const nextModel = modelPriority[i + 1];
          if (onFallback && !isQuotaError) {
            // Only call fallback for non-quota errors (quota errors will be shown in final message)
            await onFallback(modelName, nextModel);
          }
          if (isRetryable) {
            console.log(`Model ${modelName} failed with retryable error, switching to ${nextModel}...`);
          } else {
            console.log(`Model ${modelName} failed (${error.message}), trying next model ${nextModel}...`);
          }
          continue;
        } else {
          // This was the last model - throw with comprehensive error
          const errorMsg = lastError?.message || 'Unknown error';
          const errorDetails = isRetryable ? 'retryable' : 'non-retryable';
          
          // If ANY model failed with quota error (not just the last one), show quota error message
          if (hadQuotaError) {
            const quotaError = new Error('AI daily free limits ran out. Upgrade to get more limits.');
            quotaError.name = 'QuotaExceededError';
            (quotaError as any).status = 429;
            (quotaError as any).code = 429;
            throw quotaError;
          }
          
          throw new Error(`All ${modelPriority.length} models exhausted (${errorDetails}). Last error from ${modelName}: ${errorMsg}`);
        }
      }
    }
    
    // Should never reach here, but just in case
    throw new Error(`No models available. Last error: ${lastError?.message || 'Unknown error'}`);
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

      // Use only vision-capable models (Gemini) for receipt processing since Groq doesn't support images
      const aiResponse = await this.generateContentWithFallback([prompt, ...imageParts], onFallback, VISION_MODEL_PRIORITY);
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

      // Log to SystemLog (include model info) - only if user exists
      try {
        const userExists = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true },
        });
        
        if (userExists) {
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
        }
      } catch (logError) {
        console.error('Error logging receipt processing:', logError);
      }

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

      // Log error to SystemLog - only if user exists
      try {
        const userExists = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true },
        });
        
        if (userExists) {
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
        }
      } catch (logError) {
        console.error('Error logging receipt processing error:', logError);
      }

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
    const userAName = getUserAName();
    const userBName = getUserBName();
    const userBShortName = userBName.substring(0, 2);
    const userBFirstName = userBName.split(' ')[0];

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
        "bryanPercentage": number (0.0-1.0, only for UPDATE_SPLIT, MUST be decimal: 50% = 0.5, 100% = 1.0, 0% = 0.0),
        "hweiYeenPercentage": number (0.0-1.0, only for UPDATE_SPLIT, MUST be decimal: 50% = 0.5, 100% = 1.0, 0% = 0.0),
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
- "split venchi 50-50" → One action: UPDATE_SPLIT with bryanPercentage: 0.5, hweiYeenPercentage: 0.5, statusMessage: "Updating split for Venchi to 50-50..."
- "split 100-0" or "split 100/0" → One action: UPDATE_SPLIT with bryanPercentage: 1.0, hweiYeenPercentage: 0.0, statusMessage: "Updating split to 100-0..."
- "split 0-100" or "split 0/100" → One action: UPDATE_SPLIT with bryanPercentage: 0.0, hweiYeenPercentage: 1.0, statusMessage: "Updating split to 0-100..."
- "split 70-30" → One action: UPDATE_SPLIT with bryanPercentage: 0.7, hweiYeenPercentage: 0.3, statusMessage: "Updating split to 70-30..."
- "delete last two" → Two DELETE actions for the two most recent transactions
- "make the $20 one food and delete the coffee" → Two actions: UPDATE_CATEGORY for the $20 transaction, and DELETE for "coffee"
- "change amount to $15" → One action: UPDATE_AMOUNT for most recent, statusMessage: "Updating amount to $15.00..."
- "paid by ${userBName}" or "paid by ${userBFirstName}" or "paid by hy" or "paid by Hy" or "change payer to hy" or "change payer to ${userBName}" → One action: UPDATE_PAYER, payerKey: "HWEI_YEEN", statusMessage: "Updating payer to ${userBName}..."
- "paid by ${userAName}" or "paid by Bryan" or "change payer to ${userAName}" → One action: UPDATE_PAYER, payerKey: "BRYAN", statusMessage: "Updating payer to ${userAName}..."
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
- If user mentions a payer name (e.g., "paid by hy", "payer hy", "change payer to hy"), they want to CHANGE the payer to that person, even if the transaction currently shows a different payer. Match the payer name correctly using PAYER MAPPING rules below.

SPLIT PARSING (CRITICAL):
- When user says "split XX-YY" where XX and YY are numbers, parse as percentages that MUST add up to 100
- Convert percentages to decimal (0.0-1.0 range): XX% = XX/100, YY% = YY/100
- Examples: "split 100-0" → bryanPercentage: 1.0, hweiYeenPercentage: 0.0
- Examples: "split 50-50" → bryanPercentage: 0.5, hweiYeenPercentage: 0.5
- Examples: "split 0-100" → bryanPercentage: 0.0, hweiYeenPercentage: 1.0
- Examples: "split 70-30" → bryanPercentage: 0.7, hweiYeenPercentage: 0.3
- CRITICAL: bryanPercentage + hweiYeenPercentage MUST equal 1.0 (100%). If they don't add up to 100, normalize them (e.g., if user says "split 60-40", both must sum to 100; if they say "split 60-30", this is invalid - either reject or normalize proportionally)

PAYER MAPPING (canonical - CRITICAL):
The two users are:
1. User A: ${userAName} (role: Bryan) - payerKey: "BRYAN"
2. User B: ${userBName} (role: HweiYeen) - payerKey: "HWEI_YEEN"

**IMPORTANT: "hy", "Hy", "HY" (case-insensitive) ALWAYS refers to User B (HweiYeen), NOT User A (Bryan).**

For User B (HweiYeen):
- Full name: "${userBName}"
- First name: "${userBFirstName}"
- Short forms/nicknames: "hy", "Hy", "HY", "${userBShortName}", or any substring of "${userBName}"
- Examples that map to HWEI_YEEN: "paid by ${userBName}", "paid by ${userBFirstName}", "paid by hy", "paid by Hy", "paid by HY", "paid by ${userBShortName}", "change payer to hy", "change payer to ${userBName}", "payer hy", etc.
- If the user's input contains "hy" (case-insensitive) or matches any part of "${userBName}", return payerKey: "HWEI_YEEN"

For User A (Bryan):
- Full name: "${userAName}"
- Examples that map to BRYAN: "${userAName}", "paid by ${userAName}", "paid by Bryan", "change payer to ${userAName}", "payer ${userAName}", etc.
- If the user's input contains "${userAName}" or "Bryan", return payerKey: "BRYAN"

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

  /**
   * Process quick expense one-liner (e.g., "130 groceries")
   * Returns: { amount: number, description: string, category: string }
   */
  async processQuickExpense(
    text: string,
    onFallback?: FallbackCallback
  ): Promise<{ amount: number; description: string; category: string }> {
    console.log('[DEBUG] processQuickExpense: Called with text:', text);
    const VALID_CATEGORIES = ['Food', 'Transport', 'Shopping', 'Groceries', 'Bills', 'Entertainment', 'Medical', 'Travel', 'Other'];

    const prompt = `You are a financial assistant. Parse the following expense message and extract the amount, description, and category.

User message: "${text}"

Rules:
1. Extract the amount as a number (in SGD).
2. Extract a description from the text (the item/service name).
3. Category MUST be one of: ${VALID_CATEGORIES.join(', ')}.
4. Special mappings:
   - If user mentions "Utilities" or "utility", map to "Bills"
   - If user mentions "Furniture" or "furniture", map to "Shopping"
   - If user mentions "Games" or "game", map to "Entertainment"
5. If category is unclear, use "Other".

Return ONLY valid JSON in this exact format (no markdown, no explanations):
{
  "amount": number,
  "description": "string",
  "category": "string"
}`;

    try {
      const aiResponse = await this.generateContentWithFallback(prompt, onFallback);
      const responseText = aiResponse.text;

      // Extract JSON from response
      console.log('[DEBUG] processQuickExpense: Extracting JSON from response...');
      const extractedJSON = this.extractJSON(responseText);
      if (!extractedJSON) {
        console.error('[FATAL] processQuickExpense: No JSON found in response:', responseText.substring(0, 500));
        throw new Error('No JSON found in response');
      }
      console.log('[DEBUG] processQuickExpense: Extracted JSON:', extractedJSON);

      let parsed;
      try {
        console.log('[DEBUG] processQuickExpense: Parsing JSON...');
        parsed = JSON.parse(extractedJSON);
        console.log('[DEBUG] processQuickExpense: Parsed result:', parsed);
      } catch (parseError: any) {
        console.error('[FATAL] processQuickExpense: JSON parse error:', {
          error: parseError.message,
          extractedJSON: extractedJSON.substring(0, 200),
          fullResponse: responseText.substring(0, 500)
        });
        Sentry.captureException(parseError, {
          extra: {
            extractedJSON: extractedJSON.substring(0, 500),
            fullResponse: responseText.substring(0, 1000)
          }
        });
        throw new Error(`Failed to parse JSON response: ${parseError.message}`);
      }

      // Validate the parsed data
      console.log('[DEBUG] processQuickExpense: Validating parsed data...');
      if (typeof parsed.amount !== 'number' || parsed.amount <= 0) {
        console.error('[FATAL] processQuickExpense: Invalid amount:', parsed.amount);
        throw new Error('Invalid amount in response');
      }
      if (typeof parsed.description !== 'string' || parsed.description.trim().length === 0) {
        console.error('[FATAL] processQuickExpense: Invalid description:', parsed.description);
        throw new Error('Invalid description in response');
      }
      if (typeof parsed.category !== 'string' || !VALID_CATEGORIES.includes(parsed.category)) {
        console.error('[FATAL] processQuickExpense: Invalid category:', parsed.category, 'Valid categories:', VALID_CATEGORIES);
        throw new Error(`Invalid category in response: ${parsed.category}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
      }

      console.log('[DEBUG] processQuickExpense: Validation passed, returning result');
      return {
        amount: parsed.amount,
        description: parsed.description.trim(),
        category: parsed.category,
      };
    } catch (error: any) {
      console.error('[FATAL] processQuickExpense: Error processing quick expense:', error);
      console.error('[FATAL] processQuickExpense: Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        text: text
      });
      
      // Check if it's a quota/rate limit error and provide user-friendly message
      const errorMsg = error.message?.toLowerCase() || '';
      const isQuotaError = errorMsg.includes('quota') || 
                          errorMsg.includes('rate limit') || 
                          errorMsg.includes('429') ||
                          errorMsg.includes('exceeded') ||
                          errorMsg.includes('free tier') ||
                          errorMsg.includes('limits ran out') ||
                          error.status === 429 ||
                          error.code === 429;
      
      if (isQuotaError) {
        const quotaError = new Error('AI daily free limits ran out. Upgrade to get more limits.');
        quotaError.name = 'QuotaExceededError';
        (quotaError as any).status = 429;
        Sentry.captureException(quotaError, {
          extra: { originalError: error.message, text }
        });
        throw quotaError;
      }
      
      Sentry.captureException(error);
      throw error;
    }
  }

  /**
   * Parse edit intent from user instruction
   * Returns partial JSON with fields to update
   */
  async parseEditIntent(
    instruction: string,
    currentTransactionMiniDTO: {
      description: string;
      amount: number;
      category: string;
      date: string;
    },
    onFallback?: FallbackCallback
  ): Promise<{ amount?: number; description?: string; category?: string }> {
    const prompt = `You are a financial assistant. Parse the user's edit instruction for a transaction.

Current Transaction:
- Description: "${currentTransactionMiniDTO.description}"
- Amount: $${currentTransactionMiniDTO.amount.toFixed(2)}
- Category: ${currentTransactionMiniDTO.category}
- Date: ${currentTransactionMiniDTO.date}

User Instruction: "${instruction}"

Rules:
1. If the instruction is just a number (e.g., "20", "$20", "20.50"), assume it's an Amount update.
2. If the instruction contains text (e.g., "lunch", "change to coffee"), assume it's a Description update.
3. If the instruction mentions a category (e.g., "Food", "Transport"), update Category.
4. You can update multiple fields if the instruction requests it.

Return ONLY valid JSON with fields to update (no markdown, no explanations):
{
  "amount": number (optional, only if amount should change),
  "description": "string" (optional, only if description should change),
  "category": "string" (optional, only if category should change)
}

Examples:
- Instruction: "20" → {"amount": 20}
- Instruction: "lunch" → {"description": "lunch"}
- Instruction: "change to $15 and category to Food" → {"amount": 15, "category": "Food"}
- Instruction: "coffee" → {"description": "coffee"}`;

    try {
      const aiResponse = await this.generateContentWithFallback(prompt, onFallback);
      const responseText = aiResponse.text;

      // Extract JSON from response
      const extractedJSON = this.extractJSON(responseText);
      if (!extractedJSON) {
        console.error('[parseEditIntent] No JSON found in response:', responseText.substring(0, 500));
        throw new Error('No JSON found in response');
      }

      let parsed;
      try {
        parsed = JSON.parse(extractedJSON);
      } catch (parseError: any) {
        console.error('[parseEditIntent] JSON parse error:', {
          error: parseError.message,
          extractedJSON: extractedJSON.substring(0, 200),
          fullResponse: responseText.substring(0, 500),
        });
        Sentry.captureException(parseError, {
          extra: {
            extractedJSON: extractedJSON.substring(0, 500),
            fullResponse: responseText.substring(0, 1000),
          },
        });
        throw new Error(`Failed to parse JSON response: ${parseError.message}`);
      }

      // Validate and return only valid fields
      const result: { amount?: number; description?: string; category?: string } = {};

      if (parsed.amount !== undefined) {
        if (typeof parsed.amount === 'number' && parsed.amount > 0) {
          result.amount = parsed.amount;
        }
      }

      if (parsed.description !== undefined) {
        if (typeof parsed.description === 'string' && parsed.description.trim().length > 0) {
          result.description = parsed.description.trim();
        }
      }

      if (parsed.category !== undefined) {
        if (typeof parsed.category === 'string' && parsed.category.trim().length > 0) {
          result.category = parsed.category.trim();
        }
      }

      return result;
    } catch (error: any) {
      console.error('Error parsing edit intent:', error);
      Sentry.captureException(error);
      throw error;
    }
  }
}






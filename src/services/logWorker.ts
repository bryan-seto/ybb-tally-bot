import { prisma } from '../lib/prisma';

export interface LogEntry {
  userId: bigint;
  timestamp: Date;
  interactionType: 'MESSAGE' | 'CALLBACK' | 'PHOTO' | 'COMMAND' | 'ACTION';
  eventType: string;
  content?: string | null;
  metadata?: any;
  status: 'SUCCESS' | 'FAILURE' | 'PENDING';
  errorMessage?: string | null;
  chatId?: bigint | null;
  chatType?: string | null;
  messageId?: bigint | null;
}

/**
 * LogWorker - Async batching service for user interaction logs
 * 
 * Features:
 * - Non-blocking push to in-memory buffer
 * - Automatic batching (20 entries or 5s interval)
 * - PII sanitization before buffering
 * - Graceful error handling (never crashes bot)
 */
export class LogWorker {
  private static instance: LogWorker;
  private buffer: LogEntry[] = [];
  private readonly BATCH_SIZE = 20;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  private constructor() {
    // Start interval-based flush timer
    this.startFlushTimer();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): LogWorker {
    if (!LogWorker.instance) {
      LogWorker.instance = new LogWorker();
    }
    return LogWorker.instance;
  }

  /**
   * Start the flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => {
      this.flush().catch(err => {
        console.error('[LogWorker] Error in timer-based flush:', err);
      });
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Push a log entry to the buffer (non-blocking)
   * Sanitizes PII before buffering
   */
  public push(entry: LogEntry): void {
    try {
      // Sanitize content before buffering
      const sanitizedEntry: LogEntry = {
        ...entry,
        content: entry.content ? this.sanitizeContent(entry.content) : null,
      };

      this.buffer.push(sanitizedEntry);

      // Flush if buffer is full
      if (this.buffer.length >= this.BATCH_SIZE) {
        this.flush().catch(err => {
          console.error('[LogWorker] Error in size-based flush:', err);
        });
      }
    } catch (error) {
      // Never throw - logging failures should never break the bot
      console.error('[LogWorker] Error pushing log entry:', error);
    }
  }

  /**
   * Flush buffer to database (batch insert)
   */
  public async flush(): Promise<void> {
    // Prevent concurrent flushes
    if (this.isFlushing || this.buffer.length === 0) {
      return;
    }

    this.isFlushing = true;

    try {
      // Copy buffer and clear immediately (to allow new entries while flushing)
      const chunk = [...this.buffer];
      this.buffer = [];

      // Batch insert to Prisma
      await prisma.userInteractionLog.createMany({
        data: chunk.map(entry => ({
          userId: entry.userId,
          timestamp: entry.timestamp,
          interactionType: entry.interactionType,
          eventType: entry.eventType,
          content: entry.content,
          metadata: entry.metadata || {},
          status: entry.status,
          errorMessage: entry.errorMessage,
          chatId: entry.chatId,
          chatType: entry.chatType,
          messageId: entry.messageId,
        })),
        skipDuplicates: true, // Skip duplicates if any
      });

      console.log(`[LogWorker] Flushed ${chunk.length} log entries to database`);
    } catch (error: any) {
      // Log error but don't throw - bot must continue operating
      console.error('[LogWorker] Failed to flush logs to database:', error);
      
      // Optionally: Could implement retry logic here in the future
      // For now, we just log and continue
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Sanitize PII (Personally Identifiable Information) from content
   * Uses custom regex patterns to redact sensitive data
   */
  private sanitizeContent(content: string): string {
    let sanitized = content;

    // Credit card numbers (16 digits, various formats)
    // Matches: 1234-5678-9012-3456, 1234 5678 9012 3456, 1234567890123456
    sanitized = sanitized.replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[REDACTED_CARD]');

    // Phone numbers (international formats)
    // Matches: +65 1234 5678, +1-234-567-8900, (65) 1234-5678
    sanitized = sanitized.replace(/\b(\+?\d{1,3}[- ]?)?\(?\d{1,4}\)?[- ]?\d{1,4}[- ]?\d{1,9}\b/g, '[REDACTED_PHONE]');

    // Email addresses
    sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED_EMAIL]');

    // Singapore NRIC/FIN patterns (S1234567A, T1234567B, etc.)
    sanitized = sanitized.replace(/\b[STFG]\d{7}[A-Z]\b/g, '[REDACTED_NRIC]');

    // Custom patterns can be added here as needed

    return sanitized;
  }

  /**
   * Force flush and stop the worker (for graceful shutdown)
   */
  public async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    // Final flush of any remaining entries
    await this.flush();
  }

  /**
   * Get current buffer size (for testing/monitoring)
   */
  public getBufferSize(): number {
    return this.buffer.length;
  }
}

// Export singleton instance
export const logWorker = LogWorker.getInstance();


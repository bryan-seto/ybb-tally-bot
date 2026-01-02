import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LogWorker, LogEntry } from '../logWorker';
import { prisma } from '../../lib/prisma';

// Mock Prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    userInteractionLog: {
      createMany: vi.fn(),
    },
  },
}));

describe('LogWorker', () => {
  let logWorker: LogWorker;

  beforeEach(() => {
    // Reset singleton instance
    (LogWorker as any).instance = undefined;
    logWorker = LogWorker.getInstance();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clean up any pending timers
    if ((logWorker as any).flushTimer) {
      clearInterval((logWorker as any).flushTimer);
    }
  });

  describe('should_buffer_logs_and_not_write_immediately', () => {
    it('should push logs to buffer without writing to database immediately', () => {
      const entry: LogEntry = {
        userId: BigInt(123),
        timestamp: new Date(),
        interactionType: 'MESSAGE',
        eventType: 'text_message',
        content: 'test message',
        status: 'SUCCESS',
      };

      logWorker.push(entry);

      // Should not have called Prisma yet
      expect(prisma.userInteractionLog.createMany).not.toHaveBeenCalled();
      
      // Buffer should have the entry
      expect(logWorker.getBufferSize()).toBe(1);
    });
  });

  describe('should_flush_logs_when_buffer_limit_reached', () => {
    it('should flush logs when buffer reaches BATCH_SIZE (20)', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const mockCreateMany = vi.mocked(prisma.userInteractionLog.createMany).mockResolvedValue({ count: 20 });

      // Push 20 entries
      for (let i = 0; i < 20; i++) {
        logWorker.push({
          userId: BigInt(123),
          timestamp: new Date(),
          interactionType: 'MESSAGE',
          eventType: 'text_message',
          content: `test message ${i}`,
          status: 'SUCCESS',
        });
      }

      // Wait for async flush (flush is called synchronously when buffer is full, but the DB call is async)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should have called Prisma with 20 entries
      expect(mockCreateMany).toHaveBeenCalledTimes(1);
      expect(mockCreateMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: BigInt(123),
            interactionType: 'MESSAGE',
            eventType: 'text_message',
            status: 'SUCCESS',
          }),
        ]),
        skipDuplicates: true,
      });
      
      // Buffer should be empty after flush
      expect(logWorker.getBufferSize()).toBe(0);
      vi.useFakeTimers(); // Restore fake timers
    });
  });

  describe('should_flush_logs_on_interval', () => {
    it('should flush logs every 5 seconds even if buffer is not full', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const mockCreateMany = vi.mocked(prisma.userInteractionLog.createMany).mockResolvedValue({ count: 1 });

      // Push 1 entry
      logWorker.push({
        userId: BigInt(123),
        timestamp: new Date(),
        interactionType: 'MESSAGE',
        eventType: 'text_message',
        content: 'test message',
        status: 'SUCCESS',
      });

      // Wait for the 5 second interval to trigger
      await new Promise(resolve => setTimeout(resolve, 5100));

      // Should have called Prisma
      expect(mockCreateMany).toHaveBeenCalledTimes(1);
      expect(logWorker.getBufferSize()).toBe(0);
      vi.useFakeTimers(); // Restore fake timers
    }, 10000); // Increase timeout to 10 seconds
  });

  describe('should_sanitize_pii_content', () => {
    it('should redact credit card numbers', () => {
      const entry: LogEntry = {
        userId: BigInt(123),
        timestamp: new Date(),
        interactionType: 'MESSAGE',
        eventType: 'text_message',
        content: 'My card is 1234-5678-9012-3456',
        status: 'SUCCESS',
      };

      logWorker.push(entry);

      // Check that the content in the buffer is sanitized
      const buffer = (logWorker as any).buffer;
      expect(buffer[0].content).toContain('[REDACTED_CARD]');
      expect(buffer[0].content).not.toContain('1234-5678-9012-3456');
    });

    it('should redact phone numbers', () => {
      const entry: LogEntry = {
        userId: BigInt(123),
        timestamp: new Date(),
        interactionType: 'MESSAGE',
        eventType: 'text_message',
        content: 'Call me at +65 1234 5678',
        status: 'SUCCESS',
      };

      logWorker.push(entry);

      const buffer = (logWorker as any).buffer;
      expect(buffer[0].content).toContain('[REDACTED_PHONE]');
      expect(buffer[0].content).not.toContain('+65 1234 5678');
    });

    it('should redact email addresses', () => {
      const entry: LogEntry = {
        userId: BigInt(123),
        timestamp: new Date(),
        interactionType: 'MESSAGE',
        eventType: 'text_message',
        content: 'Email me at test@example.com',
        status: 'SUCCESS',
      };

      logWorker.push(entry);

      const buffer = (logWorker as any).buffer;
      expect(buffer[0].content).toContain('[REDACTED_EMAIL]');
      expect(buffer[0].content).not.toContain('test@example.com');
    });

    it('should redact Singapore NRIC/FIN', () => {
      const entry: LogEntry = {
        userId: BigInt(123),
        timestamp: new Date(),
        interactionType: 'MESSAGE',
        eventType: 'text_message',
        content: 'My NRIC is S1234567A',
        status: 'SUCCESS',
      };

      logWorker.push(entry);

      const buffer = (logWorker as any).buffer;
      expect(buffer[0].content).toContain('[REDACTED_NRIC]');
      expect(buffer[0].content).not.toContain('S1234567A');
    });
  });

  describe('should_handle_db_failure_gracefully', () => {
    it('should not throw when database write fails', async () => {
      vi.useRealTimers(); // Use real timers for this test
      const mockCreateMany = vi.mocked(prisma.userInteractionLog.createMany).mockRejectedValue(
        new Error('Database connection failed')
      );

      // Push 20 entries to trigger flush
      for (let i = 0; i < 20; i++) {
        logWorker.push({
          userId: BigInt(123),
          timestamp: new Date(),
          interactionType: 'MESSAGE',
          eventType: 'text_message',
          content: `test message ${i}`,
          status: 'SUCCESS',
        });
      }

      // Wait for async flush
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should have attempted to write
      expect(mockCreateMany).toHaveBeenCalled();
      
      // Should not throw - error should be caught and logged
      // Buffer should be cleared even on error (to prevent memory leak)
      expect(logWorker.getBufferSize()).toBe(0);
      vi.useFakeTimers(); // Restore fake timers
    });

    it('should continue operating after database failure', () => {
      const mockCreateMany = vi.mocked(prisma.userInteractionLog.createMany).mockRejectedValue(
        new Error('Database connection failed')
      );

      // Push entry
      logWorker.push({
        userId: BigInt(123),
        timestamp: new Date(),
        interactionType: 'MESSAGE',
        eventType: 'text_message',
        content: 'test message',
        status: 'SUCCESS',
      });

      // Should not throw
      expect(() => {
        logWorker.push({
          userId: BigInt(123),
          timestamp: new Date(),
          interactionType: 'MESSAGE',
          eventType: 'text_message',
          content: 'another message',
          status: 'SUCCESS',
        });
      }).not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('should flush remaining logs and stop timer on shutdown', async () => {
      const mockCreateMany = vi.mocked(prisma.userInteractionLog.createMany).mockResolvedValue({ count: 1 });

      // Push entry
      logWorker.push({
        userId: BigInt(123),
        timestamp: new Date(),
        interactionType: 'MESSAGE',
        eventType: 'text_message',
        content: 'test message',
        status: 'SUCCESS',
      });

      // Shutdown
      await logWorker.shutdown();

      // Should have flushed
      expect(mockCreateMany).toHaveBeenCalled();
      expect(logWorker.getBufferSize()).toBe(0);
      
      // Timer should be cleared
      expect((logWorker as any).flushTimer).toBeNull();
    });
  });
});


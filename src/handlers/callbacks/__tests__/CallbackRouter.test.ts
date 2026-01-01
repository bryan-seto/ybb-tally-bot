import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallbackRouter } from '../CallbackRouter';
import { DashboardCallbackHandler } from '../DashboardCallbackHandler';
import { ExpenseService } from '../../../services/expenseService';
import { HistoryService } from '../../../services/historyService';
import { RecurringExpenseService } from '../../../services/recurringExpenseService';
import * as utils from '../utils';

// Mock the utils module
vi.mock('../utils', () => ({
  showLoading: vi.fn(),
  hideLoading: vi.fn(),
}));

describe('CallbackRouter', () => {
  let expenseService: ExpenseService;
  let historyService: HistoryService;
  let recurringExpenseService: RecurringExpenseService;
  let showDashboard: (ctx: any, editMode: boolean) => Promise<void>;
  let router: CallbackRouter;
  let mockCtx: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock services
    expenseService = {} as ExpenseService;
    historyService = {} as HistoryService;
    recurringExpenseService = {} as RecurringExpenseService;
    showDashboard = vi.fn().mockResolvedValue(undefined);

    // Create router
    router = new CallbackRouter(
      expenseService,
      historyService,
      recurringExpenseService,
      showDashboard
    );

    // Create mock context
    mockCtx = {
      session: {},
      callbackQuery: {
        data: 'back_to_dashboard',
      },
      answerCbQuery: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue({ message_id: 123 }),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      chat: { id: 456 },
      telegram: {
        editMessageText: vi.fn().mockResolvedValue(undefined),
      },
    };

    // Setup default mock behavior
    vi.mocked(utils.showLoading).mockResolvedValue(789);
    vi.mocked(utils.hideLoading).mockResolvedValue(undefined);
  });

  describe('Routing Accuracy', () => {
    it('should call the correct handler when canHandle returns true', async () => {
      await router.process(mockCtx, 'back_to_dashboard');

      // Verify showDashboard was called (DashboardCallbackHandler's handle method)
      expect(showDashboard).toHaveBeenCalledWith(mockCtx, true);
    });

    it('should answer callback query when handler is found', async () => {
      await router.process(mockCtx, 'back_to_dashboard');

      expect(mockCtx.answerCbQuery).toHaveBeenCalled();
    });
  });

  describe('Unknown Callback Fallback', () => {
    it('should handle unknown commands gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await router.process(mockCtx, 'unknown_command');

      // Should log error (console.error is called with a single message string)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[CallbackRouter] No handler found for callback data:',
        'unknown_command'
      );

      // Should notify user via answerCbQuery
      expect(mockCtx.answerCbQuery).toHaveBeenCalledWith('Unknown command', { show_alert: true });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Error Boundary', () => {
    it('should catch handler errors and keep bot alive', async () => {
      // Create a handler that throws an error
      const errorHandler = {
        canHandle: () => true,
        handle: vi.fn().mockRejectedValue(new Error('DB Failed')),
      };

      // Inject error handler by replacing handlers array
      (router as any).handlers = [errorHandler];

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw - error should be caught
      await expect(router.process(mockCtx, 'some_callback')).resolves.not.toThrow();

      // Should log the error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CallbackRouter] Error processing callback'),
        expect.any(Error)
      );

      // Should notify user
      expect(mockCtx.answerCbQuery).toHaveBeenCalledWith('Error processing request', { show_alert: true });

      consoleErrorSpy.mockRestore();
    });

    it('should handle errors when answerCbQuery fails', async () => {
      const errorHandler = {
        canHandle: () => true,
        handle: vi.fn().mockRejectedValue(new Error('DB Failed')),
      };

      (router as any).handlers = [errorHandler];

      // Make answerCbQuery throw
      mockCtx.answerCbQuery = vi.fn().mockRejectedValue(new Error('Network error'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should still not crash - should catch answerCbQuery error too
      await expect(router.process(mockCtx, 'some_callback')).resolves.not.toThrow();

      // Should log errors (handler error + answerCbQuery error + hideLoading might log too)
      expect(consoleErrorSpy).toHaveBeenCalled();
      // Verify at least the handler error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CallbackRouter] Error processing callback'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Loading Lifecycle', () => {
    it('should call showLoading before handler execution', async () => {
      const handleSpy = vi.fn().mockResolvedValue(undefined);
      const handler = {
        canHandle: () => true,
        handle: handleSpy,
      };

      (router as any).handlers = [handler];

      await router.process(mockCtx, 'test_callback');

      // Verify showLoading was called
      expect(utils.showLoading).toHaveBeenCalledWith(mockCtx);

      // Verify handler.handle was called
      expect(handleSpy).toHaveBeenCalled();
    });

    it('should call hideLoading after handler execution completes', async () => {
      const handleSpy = vi.fn().mockResolvedValue(undefined);
      const handler = {
        canHandle: () => true,
        handle: handleSpy,
      };

      (router as any).handlers = [handler];

      vi.mocked(utils.showLoading).mockResolvedValue(999);

      await router.process(mockCtx, 'test_callback');

      // Verify hideLoading was called with the message ID returned from showLoading
      expect(utils.hideLoading).toHaveBeenCalledWith(mockCtx, 999);
    });

    it('should call hideLoading even when handler throws error', async () => {
      const errorHandler = {
        canHandle: () => true,
        handle: vi.fn().mockRejectedValue(new Error('Handler failed')),
      };

      (router as any).handlers = [errorHandler];

      vi.mocked(utils.showLoading).mockResolvedValue(888);

      vi.spyOn(console, 'error').mockImplementation(() => {});

      await router.process(mockCtx, 'test_callback');

      // Verify hideLoading was still called in finally block
      expect(utils.hideLoading).toHaveBeenCalledWith(mockCtx, 888);

      // Verify showLoading was called first
      const showLoadingCallOrder = vi.mocked(utils.showLoading).mock.invocationCallOrder[0];
      const hideLoadingCallOrder = vi.mocked(utils.hideLoading).mock.invocationCallOrder[0];
      expect(hideLoadingCallOrder).toBeGreaterThan(showLoadingCallOrder);
    });

    it('should handle null loading message ID gracefully', async () => {
      vi.mocked(utils.showLoading).mockResolvedValue(null);

      await router.process(mockCtx, 'back_to_dashboard');

      // hideLoading should still be called with null (router always calls it, utils handles null)
      expect(utils.hideLoading).toHaveBeenCalledWith(mockCtx, null);
      
      // Verify the handler still executed successfully
      expect(showDashboard).toHaveBeenCalled();
    });
  });

  describe('Handler Matching Strategy', () => {
    it('should use first matching handler when multiple handlers match', async () => {
      const firstHandler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const secondHandler = {
        canHandle: vi.fn().mockReturnValue(true),
        handle: vi.fn().mockResolvedValue(undefined),
      };

      (router as any).handlers = [firstHandler, secondHandler];

      await router.process(mockCtx, 'test_callback');

      // First handler should be called
      expect(firstHandler.handle).toHaveBeenCalled();

      // Second handler should NOT be called (first match wins)
      expect(secondHandler.handle).not.toHaveBeenCalled();
    });

    it('should initialize session if it does not exist', async () => {
      const ctxWithoutSession = {
        ...mockCtx,
        session: undefined,
      };

      await router.process(ctxWithoutSession, 'back_to_dashboard');

      // Session should be initialized
      expect(ctxWithoutSession.session).toBeDefined();
      expect(typeof ctxWithoutSession.session).toBe('object');
    });
  });
});


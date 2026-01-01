/**
 * Interface contract for all callback handlers
 * 
 * Each handler must implement:
 * - canHandle: Determine if this handler should process the callback
 * - handle: Execute the handler logic
 */
export interface ICallbackHandler {
  /**
   * Determines if this handler can process the given callback data
   * @param data - The callback_data string from Telegram
   * @returns true if this handler should process the callback
   */
  canHandle(data: string): boolean;

  /**
   * Processes the callback
   * @param ctx - Telegram context object
   * @param data - The callback_data string
   * @returns Promise that resolves when handling is complete
   */
  handle(ctx: any, data: string): Promise<void>;
}



/**
 * Interface contract for all message handlers
 * 
 * Each handler must implement:
 * - canHandle: Determine if this handler should process the text message
 * - handle: Execute the handler logic
 */
export interface IMessageHandler {
  /**
   * Determines if this handler can process the given text message
   * @param text - The trimmed text message from Telegram
   * @param session - The current session state (read-only check)
   * @returns true if this handler should process the message
   */
  canHandle(text: string, session: any): boolean;

  /**
   * Processes the message
   * @param ctx - Telegram context object (contains session, chat, user, etc.)
   * @param text - The trimmed text message
   * @returns Promise that resolves when handling is complete
   */
  handle(ctx: any, text: string): Promise<void>;
}

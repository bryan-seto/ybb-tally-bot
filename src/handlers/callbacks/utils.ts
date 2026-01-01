/**
 * Shared utilities for callback handlers
 */

/**
 * Show loading message and return message ID
 * @param ctx - Telegram context object
 * @returns Promise resolving to message ID, or null if failed
 */
export async function showLoading(ctx: any): Promise<number | null> {
  try {
    const loadingMsg = await ctx.reply('⏳ Loading...');
    return loadingMsg.message_id;
  } catch (error) {
    console.error('Error sending loading message:', error);
    return null;
  }
}

/**
 * Delete/hide loading message by message ID
 * @param ctx - Telegram context object
 * @param messageId - Message ID to delete, or null if no message to delete
 */
export async function hideLoading(ctx: any, messageId: number | null): Promise<void> {
  if (messageId) {
    try {
      await ctx.deleteMessage(messageId);
    } catch (error) {
      console.error('Error deleting loading message:', error);
    }
  }
}

/**
 * Safely edit a message with error handling
 * @param ctx - Telegram context object
 * @param messageId - Message ID to edit
 * @param text - New message text
 * @param options - Optional Telegram message options
 */
export async function safeEditMessage(
  ctx: any,
  messageId: number,
  text: string,
  options?: any
): Promise<void> {
  try {
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text, options);
  } catch (error) {
    console.error('Error editing message:', error);
    // Optionally, could send a new message as fallback
    // For now, we'll just log the error
  }
}


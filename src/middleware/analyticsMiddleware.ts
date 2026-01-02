import { Context } from 'telegraf';
import { logWorker, LogEntry } from '../services/logWorker';

/**
 * Analytics Middleware
 * Captures 90% of user interactions automatically
 * - Text messages
 * - Callback queries (button clicks)
 * - Photo uploads
 * - Commands
 * 
 * Logs are pushed to LogWorker for async batching (non-blocking)
 */
export const analyticsMiddleware = async (ctx: Context, next: () => Promise<void>): Promise<void> => {
  const startTime = Date.now();
  const userId = ctx.from?.id ? BigInt(ctx.from.id) : null;
  
  // Skip if no user ID (shouldn't happen after auth, but safety check)
  if (!userId) {
    return next();
  }

  // Extract interaction details
  const interactionType = getInteractionType(ctx);
  const eventType = getEventType(ctx);
  const content = extractContent(ctx);
  const metadata = extractMetadata(ctx);

  // Create initial log entry with PENDING status
  const logEntry: LogEntry = {
    userId,
    timestamp: new Date(),
    interactionType,
    eventType,
    content,
    metadata,
    status: 'PENDING',
    chatId: ctx.chat?.id ? BigInt(ctx.chat.id) : null,
    chatType: ctx.chat?.type || null,
    messageId: ctx.message && 'message_id' in ctx.message ? BigInt(ctx.message.message_id) : null,
  };

  // Push to LogWorker (non-blocking)
  logWorker.push(logEntry);

  try {
    // Execute the actual bot logic
    await next();

    // Update log entry status to SUCCESS
    // Note: We push a new entry with SUCCESS status since we can't update the pending one
    // The LogWorker will handle deduplication if needed, or we can track by messageId
    const successEntry: LogEntry = {
      ...logEntry,
      status: 'SUCCESS',
      metadata: {
        ...metadata,
        latencyMs: Date.now() - startTime,
      },
    };
    logWorker.push(successEntry);
  } catch (error: any) {
    // Log failure
    const failureEntry: LogEntry = {
      ...logEntry,
      status: 'FAILURE',
      errorMessage: error.message || 'Unknown error',
      metadata: {
        ...metadata,
        latencyMs: Date.now() - startTime,
        error: error.message,
      },
    };
    logWorker.push(failureEntry);

    // Re-throw to let error handlers catch it
    throw error;
  }
};

/**
 * Determine interaction type from context
 */
function getInteractionType(ctx: Context): 'MESSAGE' | 'CALLBACK' | 'PHOTO' | 'COMMAND' | 'ACTION' {
  if (ctx.callbackQuery) {
    return 'CALLBACK';
  }
  
  if (ctx.message) {
    if ('photo' in ctx.message && ctx.message.photo) {
      return 'PHOTO';
    }
    
    if ('text' in ctx.message && ctx.message.text) {
      // Check if it's a command
      const text = ctx.message.text;
      if (text.startsWith('/')) {
        return 'COMMAND';
      }
      return 'MESSAGE';
    }
  }
  
  // Default fallback
  return 'MESSAGE';
}

/**
 * Determine event type from context
 */
function getEventType(ctx: Context): string {
  if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
    const data = ctx.callbackQuery.data;
    // Extract event type from callback data (e.g., "tx_settle_123" -> "button_click")
    if (data.startsWith('tx_')) {
      return 'transaction_action';
    } else if (data.startsWith('settle_')) {
      return 'settlement_action';
    } else if (data.startsWith('history_')) {
      return 'history_navigation';
    } else if (data.startsWith('menu_')) {
      return 'menu_navigation';
    } else if (data.startsWith('recurring_')) {
      return 'recurring_expense_action';
    } else if (data.startsWith('manual_')) {
      return 'manual_add_action';
    } else if (data.startsWith('split_')) {
      return 'split_settings_action';
    }
    return 'button_click';
  }
  
  if (ctx.message) {
    if ('photo' in ctx.message && ctx.message.photo) {
      return 'photo_upload';
    }
    
    if ('text' in ctx.message && ctx.message.text) {
      const text = ctx.message.text;
      if (text.startsWith('/')) {
        // Extract command name
        const command = text.split(' ')[0].substring(1);
        return `command_${command}`;
      }
      
      // Check for quick expense pattern
      if (/^\d+(\.\d{1,2})?\s+[a-zA-Z].*/.test(text)) {
        return 'quick_expense';
      }
      
      // Check for edit command
      if (/^edit\s+\/?\d+/.test(text)) {
        return 'edit_command';
      }
      
      // Check for AI correction (bot tagged)
      if (ctx.message.entities) {
        const hasBotMention = ctx.message.entities.some(
          entity => entity.type === 'mention' || entity.type === 'bot_command'
        );
        if (hasBotMention) {
          return 'ai_correction';
        }
      }
      
      return 'text_message';
    }
  }
  
  return 'unknown';
}

/**
 * Extract content from context
 */
function extractContent(ctx: Context): string | null {
  if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
    return ctx.callbackQuery.data;
  }
  
  if (ctx.message) {
    if ('text' in ctx.message && ctx.message.text) {
      return ctx.message.text;
    }
    
    if ('photo' in ctx.message && ctx.message.photo) {
      return `Photo uploaded (${ctx.message.photo.length} photo(s))`;
    }
  }
  
  return null;
}

/**
 * Extract metadata from context
 */
function extractMetadata(ctx: Context): Record<string, any> {
  const metadata: Record<string, any> = {
    updateType: ctx.updateType,
  };

  if (ctx.callbackQuery) {
    metadata.callbackQueryId = ctx.callbackQuery.id;
    if ('message' in ctx.callbackQuery && ctx.callbackQuery.message) {
      metadata.originalMessageId = ctx.callbackQuery.message.message_id;
    }
  }

  if (ctx.message) {
    if ('message_id' in ctx.message) {
      metadata.messageId = ctx.message.message_id;
    }
    
    if ('entities' in ctx.message && ctx.message.entities) {
      metadata.entities = ctx.message.entities.map(e => ({
        type: e.type,
        offset: e.offset,
        length: e.length,
      }));
    }
    
    if ('photo' in ctx.message && ctx.message.photo) {
      metadata.photoCount = ctx.message.photo.length;
      metadata.largestPhotoFileId = ctx.message.photo[ctx.message.photo.length - 1]?.file_id;
    }
  }

  if (ctx.from) {
    metadata.userUsername = ctx.from.username;
    metadata.userFirstName = ctx.from.first_name;
    metadata.userLastName = ctx.from.last_name;
  }

  return metadata;
}


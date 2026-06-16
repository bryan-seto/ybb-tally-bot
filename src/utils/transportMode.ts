/**
 * Transport mode selection for the Telegram bot.
 *
 * Extracted from src/index.ts so the decision is unit-testable and explicit.
 *
 * Long polling vs webhooks:
 *  - Webhooks require a publicly reachable HTTPS endpoint (a domain + TLS).
 *  - Long polling needs only outbound HTTPS, so it runs anywhere (a plain VM,
 *    behind NAT, no domain). This is what lets the bot run on an Oracle Always
 *    Free VM with zero inbound networking.
 *
 * Rule: use webhooks ONLY when running in production/staging AND a non-empty
 * WEBHOOK_URL is configured. In every other case, fall back to long polling.
 */

export type TransportMode = 'webhook' | 'polling';

/**
 * Returns true if the bot should register a webhook, false if it should long-poll.
 *
 * @param nodeEnv  The NODE_ENV value (e.g. 'production', 'staging', 'development', 'test').
 * @param webhookUrl  The configured WEBHOOK_URL (may be undefined/empty/whitespace).
 */
export function shouldUseWebhook(
  nodeEnv: string | undefined,
  webhookUrl: string | undefined
): boolean {
  const isProduction = nodeEnv === 'production';
  const isStaging = nodeEnv === 'staging';
  const hasWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim().length > 0;

  return (isProduction || isStaging) && hasWebhookUrl;
}

/**
 * Convenience wrapper returning the mode as a descriptive string.
 */
export function resolveTransportMode(
  nodeEnv: string | undefined,
  webhookUrl: string | undefined
): TransportMode {
  return shouldUseWebhook(nodeEnv, webhookUrl) ? 'webhook' : 'polling';
}

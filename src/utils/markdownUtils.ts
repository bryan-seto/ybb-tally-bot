/**
 * markdownUtils.ts
 *
 * Helpers for safely embedding arbitrary text inside Telegram Markdown (v1)
 * formatted messages.
 *
 * Telegram Markdown v1 treats these chars as formatting: * _ ` [
 * A backslash must also be escaped to avoid confusing the parser.
 *
 * Usage:
 *   import { escapeMd } from '../utils/markdownUtils';
 *   const safe = `**${escapeMd(description)}**`;
 */

/**
 * Escape characters that have special meaning in Telegram Markdown v1.
 * Safe to call on any string before interpolating into a `parse_mode:'Markdown'` message.
 */
export function escapeMd(text: string): string {
  // Escape backslash first so it doesn't double-escape subsequent replacements.
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[');
}

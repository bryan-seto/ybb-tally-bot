import { describe, test, expect } from 'vitest';
import { shouldUseWebhook, resolveTransportMode } from '../transportMode';

/**
 * These tests pin down the transport-selection logic that the Oracle Always Free
 * migration depends on: with NO webhook URL set, the bot MUST choose long polling,
 * even in production. This is what lets the bot run on a plain VM with no public
 * HTTPS endpoint. Previously this decision was inline in src/index.ts and untested.
 */
describe('transportMode', () => {
  describe('shouldUseWebhook', () => {
    test('production + webhook URL => webhook', () => {
      expect(shouldUseWebhook('production', 'https://example.com')).toBe(true);
    });

    test('staging + webhook URL => webhook', () => {
      expect(shouldUseWebhook('staging', 'https://example.com')).toBe(true);
    });

    // THE ORACLE CASE: production but no webhook URL => long polling.
    test('production + empty webhook URL => polling (Oracle/VM case)', () => {
      expect(shouldUseWebhook('production', '')).toBe(false);
    });

    test('production + undefined webhook URL => polling', () => {
      expect(shouldUseWebhook('production', undefined)).toBe(false);
    });

    test('production + whitespace-only webhook URL => polling', () => {
      expect(shouldUseWebhook('production', '   ')).toBe(false);
    });

    test('staging + empty webhook URL => polling', () => {
      expect(shouldUseWebhook('staging', '')).toBe(false);
    });

    test('development + webhook URL => polling (webhooks only in prod/staging)', () => {
      expect(shouldUseWebhook('development', 'https://example.com')).toBe(false);
    });

    test('development + no webhook URL => polling', () => {
      expect(shouldUseWebhook('development', '')).toBe(false);
    });

    test('test env + webhook URL => polling', () => {
      expect(shouldUseWebhook('test', 'https://example.com')).toBe(false);
    });

    test('undefined env + no webhook URL => polling', () => {
      expect(shouldUseWebhook(undefined, undefined)).toBe(false);
    });
  });

  describe('resolveTransportMode', () => {
    test('returns "webhook" when webhook conditions are met', () => {
      expect(resolveTransportMode('production', 'https://example.com')).toBe('webhook');
    });

    test('returns "polling" for the Oracle case (production, no webhook URL)', () => {
      expect(resolveTransportMode('production', '')).toBe('polling');
    });

    test('returns "polling" for development', () => {
      expect(resolveTransportMode('development', 'https://example.com')).toBe('polling');
    });
  });
});

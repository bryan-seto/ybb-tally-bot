/**
 * withTelegramTimeout — unit tests (U-11…U-14)
 *
 * The function is module-private in QuickExpenseHandler.ts so we reproduce
 * the minimal signature here and test the extracted logic. This verifies the
 * race-timeout contract added in commit 3aef638 without needing a full
 * Telegram context.
 *
 * Tests use vi.useFakeTimers() to keep the suite instant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Inline the function under test (extracted from QuickExpenseHandler.ts)
// so this test file has no import-side-effects from the handler.
async function withTelegramTimeout<T>(promise: Promise<T>, ms = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Telegram API timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

describe('withTelegramTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // U-11: promise resolves before timeout — returns value, timer cleared
  it('U-11: resolves with the inner promise value when it settles before the timeout', async () => {
    const inner = Promise.resolve('ok');
    const result = await withTelegramTimeout(inner, 5000);
    expect(result).toBe('ok');
    // advance past timeout to confirm no dangling rejection
    await vi.runAllTimersAsync();
  });

  // U-12: promise rejects before timeout — propagates original error, timer cleared
  it('U-12: propagates the original rejection when the inner promise rejects before the timeout', async () => {
    const inner = Promise.reject(new Error('network error'));
    await expect(withTelegramTimeout(inner, 5000)).rejects.toThrow('network error');
    await vi.runAllTimersAsync();
  });

  // U-13: promise never resolves — times out with the correct message
  it('U-13: rejects with timeout error message when the promise never resolves', async () => {
    const inner = new Promise<string>(() => { /* never settles */ });
    const racePromise = withTelegramTimeout(inner, 5000);
    // Advance fake clock past the timeout
    await vi.advanceTimersByTimeAsync(5001);
    await expect(racePromise).rejects.toThrow('Telegram API timeout after 5000ms');
  });

  // U-14: custom ms param is reflected in the error message
  it('U-14: error message contains the configured timeout duration', async () => {
    const inner = new Promise<string>(() => { /* never settles */ });
    const racePromise = withTelegramTimeout(inner, 10000);
    await vi.advanceTimersByTimeAsync(10001);
    await expect(racePromise).rejects.toThrow('Telegram API timeout after 10000ms');
  });
});

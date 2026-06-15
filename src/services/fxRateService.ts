import { prisma } from '../lib/prisma';

/**
 * Converts foreign currency amounts to SGD.
 *
 * Priority order:
 *   1. Manual override (Settings key fx_manual_{CUR})
 *   2. In-memory 6-hour cache
 *   3. Live API (open.er-api.com — no API key, covers SEA currencies including VND)
 *   4. Static fallback table (offline use)
 *   5. SGD short-circuit (returns 1:1 immediately)
 */

export interface FxConversionResult {
  sgdAmount: number;
  fxRate: number;
  source: 'manual' | 'cached' | 'live' | 'fallback' | 'sgd';
  originalCurrency: string;
}

interface CacheEntry {
  rate: number;   // units-per-SGD (e.g. 20424.75 VND per 1 SGD)
  cachedAt: number; // Date.now() ms
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const STATIC_FALLBACK: Record<string, number> = {
  VND: 20000,
  MYR: 3.5,
  THB: 27,
  JPY: 110,
  USD: 0.74,
  IDR: 11000,
  HKD: 5.8,
  AUD: 1.1,
  GBP: 0.59,
  EUR: 0.69,
  TWD: 23.5,
};

export class FxRateService {
  // Named _cache so tests can flush it: svc['_cache'] = {}
  _cache: Record<string, CacheEntry> = {};

  /**
   * Convert `amount` in `currency` to SGD.
   * SGD input is a no-op (returns immediately with source='sgd').
   */
  async convertToSGD(amount: number, currency: string): Promise<FxConversionResult> {
    const cur = currency.toUpperCase();

    // 0. SGD short-circuit
    if (cur === 'SGD') {
      return { sgdAmount: amount, fxRate: 1, source: 'sgd', originalCurrency: 'SGD' };
    }

    // 1. Manual override (Settings table)
    const manual = await this._getManualRateRaw(cur);
    if (manual !== null) {
      const fxRate = 1 / manual;
      return {
        sgdAmount: amount * fxRate,
        fxRate,
        source: 'manual',
        originalCurrency: cur,
      };
    }

    // 2. In-memory cache
    const cached = this._cache[cur];
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      const fxRate = 1 / cached.rate;
      return {
        sgdAmount: amount * fxRate,
        fxRate,
        source: 'cached',
        originalCurrency: cur,
      };
    }

    // 3. Live API
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/SGD', {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as { rates?: Record<string, number> };
        const rates: Record<string, number> = data.rates ?? {};
        if (rates[cur] != null) {
          const unitsPerSGD = rates[cur];
          // Store in cache
          this._cache[cur] = { rate: unitsPerSGD, cachedAt: Date.now() };
          const fxRate = 1 / unitsPerSGD;
          return {
            sgdAmount: amount * fxRate,
            fxRate,
            source: 'live',
            originalCurrency: cur,
          };
        }
        // Currency not in API response — fall through to static fallback
      }
      // Non-ok response — fall through to static fallback
    } catch {
      // Network error — fall through to static fallback
    }

    // 4. Static fallback
    const fallbackRate = STATIC_FALLBACK[cur];
    if (fallbackRate != null) {
      const fxRate = 1 / fallbackRate;
      return {
        sgdAmount: amount * fxRate,
        fxRate,
        source: 'fallback',
        originalCurrency: cur,
      };
    }

    // Unknown currency — return 1:1 as last resort
    return { sgdAmount: amount, fxRate: 1, source: 'fallback', originalCurrency: cur };
  }

  /**
   * Persist a manual exchange rate.
   * `sgdPer1Unit` = how many of this currency equal 1 SGD
   * e.g. setManualRate('VND', 20000) → 1 SGD = 20,000 VND
   */
  async setManualRate(currency: string, sgdPer1Unit: number): Promise<void> {
    const cur = currency.toUpperCase();
    const key = `fx_manual_${cur}`;
    const value = JSON.stringify({ rate: sgdPer1Unit, setAt: new Date().toISOString() });
    await prisma.settings.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /**
   * Remove a manual rate override. Silently ignores missing entries.
   */
  async clearManualRate(currency: string): Promise<void> {
    const cur = currency.toUpperCase();
    const key = `fx_manual_${cur}`;
    try {
      await prisma.settings.delete({ where: { key } });
    } catch {
      // Not found — OK
    }
  }

  /**
   * Return the current manual rate for `currency`, or null if not set.
   */
  async getManualRate(currency: string): Promise<{ rate: number; setAt: Date } | null> {
    return this._getManualRateRecord(currency);
  }

  /**
   * Returns true if a manual rate exists AND is older than `thresholdDays` (default 14).
   */
  async isManualRateStale(currency: string, thresholdDays = 14): Promise<boolean> {
    const record = await this._getManualRateRecord(currency);
    if (!record) return false;
    const ageMs = Date.now() - record.setAt.getTime();
    return ageMs > thresholdDays * 24 * 60 * 60 * 1000;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async _getManualRateRaw(currency: string): Promise<number | null> {
    const record = await this._getManualRateRecord(currency);
    return record ? record.rate : null;
  }

  private async _getManualRateRecord(currency: string): Promise<{ rate: number; setAt: Date } | null> {
    const cur = currency.toUpperCase();
    const key = `fx_manual_${cur}`;
    const row = await prisma.settings.findUnique({ where: { key } });
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as { rate: number; setAt: string };
      return { rate: parsed.rate, setAt: new Date(parsed.setAt) };
    } catch {
      return null;
    }
  }
}

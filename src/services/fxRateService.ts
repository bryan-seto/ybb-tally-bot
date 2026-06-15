import { prisma } from '../lib/prisma';

/**
 * FxRateService — live + cached + fallback + manual-override FX conversion to SGD.
 *
 * Priority order for convertToSGD:
 *   1. SGD short-circuit (returns immediately, no DB/HTTP)
 *   2. Manual override stored in Settings table (key: fx_manual_{CUR})
 *   3. In-memory cache (TTL 6 hours, keyed by currency code)
 *   4. Live API: https://open.er-api.com/v6/latest/SGD
 *   5. Static fallback table (approximate, for offline use)
 */

export interface FxConversionResult {
  sgdAmount: number;
  fxRate: number;
  source: 'sgd' | 'manual' | 'cached' | 'live' | 'fallback';
  originalCurrency: string;
}

interface CacheEntry {
  rate: number;  // units of currency per 1 SGD
  cachedAt: number; // Date.now() timestamp
}

interface ManualRatePayload {
  rate: number;   // units of currency per 1 SGD
  setAt: string;  // ISO string
}

// Approximate static fallback rates (units of currency per 1 SGD)
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

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class FxRateService {
  /** In-memory cache: { [currencyCode]: { rate, cachedAt } } */
  _cache: Record<string, CacheEntry> = {};

  /**
   * Convert an amount in a foreign currency to SGD.
   * Returns sgdAmount, fxRate (1 unit of currency in SGD), source, originalCurrency.
   */
  async convertToSGD(amount: number, currency: string): Promise<FxConversionResult> {
    const cur = currency.toUpperCase();

    // 1. SGD short-circuit
    if (cur === 'SGD') {
      return { sgdAmount: amount, fxRate: 1, source: 'sgd', originalCurrency: 'SGD' };
    }

    // 2. Manual override
    const manual = await this.getManualRate(cur);
    if (manual) {
      const fxRate = 1 / manual.rate;
      return {
        sgdAmount: amount * fxRate,
        fxRate,
        source: 'manual',
        originalCurrency: cur,
      };
    }

    // 3. In-memory cache
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

    // 4. Live API
    try {
      const resp = await fetch('https://open.er-api.com/v6/latest/SGD', {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const data = await resp.json() as { rates?: Record<string, number> };
        const rates: Record<string, number> = data.rates ?? {};
        if (rates[cur] != null) {
          const unitsPerSGD = rates[cur];
          // Cache the rate
          this._cache[cur] = { rate: unitsPerSGD, cachedAt: Date.now() };
          const fxRate = 1 / unitsPerSGD;
          return {
            sgdAmount: amount * fxRate,
            fxRate,
            source: 'live',
            originalCurrency: cur,
          };
        }
        // API responded but currency missing — fall through to static fallback
      }
      // Non-ok response — fall through
    } catch {
      // Network error / timeout — fall through to static fallback
    }

    // 5. Static fallback
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

    // Unknown currency — best effort: treat as 1:1 with SGD
    return { sgdAmount: amount, fxRate: 1, source: 'fallback', originalCurrency: cur };
  }

  /**
   * Store a manual rate in the Settings table.
   * rate = units of currency per 1 SGD (e.g. 20000 for VND means 1 SGD = 20000 VND).
   */
  async setManualRate(currency: string, sgdPer1Unit: number): Promise<void> {
    const cur = currency.toUpperCase();
    const payload: ManualRatePayload = {
      rate: sgdPer1Unit,
      setAt: new Date().toISOString(),
    };
    await prisma.settings.upsert({
      where: { key: `fx_manual_${cur}` },
      create: {
        key: `fx_manual_${cur}`,
        value: JSON.stringify(payload),
      },
      update: {
        value: JSON.stringify(payload),
      },
    });
  }

  /**
   * Remove the manual rate override for a currency.
   */
  async clearManualRate(currency: string): Promise<void> {
    const cur = currency.toUpperCase();
    try {
      await prisma.settings.delete({ where: { key: `fx_manual_${cur}` } });
    } catch {
      // Ignore — not found is fine
    }
  }

  /**
   * Get the current manual rate for a currency.
   * Returns null if no manual rate is set.
   */
  async getManualRate(currency: string): Promise<{ rate: number; setAt: Date } | null> {
    const cur = currency.toUpperCase();
    const row = await prisma.settings.findUnique({ where: { key: `fx_manual_${cur}` } });
    if (!row) return null;
    try {
      const payload: ManualRatePayload = JSON.parse(row.value);
      return { rate: payload.rate, setAt: new Date(payload.setAt) };
    } catch {
      return null;
    }
  }

  /**
   * Returns true if a manual rate exists AND its setAt is older than thresholdDays.
   */
  async isManualRateStale(currency: string, thresholdDays = 14): Promise<boolean> {
    const manual = await this.getManualRate(currency);
    if (!manual) return false;
    const ageMs = Date.now() - manual.setAt.getTime();
    return ageMs > thresholdDays * 24 * 60 * 60 * 1000;
  }
}

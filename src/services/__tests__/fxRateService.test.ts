/**
 * TDD tests for FxRateService — written BEFORE implementation.
 * All tests expect: src/services/fxRateService.ts to export FxRateService class.
 *
 * Covers:
 *  - Live API fetch (open.er-api.com)
 *  - 6-hour in-memory cache
 *  - Static fallback when API is unavailable
 *  - Manual rate override via Settings table
 *  - convertToSGD helper
 *  - Stale override detection (>14 days)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../lib/prisma';

// ── Mock prisma (Settings table only — no DB needed for FX unit tests) ────────
vi.mock('../../lib/prisma', () => ({
  prisma: {
    settings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// ── Mock global fetch ─────────────────────────────────────────────────────────
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeApiResponse(base: string, rates: Record<string, number>, ok = true) {
  return Promise.resolve({
    ok,
    json: () =>
      Promise.resolve({
        result: 'success',
        base_code: base,
        rates,
        time_last_update_utc: new Date().toUTCString(),
      }),
  } as Response);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('FxRateService', () => {
  let FxRateService: any;
  let svc: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Re-import so cache is fresh each test
    const mod = await import('../fxRateService');
    FxRateService = mod.FxRateService;
    svc = new FxRateService();
    // Default: no manual override in Settings
    vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. SGD short-circuit ─────────────────────────────────────────────────
  describe('SGD short-circuit', () => {
    it('returns { sgdAmount: amount, fxRate: 1, source: "sgd" } for SGD input', async () => {
      const result = await svc.convertToSGD(100, 'SGD');
      expect(result.sgdAmount).toBe(100);
      expect(result.fxRate).toBe(1);
      expect(result.source).toBe('sgd');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── 2. Live API ──────────────────────────────────────────────────────────
  describe('live API fetch', () => {
    it('fetches rate from open.er-api.com and converts VND to SGD', async () => {
      // 1 SGD = 20424 VND → 1 VND = 1/20424 SGD
      mockFetch.mockReturnValueOnce(makeApiResponse('SGD', { VND: 20424.75 }));

      const result = await svc.convertToSGD(50000, 'VND');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('open.er-api.com'),
        expect.any(Object),
      );
      expect(result.fxRate).toBeCloseTo(1 / 20424.75, 8);
      expect(result.sgdAmount).toBeCloseTo(50000 / 20424.75, 4);
      expect(result.source).toBe('live');
    });

    it('fetches rate and converts MYR to SGD', async () => {
      mockFetch.mockReturnValueOnce(makeApiResponse('SGD', { MYR: 3.52 }));
      const result = await svc.convertToSGD(50, 'MYR');
      expect(result.sgdAmount).toBeCloseTo(50 / 3.52, 4);
      expect(result.source).toBe('live');
    });

    it('fetches rate and converts THB to SGD', async () => {
      mockFetch.mockReturnValueOnce(makeApiResponse('SGD', { THB: 27.5 }));
      const result = await svc.convertToSGD(200, 'THB');
      expect(result.sgdAmount).toBeCloseTo(200 / 27.5, 4);
      expect(result.source).toBe('live');
    });

    it('fetches rate and converts JPY to SGD', async () => {
      mockFetch.mockReturnValueOnce(makeApiResponse('SGD', { JPY: 110.5 }));
      const result = await svc.convertToSGD(1200, 'JPY');
      expect(result.sgdAmount).toBeCloseTo(1200 / 110.5, 4);
      expect(result.source).toBe('live');
    });

    it('fetches rate and converts USD to SGD', async () => {
      mockFetch.mockReturnValueOnce(makeApiResponse('SGD', { USD: 0.74 }));
      const result = await svc.convertToSGD(20, 'USD');
      expect(result.sgdAmount).toBeCloseTo(20 / 0.74, 4);
      expect(result.source).toBe('live');
    });
  });

  // ── 3. Cache ─────────────────────────────────────────────────────────────
  describe('6-hour cache', () => {
    it('does NOT re-fetch within 6 hours', async () => {
      mockFetch.mockReturnValue(makeApiResponse('SGD', { VND: 20424.75 }));

      await svc.convertToSGD(50000, 'VND');
      await svc.convertToSGD(10000, 'VND');

      // Two calls but fetch only once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('second call returns source "cached"', async () => {
      mockFetch.mockReturnValue(makeApiResponse('SGD', { VND: 20424.75 }));

      await svc.convertToSGD(50000, 'VND'); // primes cache
      const result = await svc.convertToSGD(10000, 'VND');

      expect(result.source).toBe('cached');
    });

    it('re-fetches after 6 hours', async () => {
      vi.useFakeTimers();
      mockFetch.mockReturnValue(makeApiResponse('SGD', { VND: 20424.75 }));

      await svc.convertToSGD(50000, 'VND'); // primes cache
      vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1); // 6h + 1ms
      await svc.convertToSGD(10000, 'VND');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── 4. Static fallback ───────────────────────────────────────────────────
  describe('static fallback', () => {
    it('falls back to static table when API is down (non-ok response)', async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response),
      );

      const result = await svc.convertToSGD(50000, 'VND');

      expect(result.source).toBe('fallback');
      expect(result.sgdAmount).toBeGreaterThan(0);
      // Static fallback for VND should give a reasonable ballpark (>$1 and <$5 for 50000 VND)
      expect(result.sgdAmount).toBeGreaterThan(1);
      expect(result.sgdAmount).toBeLessThan(5);
    });

    it('falls back to static table when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network timeout'));

      const result = await svc.convertToSGD(50000, 'VND');

      expect(result.source).toBe('fallback');
      expect(result.sgdAmount).toBeGreaterThan(0);
    });

    it('falls back when currency missing from API response', async () => {
      // API responds but doesn't include the requested currency
      mockFetch.mockReturnValueOnce(makeApiResponse('SGD', { USD: 0.74 })); // no VND

      const result = await svc.convertToSGD(50000, 'VND');

      expect(result.source).toBe('fallback');
    });

    it('has fallback entries for all common travel currencies', async () => {
      const currencies = ['VND', 'MYR', 'THB', 'JPY', 'USD', 'IDR', 'HKD', 'AUD', 'GBP', 'EUR'];
      for (const cur of currencies) {
        mockFetch.mockRejectedValueOnce(new Error('network error'));
        const result = await svc.convertToSGD(1000, cur);
        expect(result.source).toBe('fallback');
        expect(result.sgdAmount).toBeGreaterThan(0);
        expect(result.fxRate).toBeGreaterThan(0);
        // Flush cache between currencies
        svc['_cache'] = {};
      }
    });
  });

  // ── 5. Manual rate override ───────────────────────────────────────────────
  describe('manual rate override', () => {
    it('uses manual rate from Settings when present (overrides API)', async () => {
      // Manual rate: 1 SGD = 20000 VND
      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'fx_manual_VND',
        value: JSON.stringify({ rate: 20000, setAt: new Date().toISOString() }),
        updatedAt: new Date(),
      } as any);

      const result = await svc.convertToSGD(50000, 'VND');

      // Manual rate takes priority — fetch should NOT be called
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.fxRate).toBeCloseTo(1 / 20000, 8);
      expect(result.sgdAmount).toBeCloseTo(50000 / 20000, 4); // = $2.50
      expect(result.source).toBe('manual');
    });

    it('setManualRate stores rate in Settings with setAt timestamp', async () => {
      vi.mocked(prisma.settings.upsert).mockResolvedValue({} as any);

      await svc.setManualRate('VND', 20000);

      expect(prisma.settings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'fx_manual_VND' },
          create: expect.objectContaining({ key: 'fx_manual_VND' }),
          update: expect.objectContaining({}),
        }),
      );
    });

    it('clearManualRate deletes the Settings entry', async () => {
      vi.mocked(prisma.settings.delete).mockResolvedValue({} as any);

      await svc.clearManualRate('VND');

      expect(prisma.settings.delete).toHaveBeenCalledWith({
        where: { key: 'fx_manual_VND' },
      });
    });

    it('getManualRate returns null when no override is set', async () => {
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);

      const result = await svc.getManualRate('VND');
      expect(result).toBeNull();
    });
  });

  // ── 6. Stale override warning ─────────────────────────────────────────────
  describe('stale override warning', () => {
    it('isManualRateStale returns true when override is >14 days old', async () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'fx_manual_VND',
        value: JSON.stringify({ rate: 20000, setAt: fifteenDaysAgo.toISOString() }),
        updatedAt: fifteenDaysAgo,
      } as any);

      const stale = await svc.isManualRateStale('VND');
      expect(stale).toBe(true);
    });

    it('isManualRateStale returns false when override is <14 days old', async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      vi.mocked(prisma.settings.findUnique).mockResolvedValue({
        key: 'fx_manual_VND',
        value: JSON.stringify({ rate: 20000, setAt: twoDaysAgo.toISOString() }),
        updatedAt: twoDaysAgo,
      } as any);

      const stale = await svc.isManualRateStale('VND');
      expect(stale).toBe(false);
    });

    it('isManualRateStale returns false when no override is set', async () => {
      vi.mocked(prisma.settings.findUnique).mockResolvedValue(null);
      const stale = await svc.isManualRateStale('VND');
      expect(stale).toBe(false);
    });
  });

  // ── 7. Conversion result shape ────────────────────────────────────────────
  describe('convertToSGD result shape', () => {
    it('always returns { sgdAmount, fxRate, source, originalCurrency }', async () => {
      mockFetch.mockReturnValueOnce(makeApiResponse('SGD', { VND: 20424.75 }));

      const result = await svc.convertToSGD(50000, 'VND');

      expect(result).toMatchObject({
        sgdAmount: expect.any(Number),
        fxRate: expect.any(Number),
        source: expect.stringMatching(/^(live|cached|fallback|manual|sgd)$/),
        originalCurrency: 'VND',
      });
    });

    it('sgdAmount is always > 0 for positive input', async () => {
      mockFetch.mockReturnValueOnce(makeApiResponse('SGD', { MYR: 3.52 }));
      const result = await svc.convertToSGD(150, 'MYR');
      expect(result.sgdAmount).toBeGreaterThan(0);
    });
  });
});

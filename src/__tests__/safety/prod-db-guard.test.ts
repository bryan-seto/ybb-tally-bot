/**
 * TDD: Prod-DB guard tests
 *
 * These tests MUST fail (RED) before the guard is implemented, and MUST pass (GREEN)
 * after vitest.setup.ts + vitest.config.ts wire assertNotLocalDB().
 *
 * Mutation test: temporarily point DATABASE_URL at a remote host and confirm the
 * whole suite refuses to run (i.e. vitest.setup.ts throws before any test executes).
 */
import { describe, it, expect } from 'vitest';
import { assertNotLocalDB } from './prod-db-guard';

describe('assertNotLocalDB()', () => {
  it('passes for localhost', () => {
    expect(() =>
      assertNotLocalDB('postgresql://postgres@localhost:5432/ybb_tally_test')
    ).not.toThrow();
  });

  it('passes for 127.0.0.1', () => {
    expect(() =>
      assertNotLocalDB('postgresql://postgres@127.0.0.1:5432/ybb_tally_test')
    ).not.toThrow();
  });

  it('throws for supabase.com URL', () => {
    expect(() =>
      assertNotLocalDB('postgresql://postgres.abc:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres')
    ).toThrow(/SAFETY.*DATABASE_URL/);
  });

  it('throws for any non-local host', () => {
    expect(() =>
      assertNotLocalDB('postgresql://user:pass@some-remote-db.example.com:5432/db')
    ).toThrow(/SAFETY.*DATABASE_URL/);
  });

  it('throws for empty string (treat unknown as unsafe)', () => {
    expect(() =>
      assertNotLocalDB('')
    ).toThrow(/SAFETY.*DATABASE_URL/);
  });

  it('throws when DATABASE_URL env var points to supabase (integration path)', () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://x:y@pooler.supabase.com:6543/postgres';
    try {
      expect(() => assertNotLocalDB()).toThrow(/SAFETY.*DATABASE_URL/);
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
  });

  it('passes when DATABASE_URL env var is localhost (integration path)', () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://postgres@localhost:5432/ybb_tally_test';
    try {
      expect(() => assertNotLocalDB()).not.toThrow();
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
  });
});

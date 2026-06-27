/**
 * prod-db-guard.ts
 *
 * Shared safety assertion — imported by:
 *   1. vitest.setup.ts  (runs globally before EVERY test; zero per-file imports required)
 *   2. prismaTestSetup.ts  (defense-in-depth, closest to TEST_DATABASE_URL resolution)
 *   3. e2e harness shell script (env-layer guard)
 *
 * Strategy: ALLOWLIST-only (deny-by-default).
 * We require DATABASE_URL to match localhost / 127.0.0.1.
 * Anything else is rejected — including empty string, cloud hosts, staging URLs, etc.
 * This is strictly safer than a denylist (supabase.com substring) because:
 *   - Supabase pooler vs direct hosts differ
 *   - A new staging cloud DB would slip through a denylist
 *   - An empty / malformed URL is also unsafe
 */
export function assertNotLocalDB(url?: string): void {
  const resolved = url ?? process.env.DATABASE_URL ?? '';
  const isLocal = /(?:localhost|127\.0\.0\.1)/.test(resolved);
  if (!isLocal) {
    throw new Error(
      `SAFETY: DATABASE_URL does not point to localhost.\n` +
      `Got: "${resolved.replace(/:\/\/[^@]*@/, '://***@')}"\n` +
      `E2E tests must use TEST_DATABASE_URL → localhost. Refusing to run.\n` +
      `If you are running the test suite, ensure /tmp/ybb_e2e.env is sourced and ` +
      `TEST_DATABASE_URL is set to a local Postgres instance.`
    );
  }
}

/**
 * vitest.setup.ts — global test setup
 *
 * Loaded by vitest before every test file (via vitest.config.ts setupFiles).
 * No import needed in individual test files.
 *
 * PROD-DB GUARD
 * =============
 * Asserts DATABASE_URL points to localhost before any test runs.
 * If DATABASE_URL resolves to a remote/cloud host (e.g. Supabase), the entire
 * suite throws immediately — no tests execute, no fixture rows leak to prod.
 *
 * This is an ALLOWLIST guard (require localhost), not a denylist.
 * Rationale: denylist on "supabase.com" is brittle; allowlist on localhost is robust.
 *
 * MUTATION TEST (manual, run once after this lands):
 *   DATABASE_URL="postgresql://x:y@some-remote.supabase.com:6543/db" \
 *     node node_modules/.bin/vitest run
 *   → Entire suite must refuse with SAFETY error before any test body runs.
 */
import { assertNotLocalDB } from './src/__tests__/safety/prod-db-guard';

assertNotLocalDB();

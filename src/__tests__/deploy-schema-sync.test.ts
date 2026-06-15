/**
 * Guard test: deploy-time schema sync.
 *
 * ROOT CAUSE THIS PREVENTS (2026-06-15 "Error loading dashboard"):
 * The FX feature added `currency`, `originalAmount`, and `fxRate` columns to
 * `prisma/schema.prisma` via `prisma db push` locally, but:
 *   1. No migration was ever generated for them, AND
 *   2. The production start path (`node dist/index.js`) had NO schema-sync step.
 * So the deployed Prisma client expected columns the prod Postgres did not have.
 * Every `transactions` query threw "column does not exist", which the defensive
 * dashboard swallowed into "Balance Status" + "Latest Activity: Unavailable" and
 * ultimately "❌ Error loading dashboard."
 *
 * This is a pure file-read test (no DB, no config import) so it dodges the
 * config.ts import-time trap and runs in the normal suite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');
const pkg = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('deploy schema sync guard', () => {
  it('the production start script syncs the DB schema before launching', () => {
    // The bot must reconcile the live DB with schema.prisma at boot, or a
    // schema change shipped without a matching migration silently breaks every
    // query. `prisma db push` (additive, refuses destructive ops without
    // --accept-data-loss) or `prisma migrate deploy` both satisfy this.
    const start = pkg.scripts.start ?? '';
    const hasSync = /prisma\s+(db\s+push|migrate\s+deploy)/.test(start);
    expect(
      hasSync,
      `package.json "start" must run a Prisma schema-sync step before node. Got: "${start}"`,
    ).toBe(true);
  });

  it('the start script runs the schema sync BEFORE node starts the app', () => {
    const start = pkg.scripts.start ?? '';
    const syncIdx = start.search(/prisma\s+(db\s+push|migrate\s+deploy)/);
    const nodeIdx = start.search(/\bnode\b/);
    expect(syncIdx).toBeGreaterThanOrEqual(0);
    expect(nodeIdx).toBeGreaterThanOrEqual(0);
    expect(
      syncIdx < nodeIdx,
      `schema sync must precede "node" in the start script. Got: "${start}"`,
    ).toBe(true);
  });

  it('prisma CLI is a runtime dependency (Nixpacks prunes devDependencies on deploy)', () => {
    // If `prisma` lives only in devDependencies, the production image prunes it
    // and `prisma db push` at start-time fails with "command not found".
    const inDeps = Boolean(pkg.dependencies?.prisma);
    expect(
      inDeps,
      'prisma must be in "dependencies" so the deploy image keeps the CLI for the start-time schema sync',
    ).toBe(true);
  });
});

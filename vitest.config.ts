import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Global setup file: runs ONCE per worker before any test file is loaded.
    // The prod-DB guard lives here — no per-file import required.
    setupFiles: ['./vitest.setup.ts'],

    // Give each test file its own isolated module context (matches prior behaviour).
    isolate: true,

    // Timeout generous enough for e2e DB operations.
    testTimeout: 30_000,
  },
});

# E2E Tests for Critical Flows

## Setup

These tests require a test PostgreSQL database. Set `TEST_DATABASE_URL` environment variable or the tests will use a derived URL from `DATABASE_URL`.

## Running Tests

```bash
npx vitest run src/__tests__/e2e/critical-flows.test.ts
```

## Current Status

Tests are implemented but some are failing due to database connection issues. The services use the singleton Prisma client from `lib/prisma.ts`, which may be connected to a different database than the test setup.

## Architecture

- **Database**: PostgreSQL (matches production schema)
- **Isolation**: Database cleared between tests
- **Mocks**: AI Service mocked for deterministic responses
- **Time**: Fake timers used for photo batching (10s window)



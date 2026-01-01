import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

// Use test PostgreSQL database URL from env, or use main DB with test suffix
// The schema.prisma uses PostgreSQL provider, so we must use PostgreSQL
export const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL?.replace(/\/[^\/]+$/, '/ybb_tally_test') || 'postgresql://user:password@localhost:5432/ybb_tally_test';

export const prisma = new PrismaClient({
  datasources: {
    db: { url: TEST_DB_URL },
  },
});

export async function setupTestDb() {
  console.log('🛠️  Setting up Test DB...');
  try {
    // 1. Push the schema to the test PostgreSQL database
    // "db push" is faster than migrate for tests and handles prototyping well
    execSync(`npx prisma db push --accept-data-loss`, {
      env: {
        ...process.env,
        DATABASE_URL: TEST_DB_URL
      },
      stdio: 'ignore' // Suppress logs
    });
    console.log('✅ Test DB setup complete');
  } catch (error) {
    console.error('❌ Failed to setup test DB:', error);
    console.error('💡 Tip: Ensure TEST_DATABASE_URL is set or DATABASE_URL points to a valid PostgreSQL instance');
    throw error;
  }
}

export async function clearDb() {
  // Clear data in specific order to respect Foreign Keys for PostgreSQL
  // Using TRUNCATE CASCADE for faster clearing
  
  try {
    // Disable triggers temporarily for faster truncation
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'replica';`);
    
    // Truncate tables in order (respecting foreign keys)
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "transactions" CASCADE;`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "recurring_expenses" CASCADE;`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "system_logs" CASCADE;`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "daily_stats" CASCADE;`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "settings" CASCADE;`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "users" CASCADE;`);
    
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'origin';`);
  } catch (error) {
    console.log(`Error clearing DB:`, error);
    // Fallback: try DELETE if TRUNCATE fails
    try {
      await prisma.transaction.deleteMany();
      await prisma.recurringExpense.deleteMany();
      await prisma.systemLog.deleteMany();
      await prisma.dailyStats.deleteMany();
      await prisma.settings.deleteMany();
      await prisma.user.deleteMany();
    } catch (deleteError) {
      console.error('Fallback delete also failed:', deleteError);
    }
  }
}


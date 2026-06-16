import { prisma } from '../lib/prisma';
import { CONFIG } from '../config';

/**
 * Verify database connection before bot initialization
 * 
 * For local databases (localhost/127.0.0.1), attempts to connect and verify.
 * For remote databases, skips the check (assumes they're accessible).
 * 
 * @throws Exits process with code 1 if local database connection fails
 */
export async function verifyDatabaseConnection(): Promise<void> {
  const dbUrl = CONFIG.DATABASE_URL;
  
  // Check if this is a local database URL
  const isLocalDb = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
  
  if (isLocalDb) {
    console.log('🔍 [DB] Verifying local database connection...');
    try {
      // Quick connection test
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      console.log('✅ [DB] Local database connection verified');
    } catch (error: any) {
      console.error('');
      console.error('❌ LOCAL DB NOT RUNNING');
      console.error('   Run "npm run db:local:up" first.');
      console.error('');
      console.error(`   Error: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log('🔍 [DB] Using remote database (skipping connection check)');
  }
}


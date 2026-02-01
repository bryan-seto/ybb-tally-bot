/**
 * Cleanup Transactions Script
 * 
 * Wipes all transaction history from the database.
 * ⚠️ WARNING: This operation is IRREVERSIBLE. Ensure you have a backup first!
 * 
 * Usage:
 *   export DATABASE_URL="your_production_database_url"
 *   npx tsx scripts/cleanup-transactions.ts
 */

import { prisma } from '../src/lib/prisma';

async function cleanupTransactions(): Promise<void> {
  let connected = false;

  try {
    console.log('🔄 Connecting to database...');
    await prisma.$connect();
    connected = true;
    console.log('✅ Database connected');

    // Count transactions before deletion
    const countBefore = await prisma.transaction.count();
    console.log(`📊 Found ${countBefore} transactions in database`);

    if (countBefore === 0) {
      console.log('ℹ️  No transactions to delete. Database is already clean.');
      return;
    }

    // Delete all transactions
    console.log('🗑️  Deleting all transactions...');
    const result = await prisma.transaction.deleteMany({});
    
    console.log(`\n✅ Cleanup complete!`);
    console.log(`   Deleted ${result.count} transaction(s)`);
    console.log(`\n⚠️  Note: User records were NOT affected (preserved).`);

  } catch (error: any) {
    console.error('\n❌ Cleanup failed:');
    console.error(`   ${error.message}`);
    
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    
    if (error.stack) {
      console.error(`   Stack: ${error.stack}`);
    }
    
    throw error;
  } finally {
    // Always disconnect, even if there was an error
    if (connected) {
      try {
        await prisma.$disconnect();
        console.log('✅ Disconnected from database');
      } catch (disconnectError: any) {
        console.error('⚠️  Warning: Error disconnecting from database:', disconnectError.message);
      }
    }
  }
}

// Run the script
cleanupTransactions()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Cleanup script failed. Please review the error messages above.');
    process.exit(1);
  });

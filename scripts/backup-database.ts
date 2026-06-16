/**
 * Database Backup Script (JSON Format)
 * 
 * Creates a JSON backup of User and Transaction data from the production database.
 * 
 * Usage:
 *   export DATABASE_URL="your_production_database_url"
 *   npx tsx scripts/backup-database.ts
 */

import { prisma } from '../src/lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

async function backupDatabase(): Promise<void> {
  let connected = false;

  try {
    console.log('🔄 Connecting to database...');
    await prisma.$connect();
    connected = true;
    console.log('✅ Database connected');

    // Fetch all users
    console.log('📥 Fetching users...');
    const users = await prisma.user.findMany();
    console.log(`   Found ${users.length} users`);

    // Fetch all transactions
    console.log('📥 Fetching transactions...');
    const transactions = await prisma.transaction.findMany();
    console.log(`   Found ${transactions.length} transactions`);

    // Prepare backup data
    const backupData = {
      timestamp: new Date().toISOString(),
      users: users.map(user => ({
        id: user.id.toString(),
        name: user.name,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      })),
      transactions: transactions.map(tx => ({
        id: tx.id.toString(),
        amountSGD: tx.amountSGD,
        currency: tx.currency,
        category: tx.category,
        description: tx.description,
        payerId: tx.payerId.toString(),
        date: tx.date.toISOString(),
        isSettled: tx.isSettled,
        splitType: tx.splitType,
        bryanPercentage: tx.bryanPercentage,
        hweiYeenPercentage: tx.hweiYeenPercentage,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),
      })),
    };

    // Ensure backups directory exists
    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(`📁 Created backup directory: ${backupDir}`);
    }

    // Generate timestamp for filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup_${timestamp}.json`);

    // Write backup to file
    console.log('💾 Writing backup to file...');
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

    // Get file size
    const fileSize = fs.statSync(backupFile).size;
    const fileSizeKB = (fileSize / 1024).toFixed(2);
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

    console.log('\n✅ Backup created successfully!');
    console.log(`   File: ${backupFile}`);
    console.log(`   Size: ${fileSizeKB} KB (${fileSizeMB} MB)`);
    console.log(`   Users: ${users.length}`);
    console.log(`   Transactions: ${transactions.length}`);
    console.log(`\n⚠️  IMPORTANT: Store this backup in a secure location!`);
    console.log(`   Do NOT commit backup files to git.`);

  } catch (error: any) {
    console.error('\n❌ Backup failed:');
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
backupDatabase()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Backup script failed. Please review the error messages above.');
    process.exit(1);
  });

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function backupDatabase() {
  console.log('📦 Starting database backup...\n');

  try {
    // Fetch all data
    const [users, transactions, recurringExpenses, settings, systemLogs, dailyStats, sessions] = await Promise.all([
      prisma.user.findMany(),
      prisma.transaction.findMany({ include: { payer: true } }),
      prisma.recurringExpense.findMany({ include: { payer: true } }),
      prisma.settings.findMany(),
      prisma.systemLog.findMany(),
      prisma.dailyStats.findMany(),
      prisma.session.findMany(),
    ]);

    const backup = {
      timestamp: new Date().toISOString(),
      databaseUrl: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@'), // Hide password
      data: {
        users,
        transactions,
        recurringExpenses,
        settings,
        systemLogs,
        dailyStats,
        sessions,
      },
      stats: {
        users: users.length,
        transactions: transactions.length,
        recurringExpenses: recurringExpenses.length,
        settings: settings.length,
        systemLogs: systemLogs.length,
        dailyStats: dailyStats.length,
        sessions: sessions.length,
      },
    };

    // Create backups directory if it doesn't exist
    const backupsDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    // Save to file
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `prod-backup-${timestamp}.json`;
    const filepath = path.join(backupsDir, filename);

    // Custom JSON serializer to handle BigInt
    const jsonString = JSON.stringify(backup, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2);
    
    fs.writeFileSync(filepath, jsonString);

    console.log('✅ Backup completed successfully!\n');
    console.log(`📁 Backup saved to: ${filepath}`);
    console.log(`📊 Backup statistics:`);
    console.log(`   - Users: ${backup.stats.users}`);
    console.log(`   - Transactions: ${backup.stats.transactions}`);
    console.log(`   - Recurring Expenses: ${backup.stats.recurringExpenses}`);
    console.log(`   - Settings: ${backup.stats.settings}`);
    console.log(`   - System Logs: ${backup.stats.systemLogs}`);
    console.log(`   - Daily Stats: ${backup.stats.dailyStats}`);
    console.log(`   - Sessions: ${backup.stats.sessions}`);

    const fileSizeKB = (fs.statSync(filepath).size / 1024).toFixed(2);
    console.log(`\n💾 File size: ${fileSizeKB} KB\n`);

    return filepath;
  } catch (error) {
    console.error('❌ Backup failed:', error);
    throw error;
  }
}

async function main() {
  try {
    await backupDatabase();
  } catch (error: any) {
    console.error('💥 Backup process failed:', error.message || error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();


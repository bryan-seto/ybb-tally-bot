import { Telegraf } from 'telegraf';
import { BackupService } from './services/backupService';
import { CONFIG, USER_IDS } from './config';
import { prisma } from './lib/prisma';

async function testBackup() {
  console.log('🔄 Starting manual backup test...');
  
  if (!CONFIG.TELEGRAM_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is missing in .env');
    return;
  }

  const backupService = new BackupService();
  const bot = new Telegraf(CONFIG.TELEGRAM_TOKEN);
  const userId = Number(USER_IDS.BRYAN);

  try {
    console.log(`📦 Generating backup for user ${userId}...`);
    const sql = await backupService.generateSQLBackup();
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `manual_test_backup_${dateStr}_${Date.now()}.sql`;
    const buffer = Buffer.from(sql);

    const message = `🧪 <b>Manual Test Backup</b>\n\n` +
      `This is a test of the backup system you just implemented.\n\n` +
      `✅ <b>Backup generated successfully</b>\n` +
      `📊 <b>Tables:</b> transactions, users, recurring_expenses, settings\n\n` +
      `🔧 <b>How to Restore in Supabase:</b>\n` +
      `1. Open Supabase Dashboard → SQL Editor\n` +
      `2. Paste the contents of this file\n` +
      `3. Click "Run"`;

    await bot.telegram.sendDocument(userId, { source: buffer, filename }, {
      caption: message,
      parse_mode: 'HTML'
    });
    
    console.log('✅ Backup file sent to Telegram!');
  } catch (error) {
    console.error('❌ Error during backup test:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

testBackup();


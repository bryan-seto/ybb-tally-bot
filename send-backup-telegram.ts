import { Telegraf } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { prisma } from './src/lib/prisma';

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in .env');
  process.exit(1);
}

const bot = new Telegraf(TELEGRAM_TOKEN);

async function sendBackup() {
  try {
    console.log('📤 Sending backup file via Telegram...\n');

    // Get the primary group chat ID from settings
    const groupSetting = await prisma.settings.findUnique({
      where: { key: 'primary_group_id' }
    });

    if (!groupSetting) {
      console.error('❌ No primary_group_id found in settings. Please use /start in your Telegram group first.');
      process.exit(1);
    }

    const chatId = groupSetting.value;
    console.log(`📱 Sending to chat ID: ${chatId}\n`);

    // Find the most recent backup file
    const backupsDir = path.join(__dirname, 'backups');
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('prod-backup-') && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(backupsDir, f),
        time: fs.statSync(path.join(backupsDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length === 0) {
      console.error('❌ No backup files found');
      process.exit(1);
    }

    const latestBackup = files[0];
    console.log(`📁 Found backup: ${latestBackup.name}`);
    
    const fileSize = fs.statSync(latestBackup.path).size;
    const fileSizeKB = (fileSize / 1024).toFixed(2);
    console.log(`💾 File size: ${fileSizeKB} KB`);

    // Read the backup to get stats
    const backupData = JSON.parse(fs.readFileSync(latestBackup.path, 'utf-8'));
    
    const caption = `🗄️ **Production Database Backup**\n\n` +
      `📅 Date: ${new Date(backupData.timestamp).toLocaleString()}\n` +
      `📊 Stats:\n` +
      `  • Users: ${backupData.stats.users}\n` +
      `  • Transactions: ${backupData.stats.transactions}\n` +
      `  • Recurring: ${backupData.stats.recurringExpenses}\n` +
      `  • Logs: ${backupData.stats.systemLogs}\n\n` +
      `💾 Size: ${fileSizeKB} KB\n\n` +
      `✅ Backup created before cleanup`;

    // Send the file
    await bot.telegram.sendDocument(
      chatId,
      { source: latestBackup.path, filename: latestBackup.name },
      { caption, parse_mode: 'Markdown' }
    );

    console.log(`✅ Backup sent successfully to chat ${chatId}!`);
    console.log('📱 Check your Telegram group for the file.');

  } catch (error: any) {
    console.error('❌ Failed to send backup:', error.message);
    throw error;
  }
}

async function main() {
  try {
    await sendBackup();
  } catch (error) {
    console.error('💥 Script failed:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();


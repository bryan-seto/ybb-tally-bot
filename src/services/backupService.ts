import { prisma } from '../lib/prisma';
import { formatDate } from '../utils/dateHelpers';

export class BackupService {
  /**
   * Generates a SQL backup of critical tables in a format suitable for Supabase SQL Editor
   */
  async generateSQLBackup(): Promise<string> {
    const timestamp = new Date().toISOString();
    let sql = `-- YBB Tally Bot Database Backup\n`;
    sql += `-- Generated at: ${timestamp}\n`;
    sql += `-- Tables: users, transactions, recurring_expenses, settings\n\n`;
    sql += `BEGIN;\n\n`;

    // 1. Backup Users
    sql += `-- Backup Table: users\n`;
    const users = await prisma.user.findMany();
    for (const user of users) {
      sql += `INSERT INTO users (id, name, role, "createdAt", "updatedAt") \n`;
      sql += `VALUES (${user.id}, '${user.name.replace(/'/g, "''")}', '${user.role}', '${user.createdAt.toISOString()}', '${user.updatedAt.toISOString()}') \n`;
      sql += `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, "updatedAt" = EXCLUDED."updatedAt";\n`;
    }
    sql += `\n`;

    // 2. Backup Settings
    sql += `-- Backup Table: settings\n`;
    const settings = await prisma.settings.findMany();
    for (const setting of settings) {
      sql += `INSERT INTO settings (key, value, "updatedAt") \n`;
      sql += `VALUES ('${setting.key}', '${setting.value.replace(/'/g, "''")}', '${setting.updatedAt.toISOString()}') \n`;
      sql += `ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = EXCLUDED."updatedAt";\n`;
    }
    sql += `\n`;

    // 3. Backup Recurring Expenses
    sql += `-- Backup Table: recurring_expenses\n`;
    const recurringExpenses = await prisma.recurringExpense.findMany();
    for (const re of recurringExpenses) {
      sql += `INSERT INTO recurring_expenses (id, description, "amountOriginal", "payerId", "dayOfMonth", "isActive", "createdAt", "updatedAt") \n`;
      sql += `VALUES (${re.id}, '${re.description.replace(/'/g, "''")}', ${re.amountOriginal}, ${re.payerId}, ${re.dayOfMonth}, ${re.isActive}, '${re.createdAt.toISOString()}', '${re.updatedAt.toISOString()}') \n`;
      sql += `ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description, "amountOriginal" = EXCLUDED."amountOriginal", "payerId" = EXCLUDED."payerId", "dayOfMonth" = EXCLUDED."dayOfMonth", "isActive" = EXCLUDED."isActive", "updatedAt" = EXCLUDED."updatedAt";\n`;
    }
    sql += `\n`;

    // 4. Backup Transactions
    sql += `-- Backup Table: transactions\n`;
    const transactions = await prisma.transaction.findMany();
    for (const tx of transactions) {
      const bryanPct = tx.bryanPercentage !== null ? tx.bryanPercentage : 'NULL';
      const hyPct = tx.hweiYeenPercentage !== null ? tx.hweiYeenPercentage : 'NULL';
      const category = tx.category ? `'${tx.category.replace(/'/g, "''")}'` : 'NULL';
      const description = tx.description ? `'${tx.description.replace(/'/g, "''")}'` : 'NULL';

      sql += `INSERT INTO transactions (id, "amountSGD", currency, category, description, "payerId", date, "isSettled", "splitType", "bryanPercentage", "hweiYeenPercentage", "createdAt", "updatedAt") \n`;
      sql += `VALUES (${tx.id}, ${tx.amountSGD}, '${tx.currency}', ${category}, ${description}, ${tx.payerId}, '${tx.date.toISOString()}', ${tx.isSettled}, '${tx.splitType}', ${bryanPct}, ${hyPct}, '${tx.createdAt.toISOString()}', '${tx.updatedAt.toISOString()}') \n`;
      sql += `ON CONFLICT (id) DO UPDATE SET "amountSGD" = EXCLUDED."amountSGD", currency = EXCLUDED.currency, category = EXCLUDED.category, description = EXCLUDED.description, "payerId" = EXCLUDED."payerId", date = EXCLUDED.date, "isSettled" = EXCLUDED."isSettled", "splitType" = EXCLUDED."splitType", "bryanPercentage" = EXCLUDED."bryanPercentage", "hweiYeenPercentage" = EXCLUDED."hweiYeenPercentage", "updatedAt" = EXCLUDED."updatedAt";\n`;
    }

    sql += `\nCOMMIT;\n`;
    return sql;
  }
}


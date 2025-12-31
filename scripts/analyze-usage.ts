import { PrismaClient } from '@prisma/client';
import { subDays, format } from 'date-fns';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { prisma } from '../src/lib/prisma';
import { USER_IDS, USER_NAMES } from '../src/config';

// Zod Schema for SystemLog metadata validation
const LogMetadataSchema = z.object({
  command: z.string().optional(),
  args: z.union([z.array(z.any()), z.string()]).optional(),
  changes: z.union([z.array(z.any()), z.record(z.string(), z.any())]).optional(),
  transactionId: z.union([z.string(), z.number(), z.bigint()]).optional(),
  success: z.boolean().optional(),
  latencyMs: z.number().optional(),
  errorMsg: z.string().optional(),
  usedModel: z.string().optional(),
  chatType: z.string().optional(),
  isValid: z.boolean().optional(),
}).passthrough(); // Allow extra fields for inconsistent historical data

interface ProcessedLog {
  id: bigint;
  event: string;
  metadata: z.infer<typeof LogMetadataSchema>;
  timestamp: Date;
  userId: bigint | null;
  transactionId: bigint | null;
}

interface TransactionContext {
  id: bigint;
  amountSGD: number;
  isSettled: boolean;
  createdAt: Date;
}

interface UserStats {
  name: string;
  totalActions: number;
  receiptProcessed: number;
  updateEvents: number;
  failedReceipts: number;
}

interface TransactionFriction {
  transactionId: bigint;
  updateCount: number;
  updateTypes: string[];
  firstUpdateTime: Date | null;
  receiptProcessedTime: Date | null;
}

async function main() {
  console.log('🔍 Starting usage analysis...\n');

  try {
    // Calculate 90 days ago
    const ninetyDaysAgo = subDays(new Date(), 90);
    console.log(`📅 Analyzing data from ${ninetyDaysAgo.toISOString()} onwards\n`);

    // Query 1: Fetch SystemLog entries from last 90 days
    console.log('📊 Fetching SystemLog entries...');
    const logs = await prisma.systemLog.findMany({
      where: {
        timestamp: {
          gte: ninetyDaysAgo,
        },
      },
      select: {
        id: true,
        event: true,
        metadata: true,
        timestamp: true,
        userId: true,
      },
      orderBy: {
        timestamp: 'asc',
      },
    });
    console.log(`   Found ${logs.length} log entries\n`);

    // Query 2: Fetch Transaction entries from last 90 days for context
    console.log('💳 Fetching Transaction entries...');
    const transactions = await prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: ninetyDaysAgo,
        },
      },
      select: {
        id: true,
        amountSGD: true,
        isSettled: true,
        createdAt: true,
      },
    });
    console.log(`   Found ${transactions.length} transactions\n`);

    // Process logs with safe parsing
    console.log('🔧 Processing logs with Zod validation...');
    const processedLogs: ProcessedLog[] = [];
    let parseErrors = 0;

    for (const log of logs) {
      const parseResult = LogMetadataSchema.safeParse(log.metadata);
      
      if (!parseResult.success) {
        parseErrors++;
        console.warn(`   ⚠️  Failed to parse metadata for log ${log.id}:`, parseResult.error.message);
        continue;
      }

      // Extract transactionId from metadata
      let transactionId: bigint | null = null;
      if (parseResult.data.transactionId !== undefined) {
        try {
          transactionId = BigInt(parseResult.data.transactionId);
        } catch {
          // Invalid transactionId format, skip
        }
      }

      processedLogs.push({
        id: log.id,
        event: log.event,
        metadata: parseResult.data,
        timestamp: log.timestamp,
        userId: log.userId,
        transactionId,
      });
    }

    if (parseErrors > 0) {
      console.log(`   ⚠️  ${parseErrors} log entries failed parsing (discarded)\n`);
    }
    console.log(`   ✅ Processed ${processedLogs.length} valid log entries\n`);

    // Group by Transaction
    console.log('📦 Grouping logs by transaction...');
    const logsByTransaction = new Map<bigint, ProcessedLog[]>();
    for (const log of processedLogs) {
      if (log.transactionId !== null) {
        const existing = logsByTransaction.get(log.transactionId) || [];
        existing.push(log);
        logsByTransaction.set(log.transactionId, existing);
      }
    }
    console.log(`   Found ${logsByTransaction.size} transactions with logs\n`);

    // Group by User
    console.log('👥 Grouping logs by user...');
    const logsByUser = new Map<string, ProcessedLog[]>();
    const userStats = new Map<string, UserStats>();

    for (const log of processedLogs) {
      const userIdStr = log.userId?.toString() || 'unknown';
      const userName = USER_NAMES[userIdStr] || `User-${userIdStr}`;
      
      const existing = logsByUser.get(userName) || [];
      existing.push(log);
      logsByUser.set(userName, existing);

      // Initialize user stats if needed
      if (!userStats.has(userName)) {
        userStats.set(userName, {
          name: userName,
          totalActions: 0,
          receiptProcessed: 0,
          updateEvents: 0,
          failedReceipts: 0,
        });
      }

      const stats = userStats.get(userName)!;
      stats.totalActions++;

      if (log.event === 'receipt_processed') {
        stats.receiptProcessed++;
        if (log.metadata.success === false) {
          stats.failedReceipts++;
        }
      }

      if (log.event.startsWith('UPDATE_')) {
        stats.updateEvents++;
      }
    }
    console.log(`   Found activity from ${userStats.size} users\n`);

    // Calculate Friction Scores
    console.log('📈 Calculating friction scores...');
    const transactionFriction = new Map<bigint, TransactionFriction>();
    const updateEventCounts = new Map<string, number>();

    for (const [transactionId, transactionLogs] of logsByTransaction.entries()) {
      const updateEvents = transactionLogs.filter(log => log.event.startsWith('UPDATE_'));
      const receiptProcessed = transactionLogs.find(log => log.event === 'receipt_processed');
      
      if (updateEvents.length > 0) {
        const updateTypes = updateEvents.map(log => log.event);
        updateTypes.forEach(type => {
          updateEventCounts.set(type, (updateEventCounts.get(type) || 0) + 1);
        });

        transactionFriction.set(transactionId, {
          transactionId,
          updateCount: updateEvents.length,
          updateTypes,
          firstUpdateTime: updateEvents[0]?.timestamp || null,
          receiptProcessedTime: receiptProcessed?.timestamp || null,
        });
      }
    }

    const highFrictionTransactions = Array.from(transactionFriction.values())
      .filter(tf => tf.updateCount > 2);

    console.log(`   Found ${transactionFriction.size} transactions with corrections`);
    console.log(`   Found ${highFrictionTransactions.length} high-friction transactions (>2 updates)\n`);

    // Calculate Metrics
    console.log('📊 Calculating metrics...');
    
    const totalReceiptProcessed = processedLogs.filter(log => log.event === 'receipt_processed').length;
    const totalUpdateEvents = processedLogs.filter(log => log.event.startsWith('UPDATE_')).length;
    const failedReceipts = processedLogs.filter(
      log => log.event === 'receipt_processed' && log.metadata.success === false
    ).length;

    const manualInterventionRate = totalReceiptProcessed > 0
      ? (totalUpdateEvents / totalReceiptProcessed) * 100
      : 0;

    const failedReceiptRate = totalReceiptProcessed > 0
      ? (failedReceipts / totalReceiptProcessed) * 100
      : 0;

    // Calculate average time to first correction
    const timeToCorrection: number[] = [];
    for (const friction of transactionFriction.values()) {
      if (friction.receiptProcessedTime && friction.firstUpdateTime) {
        const delta = friction.firstUpdateTime.getTime() - friction.receiptProcessedTime.getTime();
        if (delta > 0) {
          timeToCorrection.push(delta);
        }
      }
    }
    const avgTimeToCorrection = timeToCorrection.length > 0
      ? timeToCorrection.reduce((a, b) => a + b, 0) / timeToCorrection.length
      : 0;

    // Find most frequent UPDATE type
    const mostFrequentUpdate = Array.from(updateEventCounts.entries())
      .sort((a, b) => b[1] - a[1])[0];

    console.log('   ✅ Metrics calculated\n');

    // Generate Report
    console.log('📝 Generating report...');
    const report = generateMarkdownReport({
      totalLogs: processedLogs.length,
      totalTransactions: transactions.length,
      userStats: Array.from(userStats.values()),
      transactionFriction: Array.from(transactionFriction.values()),
      highFrictionTransactions,
      metrics: {
        totalReceiptProcessed,
        totalUpdateEvents,
        failedReceipts,
        manualInterventionRate,
        failedReceiptRate,
        avgTimeToCorrection,
        mostFrequentUpdate: mostFrequentUpdate ? {
          type: mostFrequentUpdate[0],
          count: mostFrequentUpdate[1],
        } : null,
        updateEventCounts: Array.from(updateEventCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5),
      },
    });

    // Create reports directory and write to dated file
    const reportsDir = join(process.cwd(), 'reports');
    await mkdir(reportsDir, { recursive: true });
    
    const now = new Date();
    const dateStr = format(now, 'yyyy-MM-dd_HH-mm-ss');
    const filename = `usage-analysis_${dateStr}.md`;
    const filepath = join(reportsDir, filename);
    
    await writeFile(filepath, report, 'utf-8');
    console.log(`   ✅ Report written to ${filepath}\n`);

    // Console summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 ANALYSIS SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`Total Log Entries: ${processedLogs.length}`);
    console.log(`Total Transactions: ${transactions.length}`);
    console.log(`\n👥 User Activity:`);
    for (const stats of Array.from(userStats.values())) {
      console.log(`   ${stats.name}: ${stats.totalActions} actions`);
    }
    console.log(`\n📈 Key Metrics:`);
    console.log(`   Manual Intervention Rate: ${manualInterventionRate.toFixed(2)}%`);
    console.log(`   Failed Receipt Rate: ${failedReceiptRate.toFixed(2)}%`);
    console.log(`   High Friction Transactions: ${highFrictionTransactions.length}`);
    if (mostFrequentUpdate) {
      console.log(`   Most Frequent Update: ${mostFrequentUpdate[0]} (${mostFrequentUpdate[1]} times)`);
    }
    if (avgTimeToCorrection > 0) {
      const minutes = Math.round(avgTimeToCorrection / 1000 / 60);
      console.log(`   Avg Time to First Correction: ${minutes} minutes`);
    }
    console.log(`\n📄 Full Report: ${filepath}`);
    console.log('\n═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error during analysis:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

function generateMarkdownReport(data: {
  totalLogs: number;
  totalTransactions: number;
  userStats: UserStats[];
  transactionFriction: TransactionFriction[];
  highFrictionTransactions: TransactionFriction[];
  metrics: {
    totalReceiptProcessed: number;
    totalUpdateEvents: number;
    failedReceipts: number;
    manualInterventionRate: number;
    failedReceiptRate: number;
    avgTimeToCorrection: number;
    mostFrequentUpdate: { type: string; count: number } | null;
    updateEventCounts: [string, number][];
  };
}): string {
  const { totalLogs, totalTransactions, userStats, highFrictionTransactions, metrics } = data;

  // Calculate pain points
  const painPoints = [
    {
      title: 'High Manual Intervention Rate',
      description: `${metrics.manualInterventionRate.toFixed(2)}% of receipts require manual corrections`,
      severity: metrics.manualInterventionRate > 30 ? 'HIGH' : metrics.manualInterventionRate > 15 ? 'MEDIUM' : 'LOW',
      affectedUsers: userStats.map(s => s.name).join(', '),
    },
    {
      title: 'Failed Receipt Processing',
      description: `${metrics.failedReceiptRate.toFixed(2)}% of receipt processing attempts fail`,
      severity: metrics.failedReceiptRate > 10 ? 'HIGH' : metrics.failedReceiptRate > 5 ? 'MEDIUM' : 'LOW',
      affectedUsers: userStats.map(s => s.name).join(', '),
    },
    {
      title: 'High Friction Transactions',
      description: `${highFrictionTransactions.length} transactions required more than 2 corrections`,
      severity: highFrictionTransactions.length > 10 ? 'HIGH' : highFrictionTransactions.length > 5 ? 'MEDIUM' : 'LOW',
      affectedUsers: userStats.map(s => s.name).join(', '),
    },
  ].sort((a, b) => {
    const severityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return severityOrder[b.severity as keyof typeof severityOrder] - severityOrder[a.severity as keyof typeof severityOrder];
  });

  let report = `# Usage Analysis Report\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Analysis Period:** Last 90 days\n\n`;

  report += `## Executive Summary\n\n`;
  report += `- **Total Log Entries:** ${totalLogs}\n`;
  report += `- **Total Transactions:** ${totalTransactions}\n`;
  report += `- **Receipts Processed:** ${metrics.totalReceiptProcessed}\n`;
  report += `- **Manual Corrections:** ${metrics.totalUpdateEvents}\n`;
  report += `- **Manual Intervention Rate:** ${metrics.manualInterventionRate.toFixed(2)}%\n`;
  report += `- **Failed Receipt Rate:** ${metrics.failedReceiptRate.toFixed(2)}%\n\n`;

  report += `## Top 3 Pain Points\n\n`;
  painPoints.slice(0, 3).forEach((point, index) => {
    report += `### ${index + 1}. ${point.title}\n\n`;
    report += `- **Severity:** ${point.severity}\n`;
    report += `- **Description:** ${point.description}\n`;
    report += `- **Affected Users:** ${point.affectedUsers}\n\n`;
  });

  report += `## User Activity Breakdown\n\n`;
  for (const stats of userStats) {
    report += `### ${stats.name}\n\n`;
    report += `- **Total Actions:** ${stats.totalActions}\n`;
    report += `- **Receipts Processed:** ${stats.receiptProcessed}\n`;
    report += `- **Update Events:** ${stats.updateEvents}\n`;
    report += `- **Failed Receipts:** ${stats.failedReceipts}\n`;
    if (stats.receiptProcessed > 0) {
      const userInterventionRate = (stats.updateEvents / stats.receiptProcessed) * 100;
      report += `- **Personal Intervention Rate:** ${userInterventionRate.toFixed(2)}%\n`;
    }
    report += `\n`;
  }

  report += `## Correction Patterns\n\n`;
  report += `### Most Frequent Update Types\n\n`;
  if (metrics.updateEventCounts.length > 0) {
    report += `| Update Type | Count |\n`;
    report += `|------------|-------|\n`;
    for (const [type, count] of metrics.updateEventCounts) {
      report += `| ${type} | ${count} |\n`;
    }
    report += `\n`;
  } else {
    report += `No update events found.\n\n`;
  }

  if (metrics.mostFrequentUpdate) {
    report += `**Most Frequent:** ${metrics.mostFrequentUpdate.type} (${metrics.mostFrequentUpdate.count} occurrences)\n\n`;
  }

  if (metrics.avgTimeToCorrection > 0) {
    const minutes = Math.round(metrics.avgTimeToCorrection / 1000 / 60);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    report += `### Time to Correction\n\n`;
    report += `- **Average Time to First Correction:** ${hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`}\n\n`;
  }

  report += `## High Friction Transactions\n\n`;
  if (highFrictionTransactions.length > 0) {
    report += `Found ${highFrictionTransactions.length} transactions requiring more than 2 corrections:\n\n`;
    report += `| Transaction ID | Update Count | Update Types |\n`;
    report += `|---------------|--------------|--------------|\n`;
    for (const friction of highFrictionTransactions.slice(0, 20)) {
      report += `| ${friction.transactionId} | ${friction.updateCount} | ${friction.updateTypes.join(', ')} |\n`;
    }
    if (highFrictionTransactions.length > 20) {
      report += `\n*... and ${highFrictionTransactions.length - 20} more*\n`;
    }
    report += `\n`;
  } else {
    report += `No high-friction transactions found (all transactions had ≤2 corrections).\n\n`;
  }

  report += `## Recommendations\n\n`;
  if (metrics.manualInterventionRate > 30) {
    report += `- ⚠️ **High manual intervention rate detected.** Consider improving AI extraction accuracy.\n`;
  }
  if (metrics.failedReceiptRate > 10) {
    report += `- ⚠️ **High failure rate detected.** Review AI service reliability and error handling.\n`;
  }
  if (highFrictionTransactions.length > 10) {
    report += `- ⚠️ **Many high-friction transactions.** Consider streamlining the correction workflow.\n`;
  }
  if (metrics.mostFrequentUpdate) {
    report += `- 📝 **Focus on ${metrics.mostFrequentUpdate.type}.** This is the most common correction type.\n`;
  }
  if (painPoints.length === 0 || painPoints.every(p => p.severity === 'LOW')) {
    report += `- ✅ **System appears to be performing well.** Continue monitoring.\n`;
  }

  return report;
}

// Run the analysis
main().catch(console.error);


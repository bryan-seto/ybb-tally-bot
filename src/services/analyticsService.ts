import { prisma } from '../lib/prisma';
import { getStartOfDay, getEndOfDay, getDaysAgo, getHour, getNow } from '../utils/dateHelpers';

export class AnalyticsService {
  /**
   * Calculate daily statistics for a specific date and upsert to database
   * @param date - The date to calculate stats for
   */
  async calculateDailyStats(date: Date): Promise<void> {
    const startOfDay = getStartOfDay(date);
    const endOfDay = getEndOfDay(date);
    const sevenDaysAgo = getDaysAgo(7, date);

    // Fetch system logs for the day
    const systemLogs = await prisma.systemLog.findMany({
      where: {
        timestamp: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    // Calculate DAU (distinct active users) from command_used events
    const commandUsers = new Set<bigint>();
    let receiptsProcessed = 0;
    const latencies: number[] = [];
    const hourCounts: { [hour: number]: number } = {};

    systemLogs.forEach((log) => {
      if (log.event === 'command_used' && log.userId) {
        commandUsers.add(log.userId);
      }
      if (log.event === 'receipt_processed') {
        receiptsProcessed++;
        if (log.metadata && typeof log.metadata === 'object' && log.metadata !== null) {
          const metadata = log.metadata as { latencyMs?: number };
          if (typeof metadata.latencyMs === 'number') {
            latencies.push(metadata.latencyMs);
          }
        }
      }
      // Count events by hour for peak hour calculation
      const hour = getHour(log.timestamp);
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    const dau = commandUsers.size;
    const avgLatencyMs = latencies.length > 0
      ? Math.round(latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length)
      : 0;

    // Find peak hour (hour with most events)
    let peakHour: number | null = null;
    let maxCount = 0;
    for (const [hour, count] of Object.entries(hourCounts)) {
      if (count > maxCount) {
        maxCount = count;
        peakHour = parseInt(hour, 10);
      }
    }

    // Fetch daily transactions
    const dailyTransactions = await prisma.transaction.findMany({
      where: {
        date: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    const totalSpend = dailyTransactions.reduce((sum, t) => sum + t.amountSGD, 0);

    // Fetch 7-day transactions for velocity calculation
    const sevenDayTransactions = await prisma.transaction.findMany({
      where: {
        date: {
          gte: sevenDaysAgo,
          lte: endOfDay,
        },
      },
    });

    const sevenDayTotal = sevenDayTransactions.reduce((sum, t) => sum + t.amountSGD, 0);
    const spendVelocity7DayAvg = sevenDayTotal / 7;

    // Upsert daily stats
    await prisma.dailyStats.upsert({
      where: { date: startOfDay },
      update: {
        dau,
        receiptsProcessed,
        totalSpend,
        avgLatencyMs,
        peakHour,
        spendVelocity7DayAvg,
      },
      create: {
        date: startOfDay,
        dau,
        receiptsProcessed,
        totalSpend,
        avgLatencyMs,
        peakHour,
        spendVelocity7DayAvg,
      },
    });
  }

  /**
   * Get admin statistics summary
   * @returns Formatted string with admin statistics
   */
  async getAdminStats(): Promise<string> {
    const now = getNow();
    const sevenDaysAgo = getDaysAgo(7, now);

    // Fetch recent daily stats (last 7 days)
    const recentStats = await prisma.dailyStats.findMany({
      where: {
        date: {
          gte: sevenDaysAgo,
          lte: now,
        },
      },
      orderBy: {
        date: 'desc',
      },
    });

    // Calculate totals from recent stats
    const totalReceipts = recentStats.reduce((sum, stat) => sum + stat.receiptsProcessed, 0);
    const totalSpend = recentStats.reduce((sum, stat) => sum + stat.totalSpend, 0);
    const avgLatency = recentStats.length > 0
      ? Math.round(recentStats.reduce((sum, stat) => sum + stat.avgLatencyMs, 0) / recentStats.length)
      : 0;

    // Fetch current system logs and transactions for additional context
    const recentLogs = await prisma.systemLog.findMany({
      where: {
        timestamp: {
          gte: sevenDaysAgo,
        },
      },
    });

    const recentTransactions = await prisma.transaction.findMany({
      where: {
        date: {
          gte: sevenDaysAgo,
        },
      },
    });

    // Build summary string
    let summary = '📊 **Admin Statistics**\n\n';
    summary += `**Last 7 Days:**\n`;
    summary += `• Receipts Processed: ${totalReceipts}\n`;
    summary += `• Total Spend: SGD $${totalSpend.toFixed(2)}\n`;
    summary += `• Average Latency: ${avgLatency}ms\n`;
    summary += `• Total Transactions: ${recentTransactions.length}\n`;
    summary += `• System Events: ${recentLogs.length}\n`;

    if (recentStats.length > 0) {
      const latestStat = recentStats[0];
      summary += `\n**Latest Daily Stats:**\n`;
      summary += `• DAU: ${latestStat.dau}\n`;
      summary += `• Peak Hour: ${latestStat.peakHour ?? 'N/A'}\n`;
      summary += `• 7-Day Avg Spend Velocity: SGD $${latestStat.spendVelocity7DayAvg.toFixed(2)}/day\n`;
    }

    return summary;
  }
}


import { PrismaClient } from '@prisma/client';
import {
  getStartOfDay,
  getEndOfDay,
  getDaysAgo,
  getHour,
  getNow,
} from '../utils/dateHelpers';

const prisma = new PrismaClient();

export class AnalyticsService {
  /**
   * Calculate and save daily stats for a given date
   */
  async calculateDailyStats(date: Date = getDaysAgo(1)): Promise<void> {
    const start = getStartOfDay(date);
    const end = getEndOfDay(date);

    // Get all logs for the day
    const logs = await prisma.systemLog.findMany({
      where: {
        timestamp: {
          gte: start,
          lte: end,
        },
      },
    });

    // Calculate DAU (unique userIds)
    const uniqueUserIds = new Set(
      logs.filter((log) => log.userId).map((log) => log.userId!.toString())
    );
    const dau = uniqueUserIds.size;

    // Count receipts processed
    const receiptsProcessed = logs.filter(
      (log) => log.event === 'receipt_processed' && log.metadata && (log.metadata as any).success === true
    ).length;

    // Calculate average latency
    const receiptLogs = logs.filter(
      (log) => log.event === 'receipt_processed' && log.metadata && (log.metadata as any).latencyMs
    );
    const avgLatencyMs =
      receiptLogs.length > 0
        ? Math.round(
            receiptLogs.reduce(
              (sum, log) => sum + ((log.metadata as any).latencyMs || 0),
              0
            ) / receiptLogs.length
          )
        : 0;

    // Calculate peak hour (hour with most interactions)
    const hourCounts: { [key: number]: number } = {};
    logs.forEach((log) => {
      const hour = getHour(log.timestamp);
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    const peakHour =
      Object.keys(hourCounts).length > 0
        ? parseInt(
            Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0]
          )
        : null;

    // Calculate total spend for the day
    const transactions = await prisma.transaction.findMany({
      where: {
        date: {
          gte: start,
          lte: end,
        },
      },
    });
    const totalSpend = transactions.reduce((sum, t) => sum + t.amountSGD, 0);

    // Calculate 7-day average spend velocity
    const sevenDaysAgo = getDaysAgo(7, date);
    const sevenDayTransactions = await prisma.transaction.findMany({
      where: {
        date: {
          gte: getStartOfDay(sevenDaysAgo),
          lte: end,
        },
      },
    });

    const sevenDayTotal = sevenDayTransactions.reduce(
      (sum, t) => sum + t.amountSGD,
      0
    );
    const spendVelocity7DayAvg = sevenDayTotal / 7;

    // Save to DailyStats
    await prisma.dailyStats.upsert({
      where: {
        date: getStartOfDay(date),
      },
      update: {
        dau,
        receiptsProcessed,
        totalSpend,
        avgLatencyMs,
        peakHour,
        spendVelocity7DayAvg,
      },
      create: {
        date: getStartOfDay(date),
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
   * Get admin stats summary for current week
   */
  async getAdminStats(): Promise<string> {
    const now = getNow();
    const weekStart = getDaysAgo(7, now);
    const weekEnd = getEndOfDay(now);

    // Get existing stats from database
    const existingStats = await prisma.dailyStats.findMany({
      where: {
        date: {
          gte: getStartOfDay(weekStart),
          lte: weekEnd,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    // Calculate stats for any missing days (including today)
    const existingDates = new Set(
      existingStats.map((s) => s.date.getTime())
    );

    // Check each day in the week range
    for (let i = 0; i <= 7; i++) {
      const checkDate = getDaysAgo(i, now);
      const checkDateStart = getStartOfDay(checkDate);
      
      if (!existingDates.has(checkDateStart.getTime())) {
        // Calculate stats for this missing day
        await this.calculateDailyStats(checkDate);
      }
    }

    // Re-fetch stats to include today's newly calculated stats
    const stats = await prisma.dailyStats.findMany({
      where: {
        date: {
          gte: getStartOfDay(weekStart),
          lte: weekEnd,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    if (stats.length === 0) {
      return 'No statistics available for the current week.';
    }

    const totalDau = new Set(
      stats.flatMap((s) => {
        // We can't get unique users from daily stats alone, so we'll use max DAU
        return [];
      })
    ).size;

    const totalReceipts = stats.reduce((sum, s) => sum + s.receiptsProcessed, 0);
    const totalSpend = stats.reduce((sum, s) => sum + s.totalSpend, 0);
    const avgLatency =
      stats.length > 0
        ? Math.round(
            stats.reduce((sum, s) => sum + s.avgLatencyMs, 0) / stats.length
          )
        : 0;

    // Get most common peak hour
    const peakHours = stats
      .map((s) => s.peakHour)
      .filter((h): h is number => h !== null);
    const peakHourCounts: { [key: number]: number } = {};
    peakHours.forEach((h) => {
      peakHourCounts[h] = (peakHourCounts[h] || 0) + 1;
    });
    const mostCommonPeakHour =
      Object.keys(peakHourCounts).length > 0
        ? Object.entries(peakHourCounts).sort((a, b) => b[1] - a[1])[0][0]
        : 'N/A';

    const avgSpendVelocity =
      stats.length > 0
        ? stats.reduce((sum, s) => sum + s.spendVelocity7DayAvg, 0) /
          stats.length
        : 0;

    return `📊 **Admin Statistics (Last 7 Days)**

📅 Period: ${weekStart.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}

📈 **Activity:**
• Receipts Processed: ${totalReceipts}
• Total Spend: SGD $${totalSpend.toFixed(2)}
• Avg Latency: ${avgLatency}ms

⏰ **Peak Hour:** ${mostCommonPeakHour}:00 (SGT)

💰 **Spend Velocity:** SGD $${avgSpendVelocity.toFixed(2)}/day (7-day avg)

📊 **Days with Data:** ${stats.length} day(s)`;
  }
}






import { format, parseISO, startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, subMonths, addMonths, getDaysInMonth } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Asia/Singapore';

/**
 * Get current date/time in Asia/Singapore timezone
 */
export function getNow(): Date {
  return toZonedTime(new Date(), TIMEZONE);
}

/**
 * Format date to string in Asia/Singapore timezone
 */
export function formatDate(date: Date, formatStr: string = 'yyyy-MM-dd HH:mm:ss'): string {
  const zonedDate = toZonedTime(date, TIMEZONE);
  return format(zonedDate, formatStr);
}

/**
 * Get start of day in Asia/Singapore timezone
 */
export function getStartOfDay(date: Date = getNow()): Date {
  const zonedDate = toZonedTime(date, TIMEZONE);
  const start = startOfDay(zonedDate);
  return fromZonedTime(start, TIMEZONE);
}

/**
 * Get end of day in Asia/Singapore timezone
 */
export function getEndOfDay(date: Date = getNow()): Date {
  const zonedDate = toZonedTime(date, TIMEZONE);
  const end = endOfDay(zonedDate);
  return fromZonedTime(end, TIMEZONE);
}

/**
 * Get start of month in Asia/Singapore timezone
 */
export function getStartOfMonth(date: Date = getNow()): Date {
  const zonedDate = toZonedTime(date, TIMEZONE);
  const start = startOfMonth(zonedDate);
  return fromZonedTime(start, TIMEZONE);
}

/**
 * Get end of month in Asia/Singapore timezone
 */
export function getEndOfMonth(date: Date = getNow()): Date {
  const zonedDate = toZonedTime(date, TIMEZONE);
  const end = endOfMonth(zonedDate);
  return fromZonedTime(end, TIMEZONE);
}

/**
 * Get date N days ago in Asia/Singapore timezone
 */
export function getDaysAgo(days: number, date: Date = getNow()): Date {
  const zonedDate = toZonedTime(date, TIMEZONE);
  const past = subDays(zonedDate, days);
  return fromZonedTime(past, TIMEZONE);
}

/**
 * Get date N months ago in Asia/Singapore timezone
 * If months is negative, it goes forward in time
 */
export function getMonthsAgo(months: number, date: Date = getNow()): Date {
  const zonedDate = toZonedTime(date, TIMEZONE);
  // subMonths with negative number will add months
  const result = subMonths(zonedDate, months);
  return fromZonedTime(result, TIMEZONE);
}

/**
 * Get hour of day (0-23) in Asia/Singapore timezone
 */
export function getHour(date: Date = getNow()): number {
  const zonedDate = toZonedTime(date, TIMEZONE);
  return zonedDate.getHours();
}

/**
 * Get day of month (1-31) in Asia/Singapore timezone
 */
export function getDayOfMonth(date: Date = getNow()): number {
  const zonedDate = toZonedTime(date, TIMEZONE);
  return zonedDate.getDate();
}

/**
 * Get the next occurrence date for a recurring expense based on day of month
 * Handles edge cases where dayOfMonth > days in target month (e.g., 31st for Feb)
 * @param dayOfMonth - Day of month (1-31)
 * @param timezone - Timezone string (default: 'Asia/Singapore')
 * @returns Next valid date when the expense should be processed
 */
export function getNextRecurringDate(dayOfMonth: number, timezone: string = TIMEZONE): Date {
  if (dayOfMonth < 1 || dayOfMonth > 31) {
    throw new Error('dayOfMonth must be between 1 and 31');
  }

  const now = getNow();
  const zonedNow = toZonedTime(now, timezone);
  const currentDay = zonedNow.getDate();
  const currentMonthDays = getDaysInMonth(zonedNow);
  
  // Determine target month and day
  let targetMonth = zonedNow;
  let targetDay = dayOfMonth;
  
  // If the requested day doesn't exist in current month, use last day of current month
  if (dayOfMonth > currentMonthDays) {
    targetDay = currentMonthDays;
  }
  
  // If we've already passed the target day this month, move to next month
  if (currentDay >= targetDay) {
    targetMonth = addMonths(zonedNow, 1);
    const nextMonthDays = getDaysInMonth(targetMonth);
    // For next month, use the requested day if it exists, otherwise use last day
    targetDay = Math.min(dayOfMonth, nextMonthDays);
  }
  
  // Create the target date at 09:00 SGT (when the cron job runs)
  // Use startOfDay to get a clean date, then set the day
  const targetZonedDate = new Date(targetMonth);
  targetZonedDate.setDate(targetDay);
  targetZonedDate.setHours(9, 0, 0, 0);
  
  // Convert back from zoned time to UTC
  return fromZonedTime(targetZonedDate, timezone);
}






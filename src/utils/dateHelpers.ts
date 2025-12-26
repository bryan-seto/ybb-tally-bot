import { format, parseISO, startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, subMonths } from 'date-fns';
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






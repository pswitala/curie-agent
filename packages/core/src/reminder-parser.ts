/**
 * Zero-dependency natural language time parser for reminders.
 * Parses patterns like "in 30 minutes", "tomorrow at 7am", "today at 19:00",
 * "next monday at 9am", etc.
 */

interface ParsedReminder {
  message: string;
  scheduledAt: number; // epoch ms
}

const WEEKDAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday',
];

/**
 * Parse a time string like "7:00 am", "19:00", "7am", "7:30PM".
 * Returns hours and minutes, or null if unparseable.
 */
function parseTimeOfDay(timeStr: string): { hours: number; minutes: number } | null {
  const match = timeStr.match(
    /(\d{1,2}):?(\d{2})?\s*([ap]m)?/i,
  );
  if (!match) return null;

  let hours = parseInt(match[1] ?? '0', 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3];

  if (ampm) {
    const isPM = ampm.toLowerCase().startsWith('p');
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
  }

  return { hours, minutes };
}

/**
 * Extract a time-of-day from the beginning of a string, returning the time
 * and the remaining message text. e.g. "7:00 am make breakfast" →
 * { time: {hours:7, minutes:0}, message: "make breakfast" }
 */
function extractTimeAndMessage(str: string): { time: { hours: number; minutes: number }; message: string } | null {
  const match = str.match(/(\d{1,2}):?(\d{2})?\s*([ap]m)?\s*(.*)/i);
  if (!match) return null;

  let hours = parseInt(match[1] ?? '0', 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3];
  const message = (match[4] ?? '').trim();

  if (ampm) {
    const isPM = ampm.toLowerCase().startsWith('p');
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
  }

  return { time: { hours, minutes }, message };
}

/**
 * Apply a time-of-day to a base date, returning a new Date.
 */
function applyTime(date: Date, hours: number, minutes: number): Date {
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Get the next occurrence of a weekday at a given time, or today if
 * the weekday already passed this week (returns next week).
 */
function nextWeekday(dayName: string, baseDate: Date, time: { hours: number; minutes: number }): Date {
  const targetDay = WEEKDAYS.indexOf(dayName.toLowerCase());
  if (targetDay === -1) return baseDate;

  const today = baseDate.getDay();
  let diff = targetDay - today;
  if (diff <= 0) diff += 7; // always go to next occurrence

  const result = new Date(baseDate);
  result.setDate(result.getDate() + diff);
  return applyTime(result, time.hours, time.minutes);
}

export function parseReminderTime(input: string): ParsedReminder | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const now = new Date();
  let remaining = trimmed;
  let targetTime: Date | null = null;

  // Pattern 1: "in X minutes"
  const inMinMatch = remaining.match(/^in\s+(\d+)\s+minutes?/i);
  if (inMinMatch) {
    const mins = parseInt(inMinMatch[1]!, 10);
    const msg = remaining.slice(inMinMatch[0].length).trim();
    targetTime = new Date(Date.now() + mins * 60_000);
    remaining = msg;
  }

  // Pattern 2: "in X hours"
  const inHourMatch = remaining.match(/^in\s+(\d+)\s+hours?/i);
  if (inHourMatch) {
    const hrs = parseInt(inHourMatch[1]!, 10);
    const msg = remaining.slice(inHourMatch[0].length).trim();
    targetTime = new Date(Date.now() + hrs * 3_600_000);
    remaining = msg;
  }

  // Pattern 3: "in X days"
  const inDayMatch = remaining.match(/^in\s+(\d+)\s+days?/i);
  if (inDayMatch) {
    const days = parseInt(inDayMatch[1]!, 10);
    const msg = remaining.slice(inDayMatch[0].length).trim();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + days);
    tomorrow.setHours(0, 0, 0, 0);
    targetTime = tomorrow;
    remaining = msg;
  }

  // Pattern 4: "tomorrow at <time>"
  const tomorrowMatch = remaining.match(/^tomorrow(?:\s+at\s+)?(.+)$/i);
  if (tomorrowMatch) {
    const rest = (tomorrowMatch[1] ?? '').trim();
    const parsed = extractTimeAndMessage(rest);
    if (parsed) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      targetTime = applyTime(tomorrow, parsed.time.hours, parsed.time.minutes);
      remaining = parsed.message;
    }
  }

  // Pattern 5: "today at <time>"
  const todayMatch = remaining.match(/^today(?:\s+at\s+)?(.+)$/i);
  if (todayMatch) {
    const rest = (todayMatch[1] ?? '').trim();
    const parsed = extractTimeAndMessage(rest);
    if (parsed) {
      targetTime = applyTime(now, parsed.time.hours, parsed.time.minutes);
      remaining = parsed.message;
    }
  }

  // Pattern 6: "next <weekday> at <time>"
  const nextDayMatch = remaining.match(
    /^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(.+)$/i,
  );
  if (nextDayMatch) {
    const dayName = (nextDayMatch[1] ?? '').trim();
    const rest = (nextDayMatch[2] ?? '').trim();
    const parsed = extractTimeAndMessage(rest);
    if (parsed) {
      targetTime = nextWeekday(dayName, now, parsed.time);
      remaining = parsed.message;
    }
  }

  // Pattern 7: "at <time>" (standalone — defaults to today)
  const atMatch = remaining.match(/^at\s+(.+)$/i);
  if (atMatch) {
    const rest = (atMatch[1] ?? '').trim();
    const parsed = extractTimeAndMessage(rest);
    if (parsed) {
      targetTime = applyTime(now, parsed.time.hours, parsed.time.minutes);
      remaining = parsed.message;
    }
  }

  // If no time was parsed, default to "in 1 hour"
  if (!targetTime) {
    targetTime = new Date(Date.now() + 3_600_000);
  }

  // Extract message: the part after time keywords
  const message = remaining.trim();

  if (!message) {
    return null;
  }

  return { message, scheduledAt: targetTime.getTime() };
}

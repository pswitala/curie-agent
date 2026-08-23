/**
 * Zero-dependency natural language time parser for reminders.
 * Parses patterns like "in 30 minutes", "tomorrow at 7am", "today at 19:00",
 * "next monday at 9am", etc.
 *
 * Two rules the callers depend on:
 *  - A parsed time is never in the past. A reminder that fires the instant it
 *    is created is worse than no reminder.
 *  - An unrecognised input returns null rather than guessing. Silently
 *    defaulting produces reminders at times the user never asked for.
 */

interface ParsedReminder {
  message: string;
  scheduledAt: number; // epoch ms
}

const WEEKDAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday',
];

interface TimeOfDay {
  hours: number;
  minutes: number;
}

/**
 * Pull a time-of-day off the *start* of a string, returning it plus the
 * remaining message text. Anchored deliberately: an unanchored match lets a
 * digit anywhere in the sentence become the hour, so "tomorrow buy 3 apples"
 * silently became "apples" at 03:00.
 */
function extractLeadingTime(str: string): { time: TimeOfDay; message: string } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?\b\s*(.*)$/i.exec(str);
  if (!match) return null;

  let hours = parseInt(match[1] ?? '', 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3];
  const message = (match[4] ?? '').trim();

  if (meridiem) {
    const isPM = meridiem.toLowerCase() === 'p';
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
  }

  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;

  return { time: { hours, minutes }, message };
}

/** Apply a time-of-day to a base date, returning a new Date. */
function applyTime(date: Date, hours: number, minutes: number): Date {
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Get the next occurrence of a weekday at a given time. Always forward —
 * "next friday" on a Friday means the Friday after this one.
 */
function nextWeekday(dayName: string, baseDate: Date, time: TimeOfDay): Date | null {
  const targetDay = WEEKDAYS.indexOf(dayName.toLowerCase());
  if (targetDay === -1) return null;

  const today = baseDate.getDay();
  let diff = targetDay - today;
  if (diff <= 0) diff += 7;

  const result = new Date(baseDate);
  result.setDate(result.getDate() + diff);
  return applyTime(result, time.hours, time.minutes);
}

export function parseReminderTime(input: string): ParsedReminder | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const now = new Date();

  // --- Relative offsets: an exact instant, no time-of-day involved --------
  const inMinMatch = /^in\s+(\d+)\s+min(?:ute)?s?\b\s*(.*)$/i.exec(trimmed);
  if (inMinMatch) {
    const message = (inMinMatch[2] ?? '').trim();
    if (!message) return null;
    return { message, scheduledAt: now.getTime() + parseInt(inMinMatch[1] ?? '0', 10) * 60_000 };
  }

  const inHourMatch = /^in\s+(\d+)\s+(?:hours?|hrs?)\b\s*(.*)$/i.exec(trimmed);
  if (inHourMatch) {
    const message = (inHourMatch[2] ?? '').trim();
    if (!message) return null;
    return { message, scheduledAt: now.getTime() + parseInt(inHourMatch[1] ?? '0', 10) * 3_600_000 };
  }

  // --- A calendar day, optionally followed by a time-of-day --------------
  const baseDate = new Date(now);
  let rest: string;
  /** Whether a past time-of-day may roll into tomorrow. */
  let allowRollForward = false;
  /** Time-of-day to use when the input names a day but no clock time. */
  let defaultTime: TimeOfDay | null = null;
  let weekday: string | null = null;

  const inDayMatch = /^in\s+(\d+)\s+days?\b\s*(?:at\s+)?(.*)$/i.exec(trimmed);
  const tomorrowMatch = /^tomorrow\b\s*(?:at\s+)?(.*)$/i.exec(trimmed);
  const todayMatch = /^(?:today|tonight)\b\s*(?:at\s+)?(.*)$/i.exec(trimmed);
  const nextDayMatch = /^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b\s*(?:at\s+)?(.*)$/i.exec(trimmed);
  const atMatch = /^at\s+(.*)$/i.exec(trimmed);

  if (inDayMatch) {
    baseDate.setDate(baseDate.getDate() + parseInt(inDayMatch[1] ?? '0', 10));
    rest = inDayMatch[2] ?? '';
    defaultTime = { hours: 0, minutes: 0 };
  } else if (tomorrowMatch) {
    baseDate.setDate(baseDate.getDate() + 1);
    rest = tomorrowMatch[1] ?? '';
  } else if (todayMatch) {
    rest = todayMatch[1] ?? '';
    // "today at 6:00" typed at 10:00 can't mean the past — take the next 06:00.
    allowRollForward = true;
  } else if (nextDayMatch) {
    weekday = nextDayMatch[1] ?? '';
    rest = nextDayMatch[2] ?? '';
  } else if (atMatch) {
    rest = atMatch[1] ?? '';
    allowRollForward = true;
  } else {
    // No recognisable time reference — don't invent one.
    return null;
  }

  const extracted = extractLeadingTime(rest.trim());
  const time = extracted?.time ?? defaultTime;
  const message = (extracted ? extracted.message : rest).trim();

  if (!time || !message) return null;

  let target = weekday
    ? nextWeekday(weekday, baseDate, time)
    : applyTime(baseDate, time.hours, time.minutes);
  if (!target) return null;

  if (allowRollForward && target.getTime() <= now.getTime()) {
    target = new Date(target);
    target.setDate(target.getDate() + 1);
  }

  // A pinned future day (tomorrow / in N days / next <weekday>) that still
  // lands in the past means the input was contradictory.
  if (target.getTime() <= now.getTime()) return null;

  return { message, scheduledAt: target.getTime() };
}

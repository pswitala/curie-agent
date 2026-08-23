import { describe, it, expect } from 'vitest';
import { parseReminderTime } from './reminder-parser.js';

describe('parseReminderTime', () => {
  it('parses "in X minutes"', () => {
    const base = Date.now();
    const result = parseReminderTime('in 30 minutes call mom');
    expect(result).not.toBeNull();
    expect(result.message).toBe('call mom');
    expect(result.scheduledAt).toBeGreaterThanOrEqual(base + 29 * 60_000);
    expect(result.scheduledAt).toBeLessThanOrEqual(base + 31 * 60_000);
  });

  it('parses "in X hours"', () => {
    const base = Date.now();
    const result = parseReminderTime('in 2 hours review PR');
    expect(result).not.toBeNull();
    expect(result.message).toBe('review PR');
    expect(result.scheduledAt).toBeGreaterThanOrEqual(base + 1.9 * 3_600_000);
    expect(result.scheduledAt).toBeLessThanOrEqual(base + 2.1 * 3_600_000);
  });

  it('parses "in X days"', () => {
    const now = new Date('2026-05-02T12:00:00Z').getTime();
    // We can't easily test absolute dates without mocking, so test structure
    const result = parseReminderTime('in 3 days ship it');
    expect(result).not.toBeNull();
    expect(result.message).toBe('ship it');
  });

  it('parses "tomorrow at 7:00 am"', () => {
    const result = parseReminderTime('tomorrow at 7:00 am make breakfast');
    expect(result).not.toBeNull();
    expect(result.message).toBe('make breakfast');
  });

  it('parses "today at 19:00"', () => {
    const result = parseReminderTime('today at 19:00 dog walk');
    expect(result).not.toBeNull();
    expect(result.message).toBe('dog walk');
  });

  it('parses "next monday at 9am"', () => {
    const result = parseReminderTime('next monday at 9am team standup');
    expect(result).not.toBeNull();
    expect(result.message).toBe('team standup');
  });

  it('parses "at 7:30 pm"', () => {
    const result = parseReminderTime('at 7:30 pm take medicine');
    expect(result).not.toBeNull();
    expect(result.message).toBe('take medicine');
  });

  it('returns null when no time pattern matches instead of guessing +1h', () => {
    // Silently scheduling an hour out produced reminders at times the user
    // never asked for. Callers surface a usage message on null.
    expect(parseReminderTime('check the codebase')).toBeNull();
    expect(parseReminderTime('submit the report')).toBeNull();
  });

  it('never returns a time in the past', () => {
    const now = new Date();
    // A time-of-day that has already passed today rolls into tomorrow rather
    // than firing the instant the reminder is created.
    const past = new Date(now.getTime() - 3 * 3_600_000);
    const hhmm = `${String(past.getHours()).padStart(2, '0')}:${String(past.getMinutes()).padStart(2, '0')}`;

    for (const input of [`at ${hhmm} take pills`, `today at ${hhmm} stand up`]) {
      const result = parseReminderTime(input);
      expect(result, input).not.toBeNull();
      expect(result!.scheduledAt, input).toBeGreaterThan(now.getTime());
    }
  });

  it('does not treat a digit mid-sentence as the hour', () => {
    // Previously "tomorrow buy 3 apples" parsed as 03:00 with the message
    // truncated to "apples".
    expect(parseReminderTime('tomorrow buy 3 apples')).toBeNull();

    const kept = parseReminderTime('tomorrow at 9:00 call Anna about 5 invoices');
    expect(kept).not.toBeNull();
    expect(kept!.message).toBe('call Anna about 5 invoices');
  });

  it('applies a time-of-day to an explicit day offset', () => {
    const result = parseReminderTime('in 3 days at 9am call mom');
    expect(result).not.toBeNull();
    const when = new Date(result!.scheduledAt);
    expect(when.getHours()).toBe(9);
    expect(when.getMinutes()).toBe(0);
    expect(result!.message).toBe('call mom');
  });

  it('rejects out-of-range clock times', () => {
    expect(parseReminderTime('at 99 broken')).toBeNull();
    expect(parseReminderTime('at 10:99 broken')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseReminderTime('')).toBeNull();
    expect(parseReminderTime('   ')).toBeNull();
  });

  it('handles 12-hour time with AM/PM', () => {
    const result = parseReminderTime('tomorrow at 3:30PM submit report');
    expect(result).not.toBeNull();
    expect(result.message).toBe('submit report');
  });

  it('handles single-digit hours', () => {
    const result = parseReminderTime('tomorrow at 9am standup');
    expect(result).not.toBeNull();
    expect(result.message).toBe('standup');
  });
});

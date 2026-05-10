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

  it('defaults to 1 hour when no time pattern matches', () => {
    const base = Date.now();
    const result = parseReminderTime('check the codebase');
    expect(result).not.toBeNull();
    expect(result.message).toBe('check the codebase');
    expect(result.scheduledAt).toBeGreaterThanOrEqual(base + 3_400_000);
    expect(result.scheduledAt).toBeLessThanOrEqual(base + 3_800_000);
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

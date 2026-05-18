import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';
import { CronManager } from '@curie-agent/core';

const CronManagerSingleton = new CronManager();

const CreateReminderSchema = z.object({
  message: z.string().describe('What to remind the user about'),
  scheduled_at: z.string().describe('ISO 8601 datetime with the user\'s local timezone offset suffix. You MUST append the timezone offset matching the offset in the date/time context context (e.g. "2026-05-03T07:00:00+02:00"). Do NOT omit the offset.'),
});

export const reminderTool = createTool(
  'CreateReminder',
  'Creates a reminder notification that will fire at the specified time.',
  CreateReminderSchema,
  async (input, ctx: ToolContext) => {
    let dateStr = input.scheduled_at.trim();

    // Check if it already has a timezone offset suffix (Z, or +HH:MM, or -HH:MM, etc.)
    const hasTimezone = /[Zz]|[+-]\d{2}(:?\d{2})?$/.test(dateStr);
    if (!hasTimezone) {
      // Append the system's current local timezone offset
      const date = new Date();
      const offsetMinutes = -date.getTimezoneOffset();
      const sign = offsetMinutes >= 0 ? '+' : '-';
      const absMinutes = Math.abs(offsetMinutes);
      const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
      const mins = String(absMinutes % 60).padStart(2, '0');
      const offset = `${sign}${hours}:${mins}`;
      dateStr = `${dateStr}${offset}`;
    }

    const scheduledAt = new Date(dateStr).getTime();
    if (isNaN(scheduledAt)) {
      return {
        output: null,
        error: `Invalid datetime: "${input.scheduled_at}". Use ISO 8601 format with timezone offset suffix (e.g. "2026-05-03T07:00:00+02:00").`,
      };
    }
    // Reload from disk before creating so we don't overwrite
    // status changes made by the CLI's CronManager instance.
    CronManagerSingleton.load();
    const task = CronManagerSingleton.createReminder(input.message, scheduledAt, ctx.sessionId);
    const timeStr = new Date(scheduledAt).toLocaleString();
    return {
      output: {
        id: task.id,
        message: task.message,
        scheduledAt: timeStr,
        status: task.status,
      },
    };
  },
);

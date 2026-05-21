/**
 * CreateReminder tool — schedules a notification at a specific time.
 * Migrated from CronManager to TaskManager (mode='notify').
 */

import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';
import { TaskManager } from '@curie-agent/core';

const taskManager = new TaskManager();

const CreateReminderSchema = z.object({
  message: z.string().describe('What to remind the user about'),
  scheduled_at: z.string().describe('ISO 8601 datetime with the user\'s local timezone offset suffix. You MUST append the timezone offset matching the offset in the date/time context (e.g. "2026-05-03T07:00:00+02:00"). Do NOT omit the offset.'),
});

export const reminderTool = createTool(
  'CreateReminder',
  'Creates a reminder notification that will fire at the specified time.',
  CreateReminderSchema,
  async (input, ctx: ToolContext) => {
    let dateStr = input.scheduled_at.trim();
    const hasTimezone = /[Zz]|[+-]\d{2}(:?\d{2})?$/.test(dateStr);
    if (!hasTimezone) {
      const date = new Date();
      const offsetMinutes = -date.getTimezoneOffset();
      const sign = offsetMinutes >= 0 ? '+' : '-';
      const absMinutes = Math.abs(offsetMinutes);
      const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
      const mins = String(absMinutes % 60).padStart(2, '0');
      dateStr = `${dateStr}${sign}${hours}:${mins}`;
    }

    const scheduledAt = new Date(dateStr).getTime();
    if (isNaN(scheduledAt)) {
      return {
        output: null,
        error: `Invalid datetime: "${input.scheduled_at}". Use ISO 8601 format with timezone offset suffix.`,
      };
    }

    taskManager.load();
    const task = taskManager.create({
      title: input.message,
      mode: 'notify',
      scope: 'personal',
      scheduled_at: scheduledAt,
    });

    return {
      output: {
        id: task.id,
        message: task.title,
        scheduledAt: task.scheduled_at ? new Date(task.scheduled_at).toLocaleString() : '—',
        status: task.status,
        mode: task.mode,
      },
    };
  },
);

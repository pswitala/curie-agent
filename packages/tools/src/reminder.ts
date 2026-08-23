/**
 * CreateReminder tool — schedules a notification at a specific time.
 * Writes through the process-shared TaskManager (mode='notify').
 */

import { z } from 'zod';
import { createTool, ensureTimezoneOffset, type ToolContext } from './tool.js';
import { getTaskManager } from '@curie-agent/core';

const CreateReminderSchema = z.object({
  message: z.string().describe('What to remind the user about'),
  scheduled_at: z.string().describe('ISO 8601 datetime with the user\'s local timezone offset suffix. You MUST append the timezone offset matching the offset in the date/time context (e.g. "2026-05-03T07:00:00+02:00"). Do NOT omit the offset.'),
});

export const reminderTool = createTool(
  'CreateReminder',
  'Creates a reminder notification that will fire at the specified time.',
  CreateReminderSchema,
  async (input, _ctx: ToolContext) => {
    const scheduledAt = new Date(ensureTimezoneOffset(input.scheduled_at)).getTime();
    if (isNaN(scheduledAt)) {
      return {
        output: null,
        error: `Invalid datetime: "${input.scheduled_at}". Use ISO 8601 format with timezone offset suffix.`,
      };
    }

    const task = getTaskManager().create({
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

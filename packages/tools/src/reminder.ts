import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';
import { CronManager } from '@curie-agent/core';

const CronManagerSingleton = new CronManager();

const CreateReminderSchema = z.object({
  message: z.string().describe('What to remind the user about'),
  scheduled_at: z.string().describe('ISO 8601 datetime (e.g. "2026-05-03T07:00:00Z")'),
});

export const reminderTool = createTool(
  'CreateReminder',
  'Creates a reminder notification that will fire at the specified time.',
  CreateReminderSchema,
  async (input) => {
    const scheduledAt = new Date(input.scheduled_at).getTime();
    if (isNaN(scheduledAt)) {
      return {
        output: null,
        error: `Invalid datetime: "${input.scheduled_at}". Use ISO 8601 format (e.g. "2026-05-03T07:00:00Z").`,
      };
    }
    const task = CronManagerSingleton.createReminder(input.message, scheduledAt);
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

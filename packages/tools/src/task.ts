import { z } from 'zod';
import { createTool } from './tool.js';
import { CronManager } from '@curie-agent/core';

const CronManagerSingleton = new CronManager();

const CreateTaskSchema = z.object({
  instruction: z.string().describe('What the agent should do when the task executes'),
  scheduled_at: z.string().describe('ISO 8601 datetime (e.g. "2026-05-03T07:55:00Z")'),
});

export const taskTool = createTool(
  'CreateTask',
  'Schedules a task for the agent to execute at the specified time. The agent will run the instruction using available tools (browsing, reading, searching) and deliver results.',
  CreateTaskSchema,
  async (input) => {
    const scheduledAt = new Date(input.scheduled_at).getTime();
    if (isNaN(scheduledAt)) {
      return {
        output: null,
        error: `Invalid datetime: "${input.scheduled_at}". Use ISO 8601 format (e.g. "2026-05-03T07:55:00Z").`,
      };
    }
    // Reload from disk before creating so we don't overwrite
    // existing tasks added by the CLI's CronManager or other tools.
    CronManagerSingleton.load();
    const task = CronManagerSingleton.createTask(input.instruction, scheduledAt);
    const timeStr = new Date(scheduledAt).toLocaleString();
    return {
      output: {
        id: task.id,
        instruction: task.message,
        scheduledAt: timeStr,
        status: task.status,
      },
    };
  },
);

/**
 * CreateScheduledTask tool — schedules the LLM agent to execute an instruction at a specific time.
 * Writes through the process-shared TaskManager (mode='agent').
 */

import { z } from 'zod';
import { createTool, ensureTimezoneOffset, type ToolContext } from './tool.js';
import { getTaskManager } from '@curie-agent/core';

const CreateScheduledTaskSchema = z.object({
  instruction: z.string().describe('What the agent should do when the scheduled task executes'),
  scheduled_at: z.string().describe('ISO 8601 datetime with timezone offset (e.g. "2026-05-03T07:55:00+02:00")'),
});

export const scheduledTaskTool = createTool(
  'CreateScheduledTask',
  'Schedules a task for the agent to autonomously execute at a specified time. The agent will run the instruction using available tools and deliver results.',
  CreateScheduledTaskSchema,
  async (input, _ctx: ToolContext) => {
    const scheduledAt = new Date(ensureTimezoneOffset(input.scheduled_at)).getTime();
    if (isNaN(scheduledAt)) {
      return {
        output: null,
        error: `Invalid datetime: "${input.scheduled_at}". Use ISO 8601 format with timezone offset.`,
      };
    }

    const task = getTaskManager().create({
      title: input.instruction,
      mode: 'agent',
      scope: 'personal',
      scheduled_at: scheduledAt,
    });

    return {
      output: {
        id: task.id,
        instruction: task.title,
        scheduledAt: task.scheduled_at ? new Date(task.scheduled_at).toLocaleString() : '—',
        status: task.status,
        mode: task.mode,
      },
    };
  },
);

/**
 * CreateScheduledTask tool — schedules the LLM agent to execute an instruction at a specific time.
 * Migrated from CronManager to TaskManager (mode='auto').
 */

import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';
import { TaskManager } from '@curie-agent/core';

const taskManager = new TaskManager();

const CreateScheduledTaskSchema = z.object({
  instruction: z.string().describe('What the agent should do when the scheduled task executes'),
  scheduled_at: z.string().describe('ISO 8601 datetime with timezone offset (e.g. "2026-05-03T07:55:00+02:00")'),
});

export const scheduledTaskTool = createTool(
  'CreateScheduledTask',
  'Schedules a task for the agent to autonomously execute at a specified time. The agent will run the instruction using available tools and deliver results.',
  CreateScheduledTaskSchema,
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
      dateStr = `${dateStr}${sign}:${mins}`;
    }

    const scheduledAt = new Date(dateStr).getTime();
    if (isNaN(scheduledAt)) {
      return {
        output: null,
        error: `Invalid datetime: "${input.scheduled_at}". Use ISO 8601 format with timezone offset.`,
      };
    }

    taskManager.load();
    const task = taskManager.create({
      title: input.instruction,
      mode: 'auto',
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

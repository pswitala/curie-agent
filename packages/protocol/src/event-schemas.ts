import { z } from 'zod';

export const UserPromptEvent = z.object({
  type: z.literal('user-prompt'),
  id: z.string(),
  text: z.string(),
  cwd: z.string(),
  timestamp: z.number(),
});

export const AssistantDeltaEvent = z.object({
  type: z.literal('assistant-delta'),
  id: z.string(),
  text: z.string(),
  timestamp: z.number(),
});

export const AssistantStopEvent = z.object({
  type: z.literal('assistant-stop'),
  id: z.string(),
  timestamp: z.number(),
});

export const ToolCallEvent = z.object({
  type: z.literal('tool-call'),
  id: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
});

export const ToolResultEvent = z.object({
  type: z.literal('tool-result'),
  id: z.string(),
  toolCallId: z.string(),
  output: z.unknown(),
  error: z.string().optional(),
  timestamp: z.number(),
});

export const ApprovalRequestEvent = z.object({
  type: z.literal('approval-request'),
  id: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
  decision: z.enum(['allow', 'deny', 'ask']).optional(),
  timestamp: z.number(),
});

export const ApprovalDecisionEvent = z.object({
  type: z.literal('approval-decision'),
  id: z.string(),
  toolCallId: z.string(),
  decision: z.enum(['allow', 'deny']),
  by: z.string().optional(),
  timestamp: z.number(),
});

export const UsageEvent = z.object({
  type: z.literal('usage'),
  id: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  timestamp: z.number(),
});

export const ErrorEvent = z.object({
  type: z.literal('error'),
  id: z.string(),
  message: z.string(),
  code: z.string().optional(),
  timestamp: z.number(),
});

export const SessionStartEvent = z.object({
  type: z.literal('session-start'),
  id: z.string(),
  model: z.string(),
  provider: z.string(),
  cwd: z.string(),
  timestamp: z.number(),
});

export const SessionStopEvent = z.object({
  type: z.literal('session-stop'),
  id: z.string(),
  reason: z.string(),
  timestamp: z.number(),
});

export const HookEvent = z.object({
  type: z.literal('hook'),
  id: z.string(),
  phase: z.string(),
  name: z.string(),
  result: z.string().optional(),
  error: z.string().optional(),
  timestamp: z.number(),
});

export const StatusEvent = z.object({
  type: z.literal('status'),
  id: z.string(),
  message: z.string(),
  spinner: z.boolean().optional(),
  timestamp: z.number(),
});

export const SessionResumedEvent = z.object({
  type: z.literal('session-resumed'),
  id: z.string(),
  turnsRecovered: z.number(),
  timestamp: z.number(),
});

export const ContextWarningEvent = z.object({
  type: z.literal('context-warning'),
  id: z.string(),
  message: z.string(),
  timestamp: z.number(),
});

export const EventSchema = z.discriminatedUnion('type', [
  UserPromptEvent,
  AssistantDeltaEvent,
  AssistantStopEvent,
  ToolCallEvent,
  ToolResultEvent,
  ApprovalRequestEvent,
  ApprovalDecisionEvent,
  UsageEvent,
  ErrorEvent,
  SessionStartEvent,
  SessionStopEvent,
  HookEvent,
  StatusEvent,
  SessionResumedEvent,
  ContextWarningEvent,
]);

export type Event = z.infer<typeof EventSchema>;

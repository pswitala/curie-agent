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

/**
 * Compaction marker. Appended to the session log — never overwriting it — so
 * the full transcript survives for the UI and audit while message
 * reconstruction replays forward from the last marker.
 */
export const CompactionEvent = z.object({
  type: z.literal('compaction'),
  id: z.string(),
  summary: z.string(),
  summarizedMessageCount: z.number(),
  tokensBefore: z.number(),
  tokensAfter: z.number(),
  timestamp: z.number(),
});

/**
 * Context-window snapshot with a per-component split. Carries data, not markup,
 * so the TUI and the web dashboard each render it natively.
 */
export const ContextReportEvent = z.object({
  type: z.literal('context-report'),
  id: z.string(),
  model: z.string(),
  windowTokens: z.number(),
  usedTokens: z.number(),
  reservedOutput: z.number(),
  breakdown: z.array(z.object({ label: z.string(), tokens: z.number() })),
  timestamp: z.number(),
});

export const CronTaskFiredEvent = z.object({
  type: z.literal('cron-task-fired'),
  id: z.string(),
  taskId: z.string(),
  taskType: z.enum(['notify', 'auto']),
  message: z.string(),
  timestamp: z.number(),
});

export const HeartbeatBriefEvent = z.object({
  type: z.literal('heartbeat-brief'),
  id: z.string(),
  scheduleType: z.enum(['intraday', 'daily', 'weekly', 'monthly', 'dreaming']),
  formattedText: z.string(),
  toolCalls: z.number(),
  errors: z.array(z.string()),
  timestamp: z.number(),
});

export const ChannelUpdatedEvent = z.object({
  type: z.literal('channel-updated'),
  id: z.string(),
  channelId: z.string(),
  channelType: z.enum(['cli', 'telegram']),
  displayName: z.string(),
  sessionId: z.string(),
  timestamp: z.number(),
});

export const McpStatusEvent = z.object({
  type: z.literal('mcp-status'),
  id: z.string(),
  serverId: z.string(),
  connected: z.boolean(),
  tools: z.array(z.string()),
  timestamp: z.number(),
});

export const DaemonReadyEvent = z.object({
  type: z.literal('daemon-ready'),
  id: z.string(),
  version: z.string(),
  timestamp: z.number(),
});

export const WikiEvent = z.object({
  type: z.literal('wiki-op'),
  id: z.string(),
  op: z.enum(['ingest', 'query', 'lint', 'edit']),
  pages: z.array(z.string()),
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
  CompactionEvent,
  ContextReportEvent,
  CronTaskFiredEvent,
  HeartbeatBriefEvent,
  ChannelUpdatedEvent,
  McpStatusEvent,
  DaemonReadyEvent,
  WikiEvent,
]);

export type Event = z.infer<typeof EventSchema>;

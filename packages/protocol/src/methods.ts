import { z } from 'zod';

export const SessionListSchema = z.object({});
export const SessionGetSchema = z.object({ id: z.string() });
export const SessionSendSchema = z.object({ id: z.string(), text: z.string() });
export const SessionCancelSchema = z.object({ id: z.string() });
export const SessionResumeSchema = z.object({ id: z.string().optional() });

export const OrchestraPanesSchema = z.object({});
export const OrchestraBroadcastSchema = z.object({
  paneIds: z.array(z.string()),
  text: z.string(),
});

export const WikiQuerySchema = z.object({ query: z.string() });
export const WikiPageGetSchema = z.object({ slug: z.string() });

export const ApprovalPendingSchema = z.object({ sessionId: z.string().optional() });
export const ApprovalDecideSchema = z.object({
  toolCallId: z.string(),
  decision: z.enum(['allow', 'deny']),
});

export const ToolRegistrySchema = z.object({});
export const ProviderListSchema = z.object({});

export const ConfigGetSchema = z.object({ key: z.string() });
export const ConfigSetSchema = z.object({ key: z.string(), value: z.unknown() });

// Daemon lifecycle
export const DaemonStatusSchema = z.object({});
export const DaemonShutdownSchema = z.object({});

// Cron management
export const CronListSchema = z.object({
  type: z.enum(['reminder', 'heartbeat', 'task']).optional(),
  status: z.enum(['pending', 'fired', 'executing', 'completed', 'failed', 'cancelled']).optional(),
});
export const CronCreateSchema = z.object({
  type: z.enum(['reminder', 'task']),
  message: z.string(),
  scheduledAt: z.number(),
  schedule: z.object({
    type: z.enum(['intraday', 'daily', 'weekly', 'monthly', 'dreaming']),
    value: z.string(),
  }).optional(),
});
export const CronCancelSchema = z.object({ id: z.string() });
export const CronClearSchema = z.object({});

// Heartbeat
export const HeartbeatRunSchema = z.object({
  scheduleType: z.enum(['intraday', 'daily', 'weekly', 'monthly', 'dreaming']).optional(),
});
export const HeartbeatStatusSchema = z.object({});

// Channels
export const ChannelListSchema = z.object({});
export const ChannelGetSchema = z.object({ channelId: z.string() });

// Stats
export const SessionStatsSchema = z.object({});

// MCP
export const McpListSchema = z.object({});

// Identity setup (init wizard)
export const IdentitySetupSchema = z.object({
  provider: z.string(),
  apiKey: z.string(),
  model: z.string(),
  soulName: z.string(),
  soulVibe: z.string(),
  userName: z.string(),
  userTimezone: z.string(),
  userLanguages: z.string(),
});

// Subagent management
export const SubagentSpawnSchema = z.object({
  sessionId: z.string(),
  prompt: z.string(),
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama', 'openrouter']).optional(),
  mode: z.enum(['plan', 'edit', 'auto', 'yolo']).optional(),
  effort: z.enum(['low', 'medium', 'high', 'max', 'auto']).optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
});
export const SubagentListSchema = z.object({
  sessionId: z.string().optional(),
  status: z.enum(['running', 'completed', 'error', 'cancelled']).optional(),
});
export const SubagentCancelSchema = z.object({ agentId: z.string() });
export const SubagentStatsSchema = z.object({ agentId: z.string() });
export const SubagentSendSchema = z.object({ agentId: z.string(), message: z.string() });
export const TaskScheduleRequestSchema = z.object({
  instruction: z.string(),
  scheduled_at: z.string(), // ISO datetime string
  provider: z.string().optional(),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'max', 'auto']).optional(),
});

// Unified task (todo) management for Kanban board
export const TodoListSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled', 'pending', 'executing', 'completed', 'failed']).optional(),
  mode: z.enum(['human', 'agent', 'notify']).optional(),
  scope: z.enum(['personal', 'project']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

export const TodoCreateSchema = z.object({
  title: z.string(),
  description: z.string().default(''),
  mode: z.enum(['human', 'agent', 'notify']).default('human'),
  scope: z.enum(['personal', 'project']).default('personal'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  tags: z.array(z.string()).default([]),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled', 'pending', 'executing', 'completed', 'failed']).optional(),
  scheduled_at: z.number().optional(),
});

export const TodoUpdateSchema = z.object({
  id: z.string(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled', 'pending', 'executing', 'completed', 'failed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  mode: z.enum(['human', 'agent', 'notify']).optional(),
  scope: z.enum(['personal', 'project']).optional(),
  scheduled_at: z.number().optional(),
});

export const TodoRemoveSchema = z.object({ id: z.string() });

export const Method = {
  SESSION_LIST: 'session.list',
  SESSION_GET: 'session.get',
  SESSION_STATS: 'session.stats',
  SESSION_SEND: 'session.send',
  SESSION_CANCEL: 'session.cancel',
  SESSION_RESUME: 'session.resume',
  ORCHESTRA_PANES: 'orchestra.panes',
  ORCHESTRA_BROADCAST: 'orchestra.broadcast',
  WIKI_QUERY: 'wiki.query',
  WIKI_PAGE_GET: 'wiki.page.get',
  APPROVAL_PENDING: 'approval.pending',
  APPROVAL_DECIDE: 'approval.decide',
  TOOL_REGISTRY: 'tool.registry',
  PROVIDER_LIST: 'provider.list',
  CONFIG_GET: 'config.get',
  CONFIG_SET: 'config.set',
  // Daemon lifecycle
  DAEMON_STATUS: 'daemon.status',
  DAEMON_SHUTDOWN: 'daemon.shutdown',
  // Cron
  CRON_LIST: 'cron.list',
  CRON_CREATE: 'cron.create',
  CRON_CANCEL: 'cron.cancel',
  CRON_CLEAR: 'cron.clear',
  // Heartbeat
  HEARTBEAT_RUN: 'heartbeat.run',
  HEARTBEAT_STATUS: 'heartbeat.status',
  // Channels
  CHANNEL_LIST: 'channel.list',
  CHANNEL_GET: 'channel.get',
  // MCP
  MCP_LIST: 'mcp.list',
  // Task scheduling (from WebUI)
  TASK_SCHEDULE: 'task.schedule',
  // Unified task (todo) management for Kanban board
  TODO_LIST: 'todo.list',
  TODO_CREATE: 'todo.create',
  TODO_UPDATE: 'todo.update',
  TODO_REMOVE: 'todo.remove',
  // Identity setup
  IDENTITY_SETUP: 'identity.setup',
  // Subagent management
  SUBAGENT_SPAWN: 'subagent.spawn',
  SUBAGENT_LIST: 'subagent.list',
  SUBAGENT_CANCEL: 'subagent.cancel',
  SUBAGENT_STATS: 'subagent.stats',
  SUBAGENT_SEND: 'subagent.send',
} as const;

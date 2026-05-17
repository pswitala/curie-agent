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

// MCP
export const McpListSchema = z.object({});

export const Method = {
  SESSION_LIST: 'session.list',
  SESSION_GET: 'session.get',
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
} as const;

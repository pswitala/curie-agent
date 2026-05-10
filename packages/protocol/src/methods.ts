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
} as const;

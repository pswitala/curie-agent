import { useConfig } from '../hooks/useConfig.js';
import ChatView from './ChatView.js';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';
import type { WsEvent } from '../lib/ws-client.js';

interface Props {
  cmdResult: string;
  onClearCmdResult: () => void;
  rpc: JsonRpcClient | null;
  className?: string;
  activeSessionId: string | null;
  onCreateSession?: (sessionId: string) => void;
  events: WsEvent[];
  addLiveEvent: (event: WsEvent) => void;
}

function estimateCostClient(
  model: string,
  inputTokens: number,
  outputTokens: number,
  modelCost?: string,
): number {
  if (modelCost) {
    const [inStr, outStr] = modelCost.split(';');
    const inPrice = parseFloat(inStr || '0');
    const outPrice = parseFloat(outStr || '0');
    if (!isNaN(inPrice) && !isNaN(outPrice)) {
      return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
    }
  }
  const pricing: Record<string, { in: number; out: number }> = {
    'opus': { in: 15, out: 75 },
    'sonnet': { in: 3, out: 15 },
    'haiku': { in: 0.8, out: 4 },
    'gpt-4o': { in: 2.5, out: 10 },
    'gpt-4': { in: 5, out: 15 },
    'qwen': { in: 0.112, out: 0.224 },
  };
  const key = Object.keys(pricing).find(k => model.toLowerCase().includes(k)) || 'sonnet';
  const p = pricing[key]!;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

export default function ChatArea({ cmdResult, onClearCmdResult, rpc, className, activeSessionId, onCreateSession, events, addLiveEvent }: Props) {
  const { get, providers } = useConfig();
  const model = get('model') as string | undefined;
  const currentProvider = (get('current_provider') as string) || 'anthropic';
  const modelCost = providers.find((p) => p.name === currentProvider)?.model_cost;

  // Compute session stats from events
  let totalTokens = 0;
  let contextTokens = 0;
  let costUsd = 0;
  const usageEvents = activeSessionId ? events.filter((e) => e.type === 'usage') as any[] : [];
  if (usageEvents.length > 0) {
    totalTokens = usageEvents.reduce((acc, curr) => acc + (curr.inputTokens || 0) + (curr.outputTokens || 0), 0);
    const latestUsage = usageEvents[usageEvents.length - 1];
    contextTokens = latestUsage ? (latestUsage.inputTokens || 0) : 0;
    costUsd = usageEvents.reduce((acc, curr) =>
      acc + estimateCostClient(model || 'sonnet', curr.inputTokens || 0, curr.outputTokens || 0, modelCost), 0);
  }

  return (
    <div className={`flex flex-col h-full ${className || ''}`}>
      <ChatView
        cmdResult={cmdResult}
        onClearCmdResult={onClearCmdResult}
        rpc={rpc}
        activeSessionId={activeSessionId}
        onCreateSession={onCreateSession}
        events={events}
        addLiveEvent={addLiveEvent}
        totalTokens={totalTokens}
        contextTokens={contextTokens}
        costUsd={costUsd}
      />
    </div>
  );
}

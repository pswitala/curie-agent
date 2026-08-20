import { useConfig } from '../hooks/useConfig.js';
import ChatView from './ChatView.js';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';
import type { WsEvent } from '../lib/ws-client.js';
import type { ContextReport } from '../hooks/useSession.js';
import { estimateCost } from '../lib/cost.js';

interface Props {
  cmdResult: string;
  onClearCmdResult: () => void;
  rpc: JsonRpcClient | null;
  className?: string;
  activeSessionId: string | null;
  onCreateSession?: (sessionId: string) => void;
  events: WsEvent[];
  addLiveEvent: (event: WsEvent) => void;
  onSwitchView?: (view: string) => void;
  contextReport?: ContextReport | null;
}

export default function ChatArea({ cmdResult, onClearCmdResult, rpc, className, activeSessionId, onCreateSession, events, addLiveEvent, onSwitchView, contextReport }: Props) {
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
      acc + estimateCost(model || 'sonnet', curr.inputTokens || 0, curr.outputTokens || 0, modelCost), 0);
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
        contextReport={contextReport}
        onSwitchView={onSwitchView}
      />
    </div>
  );
}

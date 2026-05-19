import { useConfig } from '../hooks/useConfig.js';
import type { SessionInfo } from '../hooks/useSession.js';
import type { WsEvent } from '../lib/ws-client.js';

type View = 'assistant' | 'channels' | 'stats' | 'projects' | 'agents';

interface Props {
  activeView: View;
  onNavigate: (view: View) => void;
  connected: boolean;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  events?: WsEvent[];
}

const NAV_ITEMS: { view: View; label: string; icon: string }[] = [
  { view: 'assistant', label: 'Assistant', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  { view: 'channels', label: 'Channels', icon: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.86 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z' },
  { view: 'stats', label: 'Stats', icon: 'M18 20V10M12 20V4M6 20v-6' },
  { view: 'projects', label: 'Projects', icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' },
  { view: 'agents', label: 'Agents', icon: 'M12 8c0 2.21-1.79 4-4 4s-4-1.79-4-4 1.79-4 4-4 4 1.79 4 4zm-6 12v-2a6 6 0 0 1 12 0v2' },
];

function formatSessionLabel(info: SessionInfo): string {
  const ago = getRelativeTime(Date.now() - info.updatedAt);
  return `${info.provider} · ${ago}`;
}

function getRelativeTime(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
}

function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function estimateCostClient(
  model: string,
  inputTokens: number,
  outputTokens: number,
  customCost?: string,
): number {
  if (customCost) {
    if (!customCost.includes('|')) {
      const [inStr = '', outStr = ''] = customCost.split(';');
      const inC = parseFloat(inStr);
      const outC = parseFloat(outStr);
      if (!isNaN(inC) && !isNaN(outC)) {
        return (inputTokens * inC + outputTokens * outC) / 1_000_000;
      }
    } else {
      const rawTiers = customCost.split('|').map(s => s.trim());
      const tiers: Array<{ threshold?: number; in: number; out: number }> = [];
      const [inStr = '', outStr = ''] = rawTiers[0]?.split(';') ?? ['', ''];
      const baseIn = parseFloat(inStr);
      const baseOut = parseFloat(outStr);
      if (!isNaN(baseIn) && !isNaN(baseOut)) {
        tiers.push({ in: baseIn, out: baseOut });
        for (let i = 1; i < rawTiers.length; i++) {
          const tier = rawTiers[i]!;
          const pipeIdx = tier.indexOf('<');
          if (pipeIdx !== -1) {
            const threshold = parseInt(tier.substring(0, pipeIdx).trim(), 10);
            const rest = tier.substring(pipeIdx + 1).trim();
            const [tierInStr = '', tierOutStr = ''] = rest.split(';');
            const tierIn = parseFloat(tierInStr);
            const tierOut = parseFloat(tierOutStr);
            if (!isNaN(threshold) && !isNaN(tierIn) && !isNaN(tierOut)) {
              tiers.push({ threshold, in: tierIn, out: tierOut });
            }
          }
        }
      }
      if (tiers.length > 0) {
        let rate = [tiers[0]!.in, tiers[0]!.out];
        const total = inputTokens + outputTokens;
        for (const t of tiers) {
          if (t.threshold !== undefined && total >= t.threshold) {
            rate = [t.in, t.out];
          }
        }
        return (inputTokens * rate[0]! + outputTokens * rate[1]!) / 1_000_000;
      }
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

export default function Sidebar({
  activeView, onNavigate, connected,
  sessions, activeSessionId, onNewChat, onSelectSession,
  events = [],
}: Props) {
  const { providers, get, set } = useConfig();
  const currentProvider = get('current_provider') as string | undefined;
  const model = get('model') as string | undefined;

  const activeProvider = providers.find(p => p.name === currentProvider && p.configured)
    || providers.find(p => p.configured)
    || { name: 'none', model: '', url: '', configured: false, model_cost: '' };

  const cycleProvider = () => {
    const configured = providers.filter(p => p.configured);
    if (configured.length <= 1) return;
    const idx = configured.findIndex(p => p.name === activeProvider.name);
    const next = configured[(idx + 1) % configured.length];
    set('current_provider', next.name);
    if (next.model) set('model', next.model);
  };

  const usageEvents = events.filter(e => e.type === 'usage') as any[];
  const totalTokens = usageEvents.reduce((acc, curr) => acc + (curr.inputTokens || 0) + (curr.outputTokens || 0), 0);
  const latestUsage = usageEvents[usageEvents.length - 1];
  const contextTokens = latestUsage ? (latestUsage.inputTokens || 0) : 0;
  const customCost = activeProvider.model_cost || undefined;
  const cost = usageEvents.reduce((acc, curr) => {
    return acc + estimateCostClient(
      model || activeProvider.model || '',
      curr.inputTokens || 0,
      curr.outputTokens || 0,
      customCost
    );
  }, 0);

  return (
    <aside className="w-[232px] bg-s1 border-r border-b1 flex flex-col overflow-hidden shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-3 py-4 border-b border-b1">
        <img
          src="/icons/logo-512.png"
          alt="Curie Logo"
          className="w-[22px] h-[22px] object-contain rounded-[5px] shrink-0"
        />
        <span className="text-[13px] font-semibold text-fg">curie-agent</span>
        <span className="text-[10px] text-muted font-mono">v0.2.4</span>
      </div>

      {/* Sessions */}
      <div className="border-b border-b1 px-2 py-2">
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="text-[10px] font-medium text-muted uppercase tracking-wider">Sessions</span>
          <button
            className="text-muted hover:text-fg transition-colors duration-100"
            onClick={onNewChat}
            title="New Chat"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
        <div className="space-y-0.5 max-h-[200px] overflow-y-auto scrollbar-thin">
          {sessions.length === 0 && (
            <div className="text-[10.5px] text-muted2 px-1 py-1">No sessions yet</div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`w-full text-left px-1.5 py-1 rounded-[4px] text-[11px] truncate transition-colors duration-100 ${s.id === activeSessionId
                ? 'text-fg bg-s3'
                : 'text-muted hover:text-text hover:bg-s2'
                }`}
              onClick={() => onSelectSession(s.id)}
              title={formatSessionLabel(s)}
            >
              {s.name || s.provider} ({s.type || 'webui'})
            </button>
          ))}
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {NAV_ITEMS.map((item) => (
          <div
            key={item.view}
            className={`flex items-center gap-2 px-3.5 py-1.5 cursor-pointer transition-colors duration-100 select-none ${activeView === item.view ? 'text-fg bg-s3' : 'text-muted hover:text-text hover:bg-s2'
              }`}
            onClick={() => onNavigate(item.view)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d={item.icon} />
            </svg>
            <span className="text-[13px]">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-b1 px-3 py-2.5 space-y-2">
        <div
          className="flex items-center gap-2 px-1 py-1.5 rounded-[6px] cursor-pointer hover:bg-s2 transition-colors duration-100"
          onClick={cycleProvider}
          title="Click to cycle configured providers"
        >
          <div className={`w-[6px] h-[6px] rounded-full shrink-0 ${connected ? 'bg-green' : 'bg-muted2'}`} />
          <div className="flex-1 min-w-0">
            <div className="text-[11.5px] text-text font-medium">{activeProvider.name || 'none'}</div>
            <div className="text-[10.5px] text-muted font-mono truncate">{model || activeProvider.model || ''}</div>
          </div>
        </div>

        {activeSessionId && (
          <div className="px-2 py-2 bg-s2 rounded-[6px] border border-b1 text-[11px] font-mono space-y-1 select-none">
            <div className="flex justify-between text-muted2 border-b border-b1 pb-1 mb-1 text-[10px]">
              <span>Session:</span>
              <span className="text-fg font-semibold">{activeSessionId.slice(0, 8)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Total Tok:</span>
              <span className="text-text">{formatTokenCount(totalTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Active Ctx:</span>
              <span className="text-text">{formatTokenCount(contextTokens)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Cost:</span>
              <span className="text-green font-semibold">${cost.toFixed(4)}</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

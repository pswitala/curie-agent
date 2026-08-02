import { useState, useEffect, useRef } from 'react';
import { formatDuration, formatRelative, formatTime, formatToolArgs, formatTokenCount } from '../lib/format.js';
import type { WsClient, WsEvent } from '../lib/ws-client.js';

const EVENT_TYPES = [
  'agent-start',
  'agent-tool-call',
  'agent-tool-result',
  'agent-text-delta',
  'agent-thinking-delta',
  'agent-done',
  'agent-error',
] as const;

/** Coalescing kinds — consecutive deltas from the same agent merge into one row. */
const DELTA_TYPES = new Set(['agent-text-delta', 'agent-thinking-delta']);

const BUFFER_SIZE = 50;
const VISIBLE = 20;

/** Palette for per-agent badges, keyed by a hash of the agent id. */
const AGENT_COLORS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8'];

interface FeedEntry {
  seq: number;
  type: string;
  agentId: string;
  timestamp: number;
  /** Accumulated character count for coalesced delta rows. */
  charCount: number;
  event: WsEvent;
}

type Tone = 'green' | 'yellow' | 'red' | 'gold' | 'muted';

interface Descriptor {
  label: string;
  detail: string;
  tone: Tone;
  /** Errors get a wrapped, multi-line detail instead of a truncated one. */
  wrapDetail?: boolean;
}

function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return AGENT_COLORS[hash % AGENT_COLORS.length];
}

/** Coerce an untyped wire field to a display string without `[object Object]`. */
function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Map a raw agent event onto a human-readable row. Returns null for rows we drop. */
function describeEvent(entry: FeedEntry): Descriptor | null {
  const e = entry.event as Record<string, unknown>;

  switch (entry.type) {
    case 'agent-start': {
      const prompt = str(e.prompt);
      return {
        label: 'Agent started',
        detail: prompt ? `"${prompt}"` : '',
        tone: 'yellow',
      };
    }

    case 'agent-tool-call': {
      const name = str(e.name) || 'tool';
      const input = (e.input ?? {}) as Record<string, unknown>;
      return {
        label: name,
        detail: formatToolArgs(name, input),
        tone: 'gold',
      };
    }

    case 'agent-tool-result': {
      // Successful results are covered by the preceding tool-call row; only failures surface.
      const error = str(e.error);
      if (!error) return null;
      return {
        label: 'Tool failed',
        detail: error,
        tone: 'red',
        wrapDetail: true,
      };
    }

    case 'agent-thinking-delta':
      return {
        label: 'Thinking…',
        detail: `${formatTokenCount(entry.charCount)} chars`,
        tone: 'muted',
      };

    case 'agent-text-delta':
      return {
        label: 'Streaming…',
        detail: `${formatTokenCount(entry.charCount)} chars`,
        tone: 'muted',
      };

    case 'agent-done': {
      const parts: string[] = [];
      if (typeof e.toolCalls === 'number') parts.push(`${String(e.toolCalls)} tools`);
      if (typeof e.durationMs === 'number') parts.push(formatDuration(e.durationMs));
      return {
        label: 'Completed',
        detail: parts.join(' · '),
        tone: 'green',
      };
    }

    case 'agent-error':
      return {
        label: 'Failed',
        detail: str(e.message),
        tone: 'red',
        wrapDetail: true,
      };

    default:
      return { label: entry.type, detail: '', tone: 'muted' };
  }
}

const TONE_DOT: Record<Tone, string> = {
  green: 'bg-green',
  yellow: 'bg-yellow',
  red: 'bg-red',
  gold: 'bg-gold',
  muted: 'bg-muted2',
};

const TONE_TEXT: Record<Tone, string> = {
  green: 'text-green',
  yellow: 'text-yellow',
  red: 'text-red',
  gold: 'text-gold',
  muted: 'text-muted',
};

export default function AgentEventsFeed({ ws }: { ws: WsClient | null }) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  // Monotonic across resubscribes so React keys never collide with retained entries.
  const seqRef = useRef(0);

  // Subscribe once per client; unsubscribe on unmount so handlers don't pile up.
  useEffect(() => {
    if (!ws) return;

    const handle = (type: string) => (event: WsEvent) => {
      setEntries((prev) => {
        const agentId = str((event as Record<string, unknown>).agentId);
        const text = str((event as Record<string, unknown>).text);

        // Collapse a run of deltas from the same agent into a single growing row.
        if (DELTA_TYPES.has(type)) {
          // `prev[0]` is typed non-nullable, so guard on length rather than on the value.
          const head = prev[0];
          if (prev.length > 0 && head.type === type && head.agentId === agentId) {
            const merged: FeedEntry = {
              ...head,
              charCount: head.charCount + text.length,
              timestamp: event.timestamp,
            };
            return [merged, ...prev.slice(1)];
          }
          return [{ seq: seqRef.current++, type, agentId, timestamp: event.timestamp, charCount: text.length, event }, ...prev].slice(0, BUFFER_SIZE);
        }

        return [{ seq: seqRef.current++, type, agentId, timestamp: event.timestamp, charCount: 0, event }, ...prev].slice(0, BUFFER_SIZE);
      });
    };

    const unsubs = EVENT_TYPES.map((type) => ws.on(type, handle(type)));
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [ws]);

  // Keep relative timestamps fresh.
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(timer); };
  }, []);

  if (!ws) return null;

  const rows = entries
    .map((entry) => ({ entry, desc: describeEvent(entry) }))
    .filter((r): r is { entry: FeedEntry; desc: Descriptor } => r.desc !== null)
    .slice(0, VISIBLE);

  return (
    <div>
      <div className="h-px bg-b1 my-5" />
      <div className="text-[11.5px] font-medium text-muted mb-2.5">Live Agent Events</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted2 px-3 py-2">Waiting for agent activity…</div>
      ) : (
        rows.map(({ entry, desc }) => (
          <div key={entry.seq} className="flex items-start gap-3 px-3 py-1.5 rounded-lg mb-0.5 hover:bg-s2 transition-colors">
            <div className={`w-[6px] h-[6px] rounded-full shrink-0 mt-[6px] ${TONE_DOT[desc.tone]}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[12px] font-mono font-medium ${TONE_TEXT[desc.tone]}`}>{desc.label}</span>
              </div>
              {desc.detail && (
                <div
                  className={`text-xs text-muted ${desc.wrapDetail ? 'whitespace-pre-wrap break-words' : 'truncate'}`}
                  title={desc.detail}
                >
                  {desc.detail}
                </div>
              )}
            </div>
            {entry.agentId && (
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-[3px] shrink-0 mt-[2px]"
                style={{
                  color: `var(${agentColor(entry.agentId)})`,
                  background: `color-mix(in srgb, var(${agentColor(entry.agentId)}) 12%, transparent)`,
                }}
                title={entry.agentId}
              >
                {entry.agentId.slice(0, 4)}
              </span>
            )}
            <span className="text-[10px] text-muted font-mono shrink-0 mt-[3px] w-[52px] text-right" title={formatTime(entry.timestamp)}>
              {formatRelative(entry.timestamp, now)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

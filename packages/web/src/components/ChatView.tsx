import { useState, useRef, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import { useApi } from '../lib/api-context.js';
import ChatInput from './ChatInput.js';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';
import type { WsEvent } from '../lib/ws-client.js';

interface Props {
  cmdResult: string;
  rpc: JsonRpcClient | null;
  className?: string;
  activeSessionId: string | null;
  onCreateSession?: (sessionId: string) => void;
  onClearCmdResult?: () => void;
  events: WsEvent[];
  addLiveEvent: (event: WsEvent) => void;
  totalTokens?: number;
  contextTokens?: number;
  costUsd?: number;
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-5 py-1 animate-fadeIn">
      <div
        className="rounded-lg overflow-hidden cursor-pointer select-none transition-all duration-150"
        style={{
          background: 'linear-gradient(135deg, var(--s2) 0%, var(--s1) 100%)',
          border: '1px solid var(--b1)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'color-mix(in srgb, var(--s2) 80%, transparent)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" className="shrink-0" style={{ opacity: 0.7 }}>
            <path d="M12 2a7 7 0 0 0-7 7c0 3 2 5 2 8h10c0-3 2-5 2-8a7 7 0 0 0-7-7z" />
            <circle cx="9" cy="9" r="1" fill="currentColor" />
            <circle cx="15" cy="9" r="1" fill="currentColor" />
          </svg>
          <span className="text-[11.5px] font-medium text-text font-mono">
            {expanded ? 'Hide thinking' : 'Thinking...'}
          </span>
          <div className="flex-1" />
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        {expanded && (
          <div className="px-3 py-2.5" style={{ borderTop: '1px solid var(--b1)', background: 'color-mix(in srgb, var(--s1) 60%, transparent)' }}>
            <pre className="text-[11px] text-muted leading-relaxed whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
              {content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolGroupBlock({ toolCalls }: { toolCalls: ToolCallEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-5 py-1 animate-fadeIn">
      <div className="rounded-lg overflow-hidden mb-1" style={{
        background: 'linear-gradient(135deg, var(--s2) 0%, var(--s1) 100%)',
        border: '1px solid var(--b1)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none transition-all duration-150"
          style={{ background: 'color-mix(in srgb, var(--s2) 80%, transparent)' }}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="w-[14px] h-[14px] rounded-[3px] flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--gold) 15%, var(--s3))' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" style={{ opacity: 0.7 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <span className="text-[11.5px] font-medium text-text font-mono">
            {toolCalls.length} tool call{toolCalls.length > 1 ? 's' : ''}
          </span>
          <div className="flex-1" />
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        {expanded && toolCalls.map((tc, j) => (
          <div key={j} className="px-3 py-2.5 first:border-t-0" style={{ borderTop: '1px solid var(--b1)', background: 'color-mix(in srgb, var(--s1) 60%, transparent)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11.5px] font-semibold font-mono" style={{ color: 'var(--gold)' }}>{tc.name}</span>
              <span className="text-xs text-muted font-mono truncate max-w-[250px]">{tc.args}</span>
            </div>
            <pre className="text-[11px] text-muted font-mono leading-[1.5] overflow-x-auto whitespace-pre-wrap">{tc.input ? JSON.stringify(tc.input, null, 2) : ''}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeartbeatBlock({ event }: { event: any }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-5 py-1 animate-fadeIn">
      <div className="rounded-lg overflow-hidden mb-1" style={{
        background: 'linear-gradient(135deg, var(--s2) 0%, var(--s1) 100%)',
        border: '1px solid var(--b1)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none transition-all duration-150"
          style={{ background: 'color-mix(in srgb, var(--s2) 80%, transparent)' }}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="w-[14px] h-[14px] rounded-[3px] flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--red) 15%, var(--s3))' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.5">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </div>
          <span className="text-[11.5px] font-semibold text-fg font-mono">
            Heartbeat Brief ({event.scheduleType})
          </span>
          <div className="flex-1" />
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`text-muted transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        {expanded && (
          <div className="px-3 py-3 markdown-body" style={{ borderTop: '1px solid var(--b1)', background: 'color-mix(in srgb, var(--s1) 60%, transparent)' }}>
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(event.formattedText || '') }} />
          </div>
        )}
      </div>
    </div>
  );
}

function ReminderBlock({ message, time }: { message: string; time: string }) {
  return (
    <div className="px-5 py-1.5 animate-fadeIn">
      <div className="p-3.5 rounded-xl backdrop-blur-md shadow-lg max-w-[480px] flex gap-3 transition-all duration-200 relative overflow-hidden group" style={{
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 8%, var(--s2)), color-mix(in srgb, var(--gold) 4%, var(--s1)))',
        border: '1px solid color-mix(in srgb, var(--gold) 20%, var(--b1))',
      }}>
        {/* Decorative dynamic pulse background indicator */}
        <div className="absolute top-0 right-0 w-24 h-24 rounded-full filter blur-xl opacity-30 group-hover:scale-125 transition-transform duration-500" style={{ background: 'var(--gold)' }} />
        
        {/* Ringing Bell Icon with pulse animation */}
        <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 relative" style={{ background: 'color-mix(in srgb, var(--gold) 15%, transparent)', color: 'var(--gold)' }}>
          <span className="absolute inset-0 rounded-lg animate-ping opacity-50" style={{ background: 'color-mix(in srgb, var(--gold) 20%, transparent)', animationDuration: '2s' }} />
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-wiggle">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>

        {/* Content details */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-2 mb-1 select-none">
            <span className="font-bold text-xs tracking-wide uppercase" style={{ color: 'var(--gold)' }}>Reminder Fired</span>
            <span className="text-[10px] text-muted font-mono">{time}</span>
          </div>
          <div className="text-[13px] text-text leading-relaxed font-semibold">
            {message}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderMarkdown(content: string): string {
  try {
    return marked.parse(content) as string;
  } catch {
    return escapeHtml(content);
  }
}

interface ToolCallEntry {
  name: string;
  args: string;
  input: Record<string, unknown>;
}

interface ApprovalBlockProps {
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
  decision: string;
  events: WsEvent[];
  rpc: JsonRpcClient | null;
  mode?: string;
}

function ApprovalBlock({ toolCallId, name, input, decision, events, rpc, mode }: ApprovalBlockProps) {
  const [deciding, setDeciding] = useState(false);
  const [localDecision, setLocalDecision] = useState<'allow' | 'deny' | null>(null);

  // Find if there is already a decision in the session history
  const decisionEvent = events.find(
    (e) => e.type === 'approval-decision' && (e as any).toolCallId === toolCallId
  ) as any;

  const resolvedDecision = decisionEvent ? decisionEvent.decision : localDecision;
  const isPending = decision === 'ask' && !resolvedDecision;

  const handleDecide = async (choice: 'allow' | 'deny') => {
    if (!rpc) return;
    setDeciding(true);
    try {
      await rpc.approvalDecide(toolCallId, choice);
      setLocalDecision(choice);
    } catch (err) {
      console.error('Failed to submit tool approval decision:', err);
    } finally {
      setDeciding(false);
    }
  };

  if (!isPending) {
    const isApproved = resolvedDecision === 'allow';
    return (
      <div className="px-5 py-1.5 flex items-center gap-2.5 animate-fadeIn select-none">
        <div className={`flex items-center justify-center w-5 h-5 rounded-full ${
          isApproved ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
        } shrink-0`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            {isApproved ? (
              <polyline points="20 6 9 17 4 12" />
            ) : (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            )}
          </svg>
        </div>
        <div className="flex items-baseline gap-1.5 text-xs text-muted">
          <span className="font-semibold text-fg">
            {isApproved ? 'Authorized' : 'Blocked'}
          </span>
          <span>action:</span>
          <code className="font-mono bg-s3 border border-b1 px-1.5 py-0.5 rounded text-[11px] text-fg">{name}</code>
        </div>
      </div>
    );
  }

  if (mode === 'auto') {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="w-full max-w-[480px] p-6 rounded-2xl border border-b2 bg-s2/95 backdrop-blur-md shadow-2xl transition-all duration-200 transform scale-100 animate-scaleIn">
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-b1 pb-4 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-yellow-500/10 text-yellow-500 shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-bold text-fg text-base block mb-0.5">Authorization Required</span>
            <span className="text-[12px] text-muted">The agent requires permission to run this action.</span>
          </div>
        </div>

        {/* Action Detail */}
        <div className="mb-4">
          <div className="text-[9px] text-muted2 font-mono uppercase tracking-wider mb-1.5 select-none">Action / Tool</div>
          <div className="flex items-center">
            <code className="font-mono bg-s3 border border-b1 px-2.5 py-1 rounded-lg text-xs text-fg font-semibold">{name}</code>
          </div>
        </div>

        {/* Input arguments rendering */}
        <div className="bg-s1 rounded-xl border border-b1 p-4 mb-6 max-h-[220px] overflow-y-auto scrollbar-thin">
          <div className="text-[9px] text-muted2 font-mono uppercase tracking-wider mb-1.5 select-none">Arguments</div>
          <pre className="font-mono text-[11.5px] text-text overflow-x-auto m-0 leading-normal">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleDecide('allow')}
            disabled={deciding}
            className="flex-1 py-2 px-4 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold text-[13px] shadow-lg shadow-green-600/10 hover:shadow-green-600/20 transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Approve Action
          </button>
          <button
            onClick={() => handleDecide('deny')}
            disabled={deciding}
            className="py-2 px-5 rounded-xl bg-s3 border border-b2 hover:bg-s4 text-fg hover:text-text hover:border-b3 font-semibold text-[13px] transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}

type MessageEntry =
  | { type: 'thinking'; content: string; key: string }
  | { type: 'user'; content: string; time: string }
  | { type: 'assistant'; content: string; time: string }
  | { type: 'tool-group'; content: ''; time: ''; toolCalls: ToolCallEntry[] }
  | { type: 'heartbeat-brief'; content: string; time: string; event: any }
  | { type: 'approval-request'; toolCallId: string; name: string; input: Record<string, unknown>; decision: string; mode?: string; time: string }
  | { type: 'reminder-fired'; message: string; taskId: string; time: string };

function eventToMessage(event: WsEvent): MessageEntry | null {
  switch (event.type) {
    case 'user-prompt':
      return { type: 'user', content: (event as any).text || '', time: formatTime(event.timestamp) };
    case 'assistant-delta':
      return { type: 'assistant', content: (event as any).text || '', time: formatTime(event.timestamp) };
    case 'thinking-delta':
      return {
        type: 'thinking',
        content: (event as any).text || '',
        key: `${event.timestamp}-${event.id}`,
      };
    case 'heartbeat-brief':
      return {
        type: 'heartbeat-brief',
        content: (event as any).formattedText || '',
        time: formatTime(event.timestamp),
        event,
      };
    case 'tool-call': {
      const name = (event as any).name || 'tool';
      const input = (event as any).input || {};
      const args = Object.keys(input).join(', ');
      return {
        type: 'tool-group',
        content: '',
        time: '',
        toolCalls: [{ name, args, input }],
      };
    }
    case 'approval-request': {
      const toolCallId = (event as any).toolCallId;
      const name = (event as any).name || 'tool';
      const input = (event as any).input || {};
      const decision = (event as any).decision;
      const mode = (event as any).mode;
      return {
        type: 'approval-request',
        toolCallId,
        name,
        input,
        decision,
        mode,
        time: formatTime(event.timestamp),
      };
    }
    case 'cron-task-fired': {
      const message = (event as any).message || '';
      const taskId = (event as any).taskId || '';
      return {
        type: 'reminder-fired',
        message,
        taskId,
        time: formatTime(event.timestamp),
      };
    }
    case 'context-warning':
      return {
        type: 'assistant',
        content: (event as any).message || '',
        time: formatTime(event.timestamp),
      };
    default:
      return null;
  }
}

export default function ChatView({ cmdResult, rpc, className, activeSessionId, onCreateSession, onClearCmdResult, events, addLiveEvent, totalTokens, contextTokens, costUsd }: Props) {
  const { ws, connected } = useApi();
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localCmd, setLocalCmd] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (connected) {
      setError(prev => prev === 'Disconnected from daemon. Check that the daemon is running.' ? null : prev);
    } else {
      // Delay showing the disconnection error slightly to avoid a visual flash
      // on initial connect/handshake which typically completes in <200ms.
      const timer = setTimeout(() => {
        setError('Disconnected from daemon. Check that the daemon is running.');
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [connected]);

  // The server returns the new sessionId immediately via rpc.sessionSend.
  // We no longer listen to global user-prompt events here because it causes
  // unrelated clients to be pulled into sessions started by other devices.

  const messages = events.reduce((msgs: MessageEntry[], event: WsEvent) => {
    const msg = eventToMessage(event);
    if (!msg) return msgs;

    if (msg.type === 'thinking' && msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      if (last.type === 'thinking') {
        last.content += msg.content;
      } else {
        msgs.push(msg);
      }
    }
    else if (msg.type === 'assistant' && msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      if (last.type === 'assistant') {
        last.content += msg.content;
      } else {
        msgs.push(msg);
      }
    }
    else if (msg.type === 'tool-group' && msgs.length > 0) {
      const tg = msg as MessageEntry & { toolCalls: ToolCallEntry[] };
      const last = msgs[msgs.length - 1];
      if (last.type === 'tool-group') {
        const lastTg = last as MessageEntry & { toolCalls: ToolCallEntry[] };
        lastTg.toolCalls.push(...tg.toolCalls);
      } else {
        msgs.push(msg);
      }
    }
    else {
      msgs.push(msg);
    }
    return msgs;
  }, []);

  const shouldAutoScrollRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
      shouldAutoScrollRef.current = true;
    }
  }, []);

  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      shouldAutoScrollRef.current = nearBottom;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (shouldAutoScrollRef.current) scrollToBottom();
  }, [messages, typing, scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
    if (cmdResult) {
      console.log('Command palette result:', cmdResult);
      setLocalCmd(cmdResult);
      onClearCmdResult?.();
    }
  }, [cmdResult, onClearCmdResult]);

  const handleSend = useCallback(async (text: string) => {
    if (!rpc) {
      setError('Not connected to daemon. Make sure the daemon is running.');
      return;
    }

    setTyping(true);
    setError(null);
    scrollToBottom();

    // Check for client-side /heartbeat slash command interception
    if (text.startsWith('/')) {
      const match = text.match(/^\/([^\s]+)(?:\s+(.*))?$/);
      if (match) {
        const command = match[1].toLowerCase();
        const args = (match[2] || '').trim();

        if (command === 'heartbeat') {
          // Echo user command
          addLiveEvent({
            type: 'user-prompt',
            id: `local-prompt-${Date.now()}`,
            timestamp: Date.now(),
            text: text,
          });

          const action = args.toLowerCase();
          if (action === 'now') {
            addLiveEvent({
              type: 'assistant-delta',
              id: `local-running-${Date.now()}`,
              timestamp: Date.now(),
              text: 'Executing immediate heartbeat cycle in background...',
            });
            try {
              await rpc.heartbeatRun();
              // When finished, the daemon automatically broadcasts 'heartbeat-brief' over WebSocket,
              // which appends the collapsible HeartbeatBlock to the UI naturally.
              setTyping(false);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              addLiveEvent({
                type: 'error',
                id: `local-err-${Date.now()}`,
                timestamp: Date.now(),
                message: `Heartbeat failed: ${errMsg}`,
              });
              setTyping(false);
            }
          } else if (action === 'status' || action === '') {
            try {
              const hb = await rpc.heartbeatStatus() as any;
              const active = hb?.schedule === 'on';
              const intradayDisplay = hb?.intraday || '(not set)';
              const statusMd = `### Heartbeat Cycle Status:
* **Enabled**: \`${active ? 'yes' : 'no'}\`
* **Intraday**: \`${intradayDisplay}\`
* **Daily**: \`${hb?.daily || '6:00'}\`
* **Weekly**: \`${hb?.weekly || 'monday@6:00'}\`
* **Monthly**: \`${hb?.monthly || '1@6:00'}\`
* **Dreaming**: \`${hb?.dreaming || '2:00'}\`

**Usage**:
* \`/heartbeat enable\` / \`/heartbeat disable\`
* \`/heartbeat daily <H:MM>\`
* \`/heartbeat weekly <day@H:MM>\`
* \`/heartbeat monthly <D@H:MM>\`
* \`/heartbeat dreaming <H:MM>\`
* \`/heartbeat intraday <H:MM,...>\`
* \`/heartbeat now\` — run a heartbeat immediately.`;

              addLiveEvent({
                type: 'assistant-delta',
                id: `local-status-${Date.now()}`,
                timestamp: Date.now(),
                text: statusMd,
              });
              setTyping(false);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              addLiveEvent({
                type: 'error',
                id: `local-err-${Date.now()}`,
                timestamp: Date.now(),
                message: `Failed to fetch heartbeat status: ${errMsg}`,
              });
              setTyping(false);
            }
          } else if (action === 'enable') {
            try {
              await rpc.configSet('heartbeat.schedule', 'on');
              addLiveEvent({
                type: 'assistant-delta',
                id: `local-enable-${Date.now()}`,
                timestamp: Date.now(),
                text: 'Heartbeat cycle has been enabled successfully.',
              });
              setTyping(false);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              addLiveEvent({
                type: 'error',
                id: `local-err-${Date.now()}`,
                timestamp: Date.now(),
                message: `Failed to enable heartbeat: ${errMsg}`,
              });
              setTyping(false);
            }
          } else if (action === 'disable') {
            try {
              await rpc.configSet('heartbeat.schedule', 'off');
              addLiveEvent({
                type: 'assistant-delta',
                id: `local-disable-${Date.now()}`,
                timestamp: Date.now(),
                text: 'Heartbeat cycle has been disabled.',
              });
              setTyping(false);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              addLiveEvent({
                type: 'error',
                id: `local-err-${Date.now()}`,
                timestamp: Date.now(),
                message: `Failed to disable heartbeat: ${errMsg}`,
              });
              setTyping(false);
            }
          } else {
            const parts = args.split(/\s+/);
            const subCmd = parts[0]?.toLowerCase();
            const val = parts.slice(1).join(' ').trim();
            const validSubCmds = ['daily', 'weekly', 'monthly', 'dreaming', 'intraday'];
            if (validSubCmds.includes(subCmd)) {
              try {
                await rpc.configSet(`heartbeat.${subCmd}`, val);
                addLiveEvent({
                  type: 'assistant-delta',
                  id: `local-set-${Date.now()}`,
                  timestamp: Date.now(),
                  text: `Heartbeat schedule for \`${subCmd}\` has been set to: \`${val}\``,
                });
                setTyping(false);
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                addLiveEvent({
                  type: 'error',
                  id: `local-err-${Date.now()}`,
                  timestamp: Date.now(),
                  message: `Failed to set heartbeat schedule: ${errMsg}`,
                });
                setTyping(false);
              }
            } else {
              addLiveEvent({
                type: 'assistant-delta',
                id: `local-unknown-${Date.now()}`,
                timestamp: Date.now(),
                text: `Unknown heartbeat command. Supported subcommands: \`status\`, \`enable\`, \`disable\`, \`daily\`, \`weekly\`, \`monthly\`, \`dreaming\`, \`intraday\`, \`now\`.`,
              });
              setTyping(false);
            }
          }
          return;
        } else if (command === 'cron') {
          // Echo user command
          addLiveEvent({
            type: 'user-prompt',
            id: `local-prompt-${Date.now()}`,
            timestamp: Date.now(),
            text: text,
          });

          const action = args.toLowerCase();
          const parts = action.split(/\s+/);
          const sub = parts[0] || 'list';
          const rest = parts.slice(1).join(' ').trim();

          if (sub === 'list' || !sub) {
            try {
              const list = await rpc.cronList() as any[];
              if (!list || list.length === 0) {
                addLiveEvent({
                  type: 'assistant-delta',
                  id: `local-cron-list-${Date.now()}`,
                  timestamp: Date.now(),
                  text: 'No reminders scheduled.',
                });
              } else {
                const items = list.map((t: any, i: number) => {
                  const timeStr = new Date(t.scheduledAt).toLocaleString();
                  const statusEmoji = t.status === 'pending' ? '⏳'
                    : t.status === 'fired' ? '🔔'
                    : t.status === 'executing' ? '⚙️'
                    : t.status === 'completed' ? '✅'
                    : t.status === 'failed' ? '❌'
                    : '❌';
                  const typeLabel = t.type === 'heartbeat'
                    ? `Heartbeat: ${t.schedule ? `[${t.schedule.type.toUpperCase()}] ` : ''}`
                    : t.type === 'task'
                      ? 'Task: '
                      : 'Reminder: ';
                  return `${i + 1}. ${statusEmoji} ${typeLabel}${t.message} (Scheduled: ${timeStr}, ID: \`${t.id}\`)`;
                }).join('\n');
                addLiveEvent({
                  type: 'assistant-delta',
                  id: `local-cron-list-${Date.now()}`,
                  timestamp: Date.now(),
                  text: `### Active Reminders:\n${items}`,
                });
              }
              setTyping(false);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              addLiveEvent({
                type: 'error',
                id: `local-err-${Date.now()}`,
                timestamp: Date.now(),
                message: `Failed to fetch reminders: ${errMsg}`,
              });
              setTyping(false);
            }
          } else if (sub === 'delete' || sub === 'cancel') {
            if (!rest) {
              addLiveEvent({
                type: 'assistant-delta',
                id: `local-cron-del-${Date.now()}`,
                timestamp: Date.now(),
                text: 'Usage: `/cron delete <id>`',
              });
              setTyping(false);
            } else {
              try {
                const res = await rpc.cronCancel(rest) as any;
                if (res?.cancelled) {
                  addLiveEvent({
                    type: 'assistant-delta',
                    id: `local-cron-del-${Date.now()}`,
                    timestamp: Date.now(),
                    text: `Reminder \`${rest}\` cancelled.`,
                  });
                } else {
                  addLiveEvent({
                    type: 'assistant-delta',
                    id: `local-cron-del-${Date.now()}`,
                    timestamp: Date.now(),
                    text: `No reminder found with ID: \`${rest}\``,
                  });
                }
                setTyping(false);
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                addLiveEvent({
                  type: 'error',
                  id: `local-err-${Date.now()}`,
                  timestamp: Date.now(),
                  message: `Failed to delete reminder: ${errMsg}`,
                });
                setTyping(false);
              }
            }
          } else if (sub === 'clear') {
            try {
              const res = await rpc.cronClear() as any;
              addLiveEvent({
                type: 'assistant-delta',
                id: `local-cron-clear-${Date.now()}`,
                timestamp: Date.now(),
                text: `Successfully cleared ${res?.removed || 0} completed reminder(s).`,
              });
              setTyping(false);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              addLiveEvent({
                type: 'error',
                id: `local-err-${Date.now()}`,
                timestamp: Date.now(),
                message: `Failed to clear reminders: ${errMsg}`,
              });
              setTyping(false);
            }
          } else {
            addLiveEvent({
              type: 'assistant-delta',
              id: `local-cron-err-${Date.now()}`,
              timestamp: Date.now(),
              text: `Unknown cron subcommand. Supported: \`/cron list\`, \`/cron delete <id>\`, \`/cron clear\`.`,
            });
            setTyping(false);
          }
          return;
        }
      }
    }

    // Use empty id to let server create new session when needed
    // Server returns sessionId immediately and runs TurnLoop in background.
    const sendId = activeSessionId || '';
    try {
      const result = await rpc.sessionSend(sendId, text, 'webui') as { sessionId?: string; status?: string };
      // If server created a new session, set it as active (fallback for race condition)
      if (result?.sessionId && !activeSessionId) {
        ws?.subscribe(result.sessionId);
        onCreateSession?.(result.sessionId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to send: ${msg}`);
      setTyping(false);
    }
  }, [rpc, ws, activeSessionId, scrollToBottom, onCreateSession, addLiveEvent]);

  useEffect(() => {
    if (!ws) return;
    ws.on('assistant-stop', () => setTyping(false));
    ws.on('error', () => setTyping(false));
  }, [ws]);

  return (
    <div className={`flex flex-col h-full ${className || ''}`}>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin" ref={chatRef}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted">
            <div className="text-lg mb-2 font-display" style={{ color: 'var(--cream)' }}>No messages yet</div>
            <div className="text-sm text-muted2">Send a message to start</div>
          </div>
        )}

        <div className="py-4 pb-6">
          {messages.map((msg, i) => {
            if (msg.type === 'thinking') {
              return <ThinkingBlock key={msg.key} content={msg.content} />;
            }

            if (msg.type === 'user') {
               return (
                 <div key={i} className="flex flex-row-reverse px-5 py-0.5 transition-colors duration-100">
                   <div className="flex flex-1 flex-col items-end min-w-0">
                     <div className="flex flex-row-reverse items-baseline gap-2 mb-1">
                       <span className="text-xs font-semibold" style={{ color: 'var(--cream)' }}>you</span>
                       <span className="text-xs text-muted font-mono">{msg.time}</span>
                     </div>
                     <div
                       className="text-[13px] text-text leading-[1.65] chat-msg-user rounded-t-[10px] rounded-bl-[10px] px-3.5 py-2.5 max-w-[480px] markdown-body"
                       dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                     />
                   </div>
                 </div>
               );
             }

             if (msg.type === 'tool-group') {
               const tg = msg as MessageEntry & { toolCalls: ToolCallEntry[] };
               if (tg.toolCalls.length > 0) {
                 return <ToolGroupBlock key={i} toolCalls={tg.toolCalls} />;
               }
             }

              if (msg.type === 'approval-request') {
                return (
                  <ApprovalBlock
                    key={i}
                    toolCallId={msg.toolCallId}
                    name={msg.name}
                    input={msg.input}
                    decision={msg.decision}
                    events={events}
                    rpc={rpc}
                    mode={(msg as any).mode}
                  />
                );
              }

              if (msg.type === 'heartbeat-brief') {
               const hb = msg as MessageEntry & { event: any };
               return <HeartbeatBlock key={i} event={hb.event} />;
             }

             if (msg.type === 'reminder-fired') {
               return <ReminderBlock key={i} message={msg.message} time={msg.time} />;
             }

             return (
               <div key={i} className="px-5 py-0.5 transition-colors duration-100">
                 <div className="flex items-baseline gap-2 mb-1">
                   <span className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>curie-agent</span>
                   <span className="text-xs text-muted font-mono">{msg.time}</span>
                 </div>
                 <div
                   className="text-[13px] text-text leading-[1.65] markdown-body chat-msg-agent pl-3"
                   dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                 />
               </div>
             );
          })}

          {/* Typing indicator */}
          {typing && (
            <div className="flex items-center px-5 py-2">
              <div className="flex gap-1.5">
                <span className="w-[5px] h-[5px] bg-muted2 rounded-full animate-dot inline-block" style={{ animation: 'tdot 1.4s infinite' }} />
                <span className="w-[5px] h-[5px] bg-muted2 rounded-full animate-dot inline-block" style={{ animation: 'tdot 1.4s infinite 0.2s' }} />
                <span className="w-[5px] h-[5px] bg-muted2 rounded-full animate-dot inline-block" style={{ animation: 'tdot 1.4s infinite 0.4s' }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chat input with New Chat button */}
      <div className="flex-shrink-0">
        {/* Error banner */}
        {error && (
          <div className="px-5 py-1.5 bg-red/10 border-t border-red/20">
            <div className="text-[11px] text-red font-mono">{error}</div>
          </div>
        )}
        <ChatInput
          onSend={handleSend}
          cmdInput={localCmd}
          onClearCmdInput={() => setLocalCmd('')}
          totalTokens={totalTokens}
          contextTokens={contextTokens}
          costUsd={costUsd}
        />
      </div>
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import { useApi } from '../lib/api-context.js';
import { useSession } from '../hooks/useSession.js';
import ChatInput from './ChatInput.js';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';
import type { WsEvent } from '../lib/ws-client.js';

interface Props {
  cmdResult: string;
  rpc: JsonRpcClient | null;
  className?: string;
  activeSessionId: string | null;
  onNewChat?: () => void;
  onCreateSession?: (sessionId: string) => void;
  onClearCmdResult?: () => void;
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-5 py-1 animate-fadeIn">
      <div
        className="border border-b2 rounded-lg overflow-hidden cursor-pointer select-none hover:bg-s2/50 transition-colors duration-100"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 px-3 py-2 bg-s2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted shrink-0">
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
          <div className="px-3 py-2.5 border-t border-b1 bg-s1/50">
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
      <div className="border border-b2 rounded-lg overflow-hidden mb-1">
        <div
          className="flex items-center gap-2 px-3 py-2 bg-s2 cursor-pointer select-none hover:bg-s2/50 transition-colors duration-100"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="w-[14px] h-[14px] rounded-[3px] bg-s4 flex items-center justify-center">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5">
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
          <div key={j} className="px-3 py-2.5 border-t border-b1 bg-s1/50 first:border-t-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11.5px] font-semibold text-fg font-mono">{tc.name}</span>
              <span className="text-xs text-muted font-mono truncate max-w-[250px]">{tc.args}</span>
            </div>
            <pre className="text-[11px] text-muted font-mono leading-[1.5] overflow-x-auto whitespace-pre-wrap">{tc.input ? escapeHtml(JSON.stringify(tc.input, null, 2)) : ''}</pre>
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
      <div className="border border-b2 rounded-lg overflow-hidden mb-1">
        <div
          className="flex items-center gap-2 px-3 py-2 bg-s2 cursor-pointer select-none hover:bg-s2/50 transition-colors duration-100"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="w-[14px] h-[14px] rounded-[3px] bg-red/20 flex items-center justify-center">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--red, #ef4444)" strokeWidth="1.5">
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
          <div className="px-3 py-3 border-t border-b1 bg-s1/50 first:border-t-0 markdown-body">
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(event.formattedText || '') }} />
          </div>
        )}
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

type MessageEntry =
  | { type: 'thinking'; content: string; key: string }
  | { type: 'user'; content: string; time: string }
  | { type: 'assistant'; content: string; time: string }
  | { type: 'tool-group'; content: ''; time: ''; toolCalls: ToolCallEntry[] }
  | { type: 'heartbeat-brief'; content: string; time: string; event: any };

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
    default:
      return null;
  }
}

export default function ChatView({ cmdResult, rpc, className, activeSessionId, onNewChat, onCreateSession, onClearCmdResult }: Props) {
  const { ws, connected } = useApi();
  const { events, addLiveEvent } = useSession(activeSessionId);
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

    if (msg.type === 'thinking' && msgs.length > 0 && msgs[msgs.length - 1].type === 'thinking') {
      msgs[msgs.length - 1].content += msg.content;
    }
    else if (msg.type === 'assistant' && msgs.length > 0 && msgs[msgs.length - 1].type === 'assistant') {
      msgs[msgs.length - 1].content += msg.content;
    }
    else if (msg.type === 'tool-group' && msgs.length > 0 && msgs[msgs.length - 1].type === 'tool-group') {
      const tg = msg as MessageEntry & { toolCalls: ToolCallEntry[] };
      const last = msgs[msgs.length - 1] as MessageEntry & { toolCalls: ToolCallEntry[] };
      last.toolCalls.push(...tg.toolCalls);
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
        }
      }
    }

    // Use empty id to let server create new session when needed
    // Server returns sessionId immediately and runs TurnLoop in background.
    const sendId = activeSessionId || '';
    try {
      const result = await rpc.sessionSend(sendId, text) as { sessionId?: string; status?: string };
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
            <div className="text-lg mb-2">No messages yet</div>
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
                 <div key={i} className="flex flex-row-reverse px-5 py-0.5 hover:bg-white/[0.012] transition-colors duration-100">
                   <div className="flex flex-1 flex-col items-end min-w-0">
                     <div className="flex flex-row-reverse items-baseline gap-2 mb-1">
                       <span className="text-xs font-semibold text-fg">you</span>
                       <span className="text-xs text-muted font-mono">{msg.time}</span>
                     </div>
                     <div
                       className="text-[13px] text-text leading-[1.65] bg-s3 border border-b2 rounded-t-[10px] rounded-bl-[10px] px-3.5 py-2.5 max-w-[480px] markdown-body"
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

             if (msg.type === 'heartbeat-brief') {
               const hb = msg as MessageEntry & { event: any };
               return <HeartbeatBlock key={i} event={hb.event} />;
             }

             return (
               <div key={i} className="px-5 py-0.5 hover:bg-white/[0.012] transition-colors duration-100">
                 <div className="flex items-baseline gap-2 mb-1">
                   <span className="text-xs font-semibold text-fg">curie-agent</span>
                   <span className="text-xs text-muted font-mono">{msg.time}</span>
                 </div>
                 <div
                   className="text-[13px] text-text leading-[1.65] markdown-body"
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
        <div className="flex items-center justify-between px-5 pt-2">
          <button
            className="flex items-center gap-1 bg-transparent border border-b2 rounded px-2.5 py-1 text-muted text-xs hover:border-b3 hover:text-fg transition-colors duration-100"
            onClick={onNewChat}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Chat
          </button>
        </div>
        <ChatInput
          onSend={handleSend}
          cmdInput={localCmd}
          onClearCmdInput={() => setLocalCmd('')}
        />
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';

interface Props {
  rpc: JsonRpcClient | null;
  className?: string;
}

export default function ChannelsView({ rpc, className }: Props) {
  const [botToken, setBotToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rpc) return;
    Promise.all([
      rpc.configGet('channels.bot_token').catch(() => null),
      rpc.configGet('channels.user_id').catch(() => null),
      rpc.configGet('channels.chat_id').catch(() => null),
    ]).then(([token, uid, cid]) => {
      setBotToken(token as string | null);
      setUserId(uid as string | null);
      setChatId(cid as string | null);
    }).finally(() => setLoading(false));
  }, [rpc]);

  const connected = !!botToken && !!userId;

  return (
    <div className={`flex-1 overflow-y-auto p-7 scrollbar-thin ${className || ''}`}>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-fg tracking-tight">Channels</h2>
        <button className="flex items-center gap-1 bg-transparent border border-b2 rounded px-3 py-1.5 text-muted text-xs hover:border-b3 hover:text-fg transition-colors duration-100">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Connect
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted">Loading...</div>
      ) : (
        <>
          {/* Connection status */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 bg-s2">
            <div className="w-8 h-8 rounded-lg bg-s3 flex items-center justify-center shrink-0 text-base">
              {connected ? '📱' : '🔌'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-fg">
                {connected ? 'Telegram Connected' : 'Not Connected'}
              </div>
              <div className="text-xs text-muted truncate">
                {connected
                  ? `Bot configured for user ${userId}`
                  : 'Configure a Telegram bot to enable channel messaging'}
              </div>
            </div>
            <div className={`w-[6px] h-[6px] rounded-full shrink-0 ${connected ? 'bg-green' : 'bg-muted2'}`} />
          </div>

          {/* Config details */}
          {connected && (
            <div className="bg-s1 border border-b1 rounded-[10px] overflow-hidden mt-3">
              <div className="text-[12px] font-medium text-text2 px-4 py-3 border-b border-b1">
                Channel Configuration
              </div>
              <ConfigRow label="Bot Token" value={botToken?.slice(0, 12) + '...' || ''} />
              <ConfigRow label="User ID" value={userId || ''} />
              <ConfigRow label="Chat ID" value={chatId || 'not set'} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-b1/50">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs text-text font-mono">{value}</span>
    </div>
  );
}

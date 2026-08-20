import { useState, useRef, useCallback, useEffect } from 'react';
import { useConfig } from '../hooks/useConfig.js';
import { formatTokenCount } from '../lib/format.js';
import type { ContextReport } from '../hooks/useSession.js';

interface Props {
  onSend: (text: string) => void;
  onCancel?: () => void;
  cmdInput?: string;
  onClearCmdInput?: () => void;
  totalTokens?: number;
  contextTokens?: number;
  costUsd?: number;
  /** Latest context-window snapshot from the daemon, when one has arrived. */
  contextReport?: ContextReport | null;
}

/**
 * Always-visible context fill indicator.
 *
 * The footer previously showed a bare `ctx 45.2k` with no denominator, so there
 * was no way to see how close a session was to its limit until it failed.
 * Percentage is against usable tokens (window minus the output reserve), which
 * is what the turn loop actually budgets against.
 */
function ContextGauge({ report, fallbackTokens, windowTokens }: {
  report?: ContextReport | null;
  fallbackTokens: number;
  windowTokens: number;
}) {
  const used = report?.usedTokens ?? fallbackTokens;
  const total = report?.windowTokens || windowTokens;
  const usable = Math.max(1, total - (report?.reservedOutput ?? 0));
  const pct = Math.min(100, Math.round((used / usable) * 100));
  const color = pct >= 85 ? 'var(--red)' : pct >= 50 ? 'var(--yellow)' : 'var(--green)';

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] text-muted font-mono"
      title={`Context: ${formatTokenCount(used)} of ${formatTokenCount(usable)} usable (${formatTokenCount(total)} window)`}
    >
      <span style={{ opacity: 0.6 }}>ctx</span>
      <span
        className="inline-block rounded-full overflow-hidden"
        style={{ width: 36, height: 4, background: 'var(--s3)' }}
      >
        <span className="block h-full rounded-full" style={{ width: `${String(pct)}%`, background: color }} />
      </span>
      <span style={{ color, opacity: 0.85 }}>{`${String(pct)}%`}</span>
      <span style={{ opacity: 0.5 }}>{`${formatTokenCount(used)}/${formatTokenCount(total)}`}</span>
    </span>
  );
}

export default function ChatInput({ onSend, onCancel, cmdInput, onClearCmdInput, totalTokens, contextTokens, costUsd, contextReport }: Props) {
  const { providers, get } = useConfig();
  const currentProvider = get('current_provider') as string | undefined;
  const model = get('model') as string | undefined;
  // `model_context_window` was already fetched by useConfig and had zero consumers.
  const configuredWindow = Number(
    providers.find(p => p.name === currentProvider)?.model_context_window ?? 200_000,
  );

  const activeProvider = providers.find(p => p.name === currentProvider && p.configured)
    || providers.find(p => p.configured)
    || { name: 'none' };

  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (cmdInput) {
      setValue(cmdInput);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          // Put cursor at the end of the text
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = cmdInput.length;
        }
      }, 50);
      onClearCmdInput?.();
    }
  }, [cmdInput, onClearCmdInput]);

  const grow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = value.trim();
      if (!text) return;
      onSend(text);
      setValue('');
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = '';
        }
      }, 0);
    }
  }, [value, onSend]);

  return (
    <div className="px-5 pt-3 pb-7 md:pb-3 bg-transparent">
      <div
        className="glass-card rounded-xl transition-all duration-200"
        style={{
          background: 'linear-gradient(135deg, var(--s2) 0%, color-mix(in srgb, var(--s1) 90%, var(--wood)) 100%)',
          border: '1px solid var(--b2)',
        }}
      >
        {/* Provider + model bar above textarea */}
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10.5px]">
          <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: currentProvider ? 'var(--green)' : 'var(--muted2)', opacity: currentProvider ? 1 : 0.3 }} />
          <span style={{ color: 'var(--gold)', opacity: 0.8 }}>{activeProvider.name}</span>
          <span className="text-muted"> · </span>
          <span className="text-muted">{model || 'no model set'}</span>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="w-full bg-transparent border-0 outline-none text-fg font-sans text-[13.5px] px-3.5 py-2.5 resize-none leading-[1.5]"
          style={{ color: 'var(--cream)' }}
          rows={1}
          placeholder="Message curie-agent..."
          value={value}
          onChange={(e) => { setValue(e.target.value); grow(); }}
          onKeyDown={handleKey}
        />

        {/* Footer */}
        <div className="flex items-center px-3 pb-2.5 pt-1">
          {totalTokens !== undefined ? (
            <>
              <span className="text-[10px] text-muted font-mono" style={{ opacity: 0.6 }}>{formatTokenCount(totalTokens)} tokens</span>
              <span className="opacity-30 mx-1"> · </span>
              <ContextGauge report={contextReport} fallbackTokens={contextTokens ?? 0} windowTokens={configuredWindow} />
              <span className="opacity-30 mx-1"> · </span>
              <span className="text-[10px] text-muted font-mono" style={{ color: 'var(--green)', opacity: 0.6 }}>${(costUsd ?? 0).toFixed(4)}</span>
              <div className="flex-1" />
            </>
          ) : null}
          {onCancel ? (
            <button
              className="w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 rounded-lg"
              style={{ background: 'var(--red)', color: '#fff' }}
              onClick={onCancel}
              title="Stop agent"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              className="btn-gold rounded-lg w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
              onClick={() => {
                const text = value.trim();
                if (text) { onSend(text); setValue(''); }
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a1410" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

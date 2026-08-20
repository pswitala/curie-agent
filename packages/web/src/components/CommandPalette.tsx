import { useState, useRef, useEffect, useCallback } from 'react';
import { SLASH_COMMANDS } from '@curie-agent/protocol';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (cmd: string) => void;
}

/**
 * Generated from the shared registry rather than hand-maintained.
 *
 * The previous hardcoded list had drifted: it omitted `/system`, `/skill`,
 * `/todo` and `/cd`, and advertised client-only commands the web has no
 * handler for — those were forwarded to the daemon, which answered
 * "handled by the interface, not the daemon".
 */
const CLIENT_HANDLED_IN_WEB = new Set(['wiki']);

const CMDS: [string, string][] = SLASH_COMMANDS
  .filter((c) => c.handler === 'daemon' || CLIENT_HANDLED_IN_WEB.has(c.name))
  .map((c): [string, string] => [c.usage || `/${c.name}`, c.description]);

export default function CommandPalette({ open, onClose, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? CMDS.filter(([c, d]) => c.includes(query.toLowerCase()) || d.toLowerCase().includes(query.toLowerCase()))
    : CMDS;

  const pick = useCallback((cmd: string) => {
    onClose();
    onPick(cmd);
  }, [onClose, onPick]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { setIndex((i) => Math.min(i + 1, filtered.length - 1)); e.preventDefault(); }
    if (e.key === 'ArrowUp') { setIndex((i) => Math.max(i - 1, 0)); e.preventDefault(); }
    if (e.key === 'Enter' && filtered[index]) pick(filtered[index][0]);
  }, [filtered, index, onClose, pick]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[120px]"
      style={{ background: 'rgba(10, 8, 5, 0.85)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-[560px] rounded-xl overflow-hidden animate-scaleIn"
        style={{
          background: 'linear-gradient(135deg, var(--s2) 0%, var(--s1) 100%)',
          border: '1px solid var(--b2)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--b1)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" className="shrink-0" style={{ opacity: 0.7 }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-0 outline-none font-sans text-sm"
            style={{ color: 'var(--cream)' }}
            placeholder="Search commands..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={handleKey}
          />
        </div>

        {/* Gold accent line */}
        <div className="gold-divider" />

        {/* List */}
        <div className="max-h-[340px] overflow-y-auto py-1 scrollbar-thin">
          {filtered.map(([cmd, desc], i) => (
            <div
              key={cmd}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 mx-1"
              style={{
                background: i === index ? 'var(--s3)' : 'transparent',
                borderLeft: i === index ? '2px solid var(--gold)' : '2px solid transparent',
              }}
              onClick={() => pick(cmd)}
            >
              <span className="font-mono text-[12.5px] min-w-[190px]" style={{ color: i === index ? 'var(--gold)' : 'var(--text)' }}>{cmd}</span>
              <span className="text-xs text-muted truncate">{desc}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-muted text-sm">No commands found</div>
          )}
        </div>
      </div>
    </div>
  );
}

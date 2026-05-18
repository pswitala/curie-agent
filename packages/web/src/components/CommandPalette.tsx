import { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (cmd: string) => void;
}

const CMDS: [string, string][] = [
  ['/status', 'Show version, model, provider, tokens, CWD'],
  ['/help', 'List all available commands'],
  ['/model [name]', 'Switch model · opus / sonnet / haiku / gpt4o'],
  ['/mode <mode>', 'Set approval mode · plan|edit|auto|yolo'],
  ['/theme [name]', 'Change color theme'],
  ['/debug [on|off]', 'Toggle debug logging'],
  ['/effort [level]', 'Set reasoning effort · low|medium|high|max'],
  ['/context', 'Show context window usage grid'],
  ['/context compact', 'Compact the context window'],
  ['/context auto', 'Configure auto-compaction'],
  ['/memory status', 'View memory file sizes'],
  ['/memory add', 'Capture a memory'],
  ['/heartbeat now', 'Trigger heartbeat immediately'],
  ['/heartbeat enable', 'Enable heartbeat schedule'],
  ['/remind <msg at time>', 'Create a reminder'],
  ['/cron list', 'List all reminders'],
  ['/channels list', 'Show Telegram channels'],
  ['/mcp list', 'Show MCP servers'],
  ['/mcp add', 'Add an MCP server'],
  ['/tools [n]', 'View/set tool call limit per turn'],
  ['/websearch [n]', 'Set web search limit per turn'],
  ['/snapshots', 'List git snapshots'],
  ['/revert', 'Revert to a snapshot'],
  ['/stats', 'View usage stats'],
  ['/agent <prompt>', 'Spawn a subagent'],
  ['/task create', 'Create a scheduled task'],
  ['/provider <name>', 'Switch AI provider'],
  ['/init', 'Run interactive setup wizard'],
  ['/exit', 'Exit curie-agent'],
];

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
    <div className="fixed inset-0 bg-black/75 z-50 flex items-start justify-center pt-[120px]" onClick={onClose}>
      <div className="w-[560px] bg-s2 border border-b2 rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-b1">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" className="shrink-0">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-0 outline-none text-fg font-sans text-sm placeholder-muted2"
            placeholder="Search commands..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={handleKey}
          />
        </div>

        {/* List */}
        <div className="max-h-[340px] overflow-y-auto py-1 scrollbar-thin">
          {filtered.map(([cmd, desc], i) => (
            <div
              key={cmd}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors duration-100 ${
                i === index ? 'bg-s3' : 'hover:bg-s3'
              }`}
              onClick={() => pick(cmd)}
            >
              <span className="font-mono text-[12.5px] text-text min-w-[190px]">{cmd}</span>
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

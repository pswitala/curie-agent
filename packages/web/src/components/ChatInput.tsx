import { useState, useRef, useCallback, useEffect } from 'react';

interface Props {
  onSend: (text: string) => void;
  cmdInput?: string;
  onClearCmdInput?: () => void;
  onNewChat?: () => void;
}

const CHIPS = ['/status', '/context', '/memory', '/heartbeat', '/snapshots'];

export default function ChatInput({ onSend, cmdInput, onClearCmdInput, onNewChat }: Props) {
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

  const insertChip = useCallback((chip: string) => {
    setValue(chip);
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="px-5 py-3 bg-transparent">
      <div className="bg-s2 border border-b2 rounded-[10px] focus-within:border-b3 transition-colors duration-150">
        {/* Chips */}
        <div className="flex flex-wrap gap-1 px-3 pt-2">
          {onNewChat && (
            <button
              className="flex items-center gap-0.5 bg-transparent border border-b2 rounded px-1.5 py-0.5 text-xs text-muted hover:border-b3 hover:text-fg transition-colors duration-100 cursor-pointer select-none font-medium"
              onClick={onNewChat}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New
            </button>
          )}
          {CHIPS.map((chip) => (
            <button
              key={chip}
              className="bg-transparent border border-b2 rounded px-1.5 py-0.5 text-xs text-muted hover:border-b3 hover:text-text transition-colors duration-100 cursor-pointer select-none font-mono"
              onClick={() => insertChip(chip)}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="w-full bg-transparent border-0 outline-none text-fg font-sans text-[13.5px] px-3.5 py-2.5 resize-none leading-[1.5] placeholder-muted2"
          rows={1}
          placeholder="Message curie-agent..."
          value={value}
          onChange={(e) => { setValue(e.target.value); grow(); }}
          onKeyDown={handleKey}
        />

        {/* Footer */}
        <div className="flex items-center px-3 pb-2 pt-1">
          <span className="text-[11px] text-muted2 font-mono">Enter send &middot; Shift+Enter newline &middot; / commands</span>
          <div className="flex-1" />
          <button
            className="bg-fg border-0 rounded-[6px] w-7 h-7 flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity duration-150"
            onClick={() => {
              const text = value.trim();
              if (text) { onSend(text); setValue(''); }
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#010101" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

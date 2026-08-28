import { useCallback, useEffect, useMemo, useState } from 'react';
import { docDirOf, renderDocMarkdown } from '../lib/markdown.js';

export type DocLinkTarget =
  | { kind: 'path'; path: string }
  | { kind: 'wikilink'; target: string };

export type DocViewMode = 'rendered' | 'raw';

const VIEW_MODE_KEY = 'curie.docs.viewMode';

/** Rendered/raw preference, shared across the Docs and Wiki tabs. */
export function useDocViewMode(): [DocViewMode, (m: DocViewMode) => void] {
  const [mode, setMode] = useState<DocViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'raw' ? 'raw' : 'rendered';
    } catch {
      return 'rendered';
    }
  });
  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* private mode */ }
  }, [mode]);
  return [mode, setMode];
}

interface Props {
  content: string;
  /** Source-relative path of the document; anchors relative-link resolution. */
  docPath?: string;
  /** Known source-relative paths — unknown link targets render as broken. */
  knownPaths?: Set<string>;
  mode: DocViewMode;
  onNavigate?: (target: DocLinkTarget) => void;
  className?: string;
}

export default function MarkdownDoc({ content, docPath, knownPaths, mode, onNavigate, className }: Props) {
  const html = useMemo(
    () => renderDocMarkdown(content, { dir: docDirOf(docPath ?? ''), known: knownPaths }),
    [content, docPath, knownPaths],
  );

  // Internal links carry data-doc and no href (the sanitizer would strip one),
  // so navigation runs through delegation rather than the browser.
  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest('a[data-doc]');
    if (!el) return;
    e.preventDefault();
    const raw = el.getAttribute('data-doc') ?? '';
    const i = raw.indexOf(':');
    if (i < 0) return;
    const kind = raw.slice(0, i);
    const payload = raw.slice(i + 1);
    if (kind === 'path') onNavigate?.({ kind: 'path', path: payload });
    else if (kind === 'wikilink') onNavigate?.({ kind: 'wikilink', target: payload });
  }, [onNavigate]);

  if (mode === 'raw') {
    return (
      <pre
        className={`text-[11px] leading-relaxed whitespace-pre-wrap font-mono p-3 rounded-lg overflow-auto ${className ?? ''}`}
        style={{ background: 'var(--s2)', color: 'var(--fg)', border: '1px solid var(--b1)' }}
      >
        {content}
      </pre>
    );
  }

  return (
    <div
      className={`markdown-body ${className ?? ''}`}
      style={{ color: 'var(--fg)' }}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Shared Raw/Rendered toggle, styled like the Wiki toolbar buttons. */
export function DocViewModeToggle({ mode, onChange }: { mode: DocViewMode; onChange: (m: DocViewMode) => void }) {
  const next: DocViewMode = mode === 'rendered' ? 'raw' : 'rendered';
  return (
    <button
      onClick={() => { onChange(next); }}
      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer"
      style={{
        background: mode === 'raw' ? 'var(--s3)' : 'transparent',
        color: mode === 'raw' ? 'var(--gold)' : 'var(--muted)',
        border: mode === 'raw' ? '1px solid var(--b2)' : '1px solid transparent',
      }}
      title={mode === 'rendered' ? 'Show raw markdown' : 'Show rendered markdown'}
    >
      {mode === 'rendered' ? 'Raw' : 'Rendered'}
    </button>
  );
}

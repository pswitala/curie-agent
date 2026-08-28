import { useState, useEffect, useCallback, useMemo } from 'react';
import MarkdownDoc, { DocViewModeToggle, useDocViewMode, type DocLinkTarget } from './MarkdownDoc.js';
import {
  dirLabel,
  filterEntries,
  formatSize,
  groupByDir,
  resolveWikilink,
  sortEntries,
  type DocEntry,
  type DocListing,
  type DocSource,
} from './docs-model.js';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';

interface SearchHit {
  path: string;
  line: number;
  snippet: string;
}

interface Props {
  rpc: JsonRpcClient | null;
  className?: string;
}

const SOURCES: { key: DocSource; label: string }[] = [
  { key: 'artifacts', label: 'Artifacts' },
  { key: 'memory', label: 'Memory' },
];

/** Mobile falls back to one panel at a time; desktop shows the split. */
type MobilePanel = 'list' | 'page' | 'search';

export default function DocsView({ rpc, className }: Props) {
  const [listings, setListings] = useState<Record<DocSource, DocListing | null>>({ artifacts: null, memory: null });
  const [source, setSource] = useState<DocSource>('artifacts');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [truncatedDoc, setTruncatedDoc] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);

  const [viewMode, setViewMode] = useDocViewMode();
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('list');

  const fetchAll = useCallback(async () => {
    if (!rpc) return;
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.docsList() as { sources?: DocListing[] } | null;
      const next: Record<DocSource, DocListing | null> = { artifacts: null, memory: null };
      for (const l of res?.sources ?? []) next[l.source] = l;
      setListings(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const listing = listings[source];
  const entries = useMemo(() => listing?.entries ?? [], [listing]);
  const knownPaths = useMemo(() => new Set(entries.map(e => e.path)), [entries]);
  const visible = useMemo(
    () => groupByDir(sortEntries(filterEntries(entries, filter), source)),
    [entries, filter, source],
  );

  const loadDoc = useCallback(async (path: string) => {
    if (!rpc) return;
    setSelected(path);
    setPageLoading(true);
    setContent(null);
    setNotice(null);
    setMobilePanel('page');
    try {
      const res = await rpc.docsRead(source, path) as
        { content?: string; error?: string; truncated?: boolean } | null;
      setContent(res?.content ?? res?.error ?? 'Empty document');
      setTruncatedDoc(res?.truncated === true);
    } catch (e) {
      setContent(e instanceof Error ? e.message : 'Error loading document');
      setTruncatedDoc(false);
    } finally {
      setPageLoading(false);
    }
  }, [rpc, source]);

  const openDoc = useCallback((path: string) => {
    setHistory([]);
    void loadDoc(path);
  }, [loadDoc]);

  const followLink = useCallback((target: DocLinkTarget) => {
    const path = target.kind === 'path'
      ? (knownPaths.has(target.path) ? target.path : null)
      : resolveWikilink(entries, target.target);

    if (!path) {
      const label = target.kind === 'path' ? target.path : target.target;
      setNotice(`No document matches "${label}" in ${source}`);
      return;
    }
    setHistory(h => (selected ? [...h, selected] : h));
    void loadDoc(path);
  }, [entries, knownPaths, loadDoc, selected, source]);

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    void loadDoc(prev);
  }, [history, loadDoc]);

  const switchSource = useCallback((next: DocSource) => {
    setSource(next);
    setSelected(null);
    setContent(null);
    setHistory([]);
    setFilter('');
    setNotice(null);
    setSearchHits(null);
    setMobilePanel('list');
  }, []);

  const runSearch = useCallback(async () => {
    if (!rpc || !searchQuery.trim()) return;
    setSearching(true);
    setSearchHits(null);
    setMobilePanel('search');
    try {
      const res = await rpc.docsSearch(source, searchQuery) as { hits?: SearchHit[] } | null;
      setSearchHits(res?.hits ?? []);
    } catch {
      setSearchHits([]);
    } finally {
      setSearching(false);
    }
  }, [rpc, searchQuery, source]);

  const btn = (active: boolean) => ({
    background: active ? 'var(--s3)' : 'transparent',
    color: active ? 'var(--gold)' : 'var(--muted)',
    border: active ? '1px solid var(--b2)' : '1px solid transparent',
  });

  return (
    <div className={`flex flex-col h-full ${className ?? ''}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--b1)' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--gold)', flexShrink: 0 }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="text-[13px] font-semibold font-display" style={{ color: 'var(--cream)' }}>Docs</span>
        <span className="text-[11px] font-mono" style={{ color: 'var(--muted)' }}>
          {listing ? `${String(listing.count)} files` : '—'}
        </span>

        <div className="flex-1" />

        {SOURCES.map(s => (
          <button
            key={s.key}
            onClick={() => { switchSource(s.key); }}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer"
            style={btn(source === s.key)}
          >{s.label}</button>
        ))}
        <button
          onClick={() => { setMobilePanel('search'); }}
          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer md:hidden"
          style={btn(mobilePanel === 'search')}
        >Search</button>
        {selected && <DocViewModeToggle mode={viewMode} onChange={setViewMode} />}
        <button
          onClick={() => void fetchAll()}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150 cursor-pointer"
          style={{ color: 'var(--muted)', border: '1px solid transparent' }}
          title="Refresh"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Sidebar */}
        <div
          className={`${mobilePanel === 'list' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-64 shrink-0 min-h-0`}
          style={{ borderRight: '1px solid var(--b1)' }}
        >
          <div className="p-2 shrink-0 space-y-2" style={{ borderBottom: '1px solid var(--b1)' }}>
            <input
              type="text"
              value={filter}
              onChange={e => { setFilter(e.target.value); }}
              placeholder="Filter files…"
              className="w-full px-2.5 py-1.5 rounded-lg text-[11px] outline-none"
              style={{ background: 'var(--s2)', border: '1px solid var(--b2)', color: 'var(--fg)' }}
            />
            <div className="flex gap-1.5">
              <input
                type="text"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); }}
                onKeyDown={e => e.key === 'Enter' && void runSearch()}
                placeholder="Search contents…"
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[11px] outline-none"
                style={{ background: 'var(--s2)', border: '1px solid var(--b2)', color: 'var(--fg)' }}
              />
              <button
                onClick={() => void runSearch()}
                disabled={searching || !searchQuery.trim()}
                className="px-2 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-150"
                style={{
                  background: 'color-mix(in srgb, var(--gold) 15%, transparent)',
                  color: 'var(--gold)',
                  border: '1px solid color-mix(in srgb, var(--gold) 25%, transparent)',
                  opacity: searching || !searchQuery.trim() ? 0.5 : 1,
                }}
              >{searching ? '…' : 'Go'}</button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-2 py-2">
            {loading && <div className="text-[11px] px-1 py-4 text-center" style={{ color: 'var(--muted)' }}>Loading…</div>}
            {error && (
              <div className="text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)' }}>
                {error}
              </div>
            )}
            {!loading && !error && entries.length === 0 && (
              <div className="text-[11px] px-1 py-6 text-center" style={{ color: 'var(--muted)' }}>
                No markdown files in {listing?.rootLabel ?? source}
              </div>
            )}
            {!loading && visible.length === 0 && entries.length > 0 && (
              <div className="text-[11px] px-1 py-6 text-center" style={{ color: 'var(--muted)' }}>No files match "{filter}"</div>
            )}
            {visible.map(group => (
              <div key={group.dir} className="mb-3">
                <div className="text-[10px] font-mono uppercase tracking-widest mb-1 px-1 truncate" style={{ color: 'var(--muted)' }}>
                  {dirLabel(group.dir, source)}
                </div>
                <div className="space-y-0.5">
                  {group.entries.map(e => (
                    <FileButton key={e.path} entry={e} active={selected === e.path} onClick={() => { openDoc(e.path); }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reader / search results */}
        <div className={`${mobilePanel === 'list' ? 'hidden' : 'flex'} md:flex flex-1 min-w-0 flex-col`}>
          {mobilePanel === 'search' || searchHits !== null ? (
            <SearchResults
              hits={searchHits}
              searching={searching}
              query={searchQuery}
              onOpen={p => { setSearchHits(null); openDoc(p); }}
              onDismiss={() => { setSearchHits(null); setMobilePanel(selected ? 'page' : 'list'); }}
            />
          ) : (
            <>
              <div className="flex items-center gap-3 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid var(--b1)' }}>
                <button
                  onClick={() => { setMobilePanel('list'); }}
                  className="md:hidden text-[11px] cursor-pointer"
                  style={{ color: 'var(--muted)' }}
                >← Files</button>
                {history.length > 0 && (
                  <button
                    onClick={goBack}
                    className="text-[11px] cursor-pointer truncate"
                    style={{ color: 'var(--gold)' }}
                    title={`Back to ${history[history.length - 1]}`}
                  >← {history[history.length - 1]}</button>
                )}
                <span className="text-[11px] font-mono truncate" style={{ color: 'var(--muted)' }}>
                  {selected ?? ''}
                </span>
                {truncatedDoc && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0" style={{ background: 'color-mix(in srgb, var(--yellow) 15%, transparent)', color: 'var(--yellow)' }}>
                    truncated
                  </span>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3">
                {notice && (
                  <div className="text-[11px] mb-3 px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--yellow) 10%, transparent)', color: 'var(--yellow)' }}>
                    {notice}
                  </div>
                )}
                {pageLoading && <div className="flex items-center justify-center h-32 text-xs" style={{ color: 'var(--muted)' }}>Loading…</div>}
                {!pageLoading && content === null && (
                  <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--muted)' }}>
                    Select a document to read
                  </div>
                )}
                {!pageLoading && content !== null && (
                  <MarkdownDoc
                    content={content}
                    docPath={selected ?? undefined}
                    knownPaths={knownPaths}
                    mode={viewMode}
                    onNavigate={followLink}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FileButton({ entry, active, onClick }: { entry: DocEntry; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2 py-1.5 rounded-lg transition-all duration-150 cursor-pointer"
      style={{
        background: active ? 'var(--s3)' : 'transparent',
        border: active ? '1px solid var(--b2)' : '1px solid transparent',
        color: active ? 'var(--gold)' : 'var(--fg)',
      }}
      title={entry.path}
    >
      <div className="text-[11px] font-medium truncate">{entry.title || entry.name}</div>
      <div className="text-[9px] font-mono mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
        {entry.name} · {formatSize(entry.size)}
      </div>
    </button>
  );
}

function SearchResults({ hits, searching, query, onOpen, onDismiss }: {
  hits: SearchHit[] | null;
  searching: boolean;
  query: string;
  onOpen: (path: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid var(--b1)' }}>
        <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
          {searching ? 'Searching…' : `${String(hits?.length ?? 0)} matches for "${query}"`}
        </span>
        <div className="flex-1" />
        <button onClick={onDismiss} className="text-[11px] cursor-pointer" style={{ color: 'var(--gold)' }}>Close</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3 space-y-1">
        {!searching && hits?.length === 0 && (
          <div className="text-center py-8 text-xs" style={{ color: 'var(--muted)' }}>No results</div>
        )}
        {hits?.map((h, i) => (
          <button
            key={`${h.path}:${String(h.line)}:${String(i)}`}
            onClick={() => { onOpen(h.path); }}
            className="w-full text-left px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer active:scale-[0.99]"
            style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
          >
            <div className="text-[11px] font-mono truncate" style={{ color: 'var(--gold)' }}>{h.path}:{h.line}</div>
            <div className="text-[11px] mt-0.5 truncate font-mono" style={{ color: 'var(--fg)' }}>{h.snippet}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

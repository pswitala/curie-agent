import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from '../lib/api-context.js';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';
import WikiGraphView from './WikiGraphView.js';

interface PageRecord {
  slug: string;
  title: string;
  category: string;
}

interface SearchHit {
  slug: string;
  line: string;
  lineNumber: number;
}

interface LintReport {
  orphanPages: string[];
  brokenLinks: Array<{ from: string; to: string }>;
  missingFromIndex: string[];
  staleFrontmatter: string[];
}

interface WikiGraph {
  nodes: Array<{ slug: string; title: string; category: string }>;
  edges: Array<{ source: string; target: string }>;
}

interface Props {
  rpc: JsonRpcClient | null;
  className?: string;
}

type PanelView = 'browse' | 'page' | 'search' | 'lint' | 'graph';

export default function WikiView({ rpc, className }: Props) {
  const { ws } = useApi();
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<PanelView>('browse');
  const panelRef = useRef<PanelView>('browse');
  panelRef.current = panel;
  const [_selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [pageContent, setPageContent] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [lintReport, setLintReport] = useState<LintReport | null>(null);
  const [lintLoading, setLintLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<WikiGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  const fetchGraph = useCallback(async (silent = false) => {
    if (!rpc) return;
    if (!silent) setGraphLoading(true);
    try {
      const result = await rpc.wikiGraph() as WikiGraph | null;
      setGraphData(result ?? { nodes: [], edges: [] });
    } catch {
      setGraphData({ nodes: [], edges: [] });
    } finally {
      if (!silent) setGraphLoading(false);
    }
  }, [rpc]);

  const fetchPages = useCallback(async (silent = false) => {
    if (!rpc) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const result = await rpc.wikiListPages() as { pages?: PageRecord[] } | null;
      setPages(result?.pages ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wiki');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [rpc]);

  useEffect(() => { fetchPages(); }, [fetchPages]);

  useEffect(() => {
    if (!ws) return;
    return ws.on('wiki-op', () => {
      fetchPages(true);
      if (panelRef.current === 'graph') fetchGraph(true);
    });
  }, [ws, fetchPages, fetchGraph]);

  const openPage = useCallback(async (slug: string) => {
    if (!rpc) return;
    setSelectedSlug(slug);
    setPanel('page');
    setPageLoading(true);
    setPageContent(null);
    try {
      const result = await rpc.wikiPageGet(slug) as { content?: string; error?: string } | null;
      setPageContent(result?.content ?? result?.error ?? 'Empty page');
    } catch (e) {
      setPageContent(e instanceof Error ? e.message : 'Error loading page');
    } finally {
      setPageLoading(false);
    }
  }, [rpc]);

  const runSearch = useCallback(async () => {
    if (!rpc || !searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const result = await rpc.wikiSearch(searchQuery) as SearchHit[] | null;
      setSearchResults(result ?? []);
    } finally {
      setSearching(false);
    }
  }, [rpc, searchQuery]);

  const runLint = useCallback(async () => {
    if (!rpc) return;
    setPanel('lint');
    setLintLoading(true);
    setLintReport(null);
    try {
      const result = await rpc.wikiLint() as LintReport | null;
      setLintReport(result ?? { orphanPages: [], brokenLinks: [], missingFromIndex: [], staleFrontmatter: [] });
    } finally {
      setLintLoading(false);
    }
  }, [rpc]);

  // Group pages by category
  const byCategory = pages.reduce<Record<string, PageRecord[]>>((acc, p) => {
    const cat = p.category || 'Other';
    (acc[cat] ??= []).push(p);
    return acc;
  }, {});

  const lintIssueCount = lintReport
    ? lintReport.orphanPages.length + lintReport.brokenLinks.length + lintReport.missingFromIndex.length + lintReport.staleFrontmatter.length
    : null;

  return (
    <div className={`flex flex-col h-full ${className ?? ''}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--b1)' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--gold)', flexShrink: 0 }}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span className="text-[13px] font-semibold font-display" style={{ color: 'var(--cream)' }}>Wiki</span>
        <span className="text-[11px] font-mono" style={{ color: 'var(--muted)' }}>{pages.length} pages</span>

        <div className="flex-1" />

        {/* Toolbar */}
        <button
          onClick={() => setPanel('browse')}
          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer"
          style={{
            background: panel === 'browse' ? 'var(--s3)' : 'transparent',
            color: panel === 'browse' ? 'var(--gold)' : 'var(--muted)',
            border: panel === 'browse' ? '1px solid var(--b2)' : '1px solid transparent',
          }}
        >Browse</button>
        <button
          onClick={() => setPanel('search')}
          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer"
          style={{
            background: panel === 'search' ? 'var(--s3)' : 'transparent',
            color: panel === 'search' ? 'var(--gold)' : 'var(--muted)',
            border: panel === 'search' ? '1px solid var(--b2)' : '1px solid transparent',
          }}
        >Search</button>
        <button
          onClick={runLint}
          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer flex items-center gap-1"
          style={{
            background: panel === 'lint' ? 'var(--s3)' : 'transparent',
            color: panel === 'lint' ? 'var(--gold)' : 'var(--muted)',
            border: panel === 'lint' ? '1px solid var(--b2)' : '1px solid transparent',
          }}
        >
          Lint
          {lintIssueCount !== null && lintIssueCount > 0 && (
            <span className="rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold" style={{ background: 'var(--red)', color: '#fff' }}>{lintIssueCount}</span>
          )}
        </button>
        <button
          onClick={() => { setPanel('graph'); if (!graphData && !graphLoading) fetchGraph(); }}
          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer"
          style={{
            background: panel === 'graph' ? 'var(--s3)' : 'transparent',
            color: panel === 'graph' ? 'var(--gold)' : 'var(--muted)',
            border: panel === 'graph' ? '1px solid var(--b2)' : '1px solid transparent',
          }}
        >Graph</button>
        <button
          onClick={() => fetchPages()}
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

      {/* Body — graph panel is full-bleed, others scroll */}
      {panel === 'graph' && (
        <div className="flex-1 min-h-0">
          <WikiGraphView
            graphData={graphData}
            loading={graphLoading}
            onNodeClick={openPage}
          />
        </div>
      )}
      <div className={`flex-1 min-h-0 overflow-y-auto px-4 py-3 scrollbar-thin${panel === 'graph' ? ' hidden' : ''}`}>

        {/* Browse panel */}
        {panel === 'browse' && (
          <>
            {loading && (
              <div className="flex items-center justify-center h-32 text-xs" style={{ color: 'var(--muted)' }}>
                Loading…
              </div>
            )}
            {error && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--red) 10%, transparent)', color: 'var(--red)', border: '1px solid color-mix(in srgb, var(--red) 20%, transparent)' }}>
                {error}
              </div>
            )}
            {!loading && !error && pages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ color: 'var(--muted)', opacity: 0.4 }}>
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                <div>
                  <div className="text-[12px] font-semibold" style={{ color: 'var(--fg)' }}>Wiki is empty</div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>Ask the agent to ingest a document to get started</div>
                </div>
                <div className="text-[10px] font-mono px-3 py-1.5 rounded-lg" style={{ background: 'var(--s2)', color: 'var(--muted)', border: '1px solid var(--b1)' }}>
                  ingest plans/spec.md into the wiki
                </div>
              </div>
            )}
            {!loading && Object.entries(byCategory).map(([cat, catPages]) => (
              <div key={cat} className="mb-4">
                <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5 px-1" style={{ color: 'var(--muted)' }}>{cat}</div>
                <div className="space-y-1">
                  {catPages.map(p => (
                    <button
                      key={p.slug}
                      onClick={() => openPage(p.slug)}
                      className="w-full text-left px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer active:scale-[0.99]"
                      style={{
                        background: 'var(--s2)',
                        border: '1px solid var(--b1)',
                        color: 'var(--fg)',
                      }}
                    >
                      <div className="text-[12px] font-medium truncate">{p.title || p.slug.split('/').pop()}</div>
                      <div className="text-[10px] font-mono mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{p.slug}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {/* Page reader panel */}
        {panel === 'page' && (
          <div>
            <button
              onClick={() => setPanel('browse')}
              className="flex items-center gap-1.5 text-[11px] mb-3 cursor-pointer transition-colors duration-100"
              style={{ color: 'var(--muted)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back to index
            </button>
            {pageLoading && (
              <div className="flex items-center justify-center h-32 text-xs" style={{ color: 'var(--muted)' }}>Loading…</div>
            )}
            {!pageLoading && pageContent !== null && (
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono p-3 rounded-lg overflow-auto" style={{ background: 'var(--s2)', color: 'var(--fg)', border: '1px solid var(--b1)' }}>
                {pageContent}
              </pre>
            )}
          </div>
        )}

        {/* Search panel */}
        {panel === 'search' && (
          <div>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runSearch()}
                placeholder="Search wiki pages…"
                className="flex-1 px-3 py-2 rounded-lg text-[12px] outline-none"
                style={{
                  background: 'var(--s2)',
                  border: '1px solid var(--b2)',
                  color: 'var(--fg)',
                }}
                autoFocus
              />
              <button
                onClick={runSearch}
                disabled={searching || !searchQuery.trim()}
                className="px-3 py-2 rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-150 active:scale-[0.97]"
                style={{
                  background: 'color-mix(in srgb, var(--gold) 15%, transparent)',
                  color: 'var(--gold)',
                  border: '1px solid color-mix(in srgb, var(--gold) 25%, transparent)',
                  opacity: searching || !searchQuery.trim() ? 0.5 : 1,
                }}
              >
                {searching ? '…' : 'Search'}
              </button>
            </div>

            {searchResults.length === 0 && !searching && searchQuery && (
              <div className="text-center py-8 text-xs" style={{ color: 'var(--muted)' }}>No results for "{searchQuery}"</div>
            )}

            {searchResults.length > 0 && (
              <div className="space-y-1">
                {searchResults.map((hit, i) => (
                  <button
                    key={i}
                    onClick={() => openPage(hit.slug)}
                    className="w-full text-left px-3 py-2 rounded-lg transition-all duration-150 cursor-pointer active:scale-[0.99]"
                    style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
                  >
                    <div className="text-[11px] font-mono" style={{ color: 'var(--gold)' }}>{hit.slug}:{hit.lineNumber}</div>
                    <div className="text-[11px] mt-0.5 truncate font-mono" style={{ color: 'var(--fg)' }}>{hit.line.trim()}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lint panel */}
        {panel === 'lint' && (
          <div>
            {lintLoading && (
              <div className="flex items-center justify-center h-32 text-xs" style={{ color: 'var(--muted)' }}>Running lint…</div>
            )}
            {!lintLoading && lintReport && (
              <div className="space-y-4">
                {lintIssueCount === 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)', color: 'var(--green)', border: '1px solid color-mix(in srgb, var(--green) 20%, transparent)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                    Wiki looks clean — no issues found
                  </div>
                )}
                <LintSection title="Orphan pages" items={lintReport.orphanPages} color="var(--yellow)" note="Written but not linked from any other page" />
                <LintSection title="Broken links" items={lintReport.brokenLinks.map(b => `${b.from} → [[${b.to}]]`)} color="var(--red)" note="[[wikilinks]] that reference missing pages" />
                <LintSection title="Missing from index" items={lintReport.missingFromIndex} color="var(--yellow)" note="Pages not listed in index.md" />
                <LintSection title="Stale frontmatter" items={lintReport.staleFrontmatter} color="var(--muted)" note="updated: field older than 30 days" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LintSection({ title, items, color, note }: { title: string; items: string[]; color: string; note: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] font-semibold" style={{ color }}>{title}</span>
        <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold font-mono" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>{items.length}</span>
      </div>
      <div className="text-[10px] mb-2" style={{ color: 'var(--muted)' }}>{note}</div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="px-3 py-1.5 rounded-lg text-[11px] font-mono truncate" style={{ background: 'var(--s2)', color: 'var(--fg)', border: '1px solid var(--b1)' }}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

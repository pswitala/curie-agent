export type DocSource = 'artifacts' | 'memory';

export interface DocEntry {
  path: string;
  dir: string;
  name: string;
  title: string;
  size: number;
  mtime: number;
}

export interface DocListing {
  source: DocSource;
  rootLabel: string;
  count: number;
  truncated: boolean;
  entries: DocEntry[];
}

export interface DocGroup {
  dir: string;
  entries: DocEntry[];
}

/** Case-insensitive match on the display title and the path. */
export function filterEntries(entries: DocEntry[], filter: string): DocEntry[] {
  const q = filter.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(e => e.path.toLowerCase().includes(q) || e.title.toLowerCase().includes(q));
}

/**
 * Sort for display. Memory files are dated (`2026-05-26.md`, `DREAM-…`), so
 * newest-first by name reads better there; artifacts have no naming convention
 * worth trusting, so they go by mtime.
 */
export function sortEntries(entries: DocEntry[], source: DocSource): DocEntry[] {
  const out = [...entries];
  if (source === 'memory') out.sort((a, b) => b.name.localeCompare(a.name));
  else out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/** Group by directory, root entries first, then directories alphabetically. */
export function groupByDir(entries: DocEntry[]): DocGroup[] {
  const map = new Map<string, DocEntry[]>();
  for (const e of entries) {
    const list = map.get(e.dir);
    if (list) list.push(e);
    else map.set(e.dir, [e]);
  }
  return [...map.entries()]
    .sort((a, b) => {
      if (a[0] === '') return -1;
      if (b[0] === '') return 1;
      return a[0].localeCompare(b[0]);
    })
    .map(([dir, list]) => ({ dir, entries: list }));
}

/**
 * Resolve a `[[wikilink]]` against the listing: exact path, then `<target>.md`,
 * then a unique basename match. Returns null when ambiguous or absent so the
 * caller can report it rather than opening the wrong file.
 */
export function resolveWikilink(entries: DocEntry[], target: string): string | null {
  const t = target.trim().replace(/^\//, '');
  if (!t) return null;

  const exact = entries.find(e => e.path === t);
  if (exact) return exact.path;

  const withExt = entries.find(e => e.path === `${t}.md`);
  if (withExt) return withExt.path;

  const stem = t.toLowerCase().replace(/\.(md|markdown)$/i, '');
  const byName = entries.filter(e => e.name.toLowerCase().replace(/\.(md|markdown)$/i, '') === stem);
  return byName.length === 1 ? byName[0].path : null;
}

/** `12.3 KB` / `1.2 MB` — sizes shown next to file names. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Display label for a directory group. */
export function dirLabel(dir: string, source: DocSource): string {
  if (dir === '') return source === 'memory' ? 'index' : 'root';
  return dir;
}

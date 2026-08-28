/**
 * Read-only access to the agent's markdown corpora: deep-research artifacts and
 * memory logs. Backs the `docs.list` / `docs.read` / `docs.search` RPCs.
 *
 * Why this does NOT use `isPathAllowed()` from @curie-agent/core: that guard
 * returns true for *anything* under ~/.curie-agent, including `sessions/`,
 * `snapshots/` and `daemon.token`. The `memory` source is rooted at
 * ~/.curie-agent (so the out-of-tree MEMORY.md index is reachable), so
 * containment alone would expose the whole directory. The `included()`
 * predicate below is the real gate, and it is applied twice — see resolveDocPath.
 *
 * Every function takes an optional trailing `baseDir` so tests can point at a
 * temp fixture instead of the real home directory.
 */
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { curieAgentDir } from '@curie-agent/core';

export type DocSource = 'artifacts' | 'memory';

export interface DocEntry {
  /** Source-relative, forward-slashed. e.g. `MEMORY.md`, `memory/job-search/ey.md` */
  path: string;
  /** Source-relative directory, `''` at the root. Used for grouping in the UI. */
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

export interface DocHit {
  path: string;
  line: number;
  snippet: string;
}

export interface DocRead {
  source: DocSource;
  path: string;
  content: string;
  size: number;
  mtime: number;
  truncated: boolean;
}

const EXT_OK = /\.(md|markdown)$/i;
const MAX_DOC_BYTES = 1_000_000;
const MAX_ENTRIES = 2000;
const MAX_HITS = 200;
const MAX_HITS_PER_FILE = 40;
const SNIPPET_CHARS = 160;
const TITLE_PROBE_BYTES = 4096;

export function isDocSource(v: unknown): v is DocSource {
  return v === 'artifacts' || v === 'memory';
}

function sourceRoot(source: DocSource, baseDir: string): string {
  return source === 'artifacts' ? join(baseDir, 'artifacts') : baseDir;
}

/**
 * The include predicate. Security-load-bearing for `memory`, whose root is the
 * whole of ~/.curie-agent — this is what keeps `sessions/`, `wiki/`, `plans/`
 * and `daemon.token` out of reach.
 */
function included(source: DocSource, rel: string): boolean {
  if (!EXT_OK.test(rel)) return false;
  if (source === 'artifacts') return true;
  return rel === 'MEMORY.md' || rel.startsWith('memory/');
}

/** Separator-aware containment. path-guard's equivalent is module-private. */
function within(child: string, parent: string): boolean {
  const a = process.platform === 'win32' ? child.toLowerCase() : child;
  const b = process.platform === 'win32' ? parent.toLowerCase() : parent;
  return a === b || a.startsWith(b + sep);
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).replace(/\\/g, '/');
}

/**
 * Resolve a source-relative document path to a validated absolute path.
 * Returns `{ error }` rather than throwing for every rejection.
 */
export function resolveDocPath(
  source: DocSource,
  relPath: string,
  baseDir: string = curieAgentDir(),
): { path: string } | { error: string } {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    return { error: 'Invalid document path' };
  }

  const rel = relPath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) {
    return { error: 'Absolute paths are not allowed' };
  }
  if (rel.split('/').includes('..')) {
    return { error: 'Path traversal is not allowed' };
  }
  if (!included(source, rel)) {
    return { error: `Not a readable document: ${rel}` };
  }

  const root = sourceRoot(source, baseDir);
  let realRoot: string;
  let realAbs: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { error: `Source unavailable: ${source}` };
  }
  try {
    realAbs = realpathSync(resolve(root, rel));
  } catch {
    return { error: `Document not found: ${rel}` };
  }

  if (!within(realAbs, realRoot)) {
    return { error: 'Path escapes the document root' };
  }

  // Re-apply the predicate to the *real* path. A symlink can land elsewhere
  // inside the root — `memory/evil.md -> ../sessions/secret.jsonl.md` passes
  // containment but must still be refused. This is the load-bearing line.
  if (!included(source, toRel(realRoot, realAbs))) {
    return { error: `Not a readable document: ${rel}` };
  }

  // Defence in depth, mirroring tools/src/read.ts: never serve the settings
  // file, which holds provider API keys.
  const settingsPath = join(homedir(), '.curie-settings.json');
  if (realAbs.toLowerCase() === settingsPath.toLowerCase()) {
    return { error: 'Blocked: settings file contains API keys' };
  }

  try {
    if (!statSync(realAbs).isFile()) return { error: 'Not a file' };
  } catch {
    return { error: `Document not found: ${rel}` };
  }

  return { path: realAbs };
}

/** Read at most `bytes` from the head of a file, for cheap title extraction. */
function headOf(abs: string, bytes = TITLE_PROBE_BYTES): string {
  let fd: number | undefined;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf-8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/** Frontmatter `title:` -> first `# H1` -> basename. Matches wiki/src/graph.ts. */
function titleFrom(head: string, fallback: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
  if (fm?.[1]) {
    const t = /^title:\s*(.+)$/m.exec(fm[1]);
    if (t?.[1]) return t[1].trim().replace(/^["']|["']$/g, '');
  }
  const h1 = /^#\s+(.+)$/m.exec(head);
  if (h1?.[1]) return h1[1].trim();
  return fallback;
}

/**
 * Directories to walk. Explicit seeds rather than "walk the root and filter",
 * so the walk can never descend into sessions/ or snapshots/ at all.
 */
function walkSeeds(source: DocSource, baseDir: string): string[] {
  return source === 'artifacts'
    ? [join(baseDir, 'artifacts')]
    : [join(baseDir, 'memory')];
}

/** Single files included outside any walked directory. */
function extraSeeds(source: DocSource, baseDir: string): string[] {
  return source === 'memory' ? [join(baseDir, 'MEMORY.md')] : [];
}

function collectMarkdown(dir: string, out: string[], limit: number): void {
  if (out.length >= limit) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.name.startsWith('.')) continue;
    // Never follow symlinks — a symlinked directory could point anywhere.
    if (e.isSymbolicLink()) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) collectMarkdown(abs, out, limit);
    else if (e.isFile() && EXT_OK.test(e.name)) out.push(abs);
  }
}

export function listDocs(
  source: DocSource,
  baseDir: string = curieAgentDir(),
): DocListing {
  const root = sourceRoot(source, baseDir);
  const rootLabel = source === 'artifacts' ? '~/.curie-agent/artifacts' : '~/.curie-agent';

  const files: string[] = [];
  for (const seed of walkSeeds(source, baseDir)) {
    collectMarkdown(seed, files, MAX_ENTRIES + 1);
  }
  for (const f of extraSeeds(source, baseDir)) {
    if (files.length > MAX_ENTRIES) break;
    try {
      if (statSync(f).isFile()) files.push(f);
    } catch { /* absent */ }
  }

  const truncated = files.length > MAX_ENTRIES;
  const entries: DocEntry[] = [];

  for (const abs of files.slice(0, MAX_ENTRIES)) {
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const rel = toRel(root, abs);
    if (!included(source, rel)) continue;
    const slash = rel.lastIndexOf('/');
    const name = slash < 0 ? rel : rel.slice(slash + 1);
    entries.push({
      path: rel,
      dir: slash < 0 ? '' : rel.slice(0, slash),
      name,
      title: titleFrom(headOf(abs), name.replace(EXT_OK, '')),
      size: st.size,
      mtime: st.mtimeMs,
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { source, rootLabel, count: entries.length, truncated, entries };
}

export function readDoc(
  source: DocSource,
  relPath: string,
  baseDir: string = curieAgentDir(),
): DocRead | { error: string } {
  const resolved = resolveDocPath(source, relPath, baseDir);
  if ('error' in resolved) return resolved;

  let st;
  try {
    st = statSync(resolved.path);
  } catch {
    return { error: `Document not found: ${relPath}` };
  }

  let content: string;
  try {
    content = readFileSync(resolved.path, 'utf-8');
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to read document' };
  }

  // Truncate rather than refuse — a 5 MB MEMORY.md should still be viewable.
  const truncated = Buffer.byteLength(content, 'utf-8') > MAX_DOC_BYTES;
  if (truncated) content = content.slice(0, MAX_DOC_BYTES);

  const root = realpathSync(sourceRoot(source, baseDir));
  return {
    source,
    path: toRel(root, resolved.path),
    content,
    size: st.size,
    mtime: st.mtimeMs,
    truncated,
  };
}

export function searchDocs(
  source: DocSource,
  query: string,
  limit: number = MAX_HITS,
  baseDir: string = curieAgentDir(),
): { hits: DocHit[]; truncated: boolean } {
  const q = query.trim().toLowerCase();
  if (!q) return { hits: [], truncated: false };

  const cap = Math.max(1, Math.min(limit, MAX_HITS));
  const root = sourceRoot(source, baseDir);
  const hits: DocHit[] = [];
  let truncated = false;

  const files: string[] = [];
  for (const seed of walkSeeds(source, baseDir)) collectMarkdown(seed, files, MAX_ENTRIES);
  for (const f of extraSeeds(source, baseDir)) {
    try {
      if (statSync(f).isFile()) files.push(f);
    } catch { /* absent */ }
  }

  for (const abs of files) {
    if (hits.length >= cap) { truncated = true; break; }
    const rel = toRel(root, abs);
    if (!included(source, rel)) continue;

    let text: string;
    try {
      if (statSync(abs).size > MAX_DOC_BYTES) continue;
      text = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }

    let perFile = 0;
    const lines = text.split('\n');
    for (const [i, line] of lines.entries()) {
      // Substring match, never `new RegExp(query)` — a user-supplied pattern
      // would be a ReDoS vector on a 239-file corpus.
      if (!line.toLowerCase().includes(q)) continue;
      if (hits.length >= cap) { truncated = true; break; }
      if (perFile >= MAX_HITS_PER_FILE) { truncated = true; break; }
      hits.push({ path: rel, line: i + 1, snippet: line.trim().slice(0, SNIPPET_CHARS) });
      perFile++;
    }
  }

  return { hits, truncated };
}

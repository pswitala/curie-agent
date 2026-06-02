import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { WikiManager } from './wiki-manager.js';
import { parseIndex, formatIndex, upsertIndexEntry } from './wiki-index.js';
import { appendLog, readLog } from './log.js';
import { buildGraph } from './graph.js';
import { resolveWikiPath, ensureWikiStructure } from './paths.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'wiki-test-'));
}

// ---------------------------------------------------------------------------
// resolveWikiPath
// ---------------------------------------------------------------------------

describe('resolveWikiPath', () => {
  it('returns ~/.curie-agent/wiki by default', () => {
    const p = resolveWikiPath({});
    expect(p).toContain('.curie-agent');
    expect(p).toContain('wiki');
  });

  it('returns configured path when non-empty', () => {
    const p = resolveWikiPath({ wiki: { path: '/custom/wiki' } });
    expect(p).toBe('/custom/wiki');
  });

  it('falls back to default when path is empty string', () => {
    const p = resolveWikiPath({ wiki: { path: '' } });
    expect(p).toContain('.curie-agent');
  });
});

// ---------------------------------------------------------------------------
// ensureWikiStructure
// ---------------------------------------------------------------------------

describe('ensureWikiStructure', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('creates all required directories', () => {
    root = makeTempDir();
    ensureWikiStructure(root);
    for (const sub of ['raw', 'raw/assets', 'pages', 'pages/entities', 'pages/concepts', 'pages/summaries']) {
      expect(existsSync(join(root, sub))).toBe(true);
    }
  });

  it('seeds index.md and log.md when absent', () => {
    root = makeTempDir();
    ensureWikiStructure(root);
    expect(existsSync(join(root, 'index.md'))).toBe(true);
    expect(existsSync(join(root, 'log.md'))).toBe(true);
  });

  it('does not overwrite existing index.md', () => {
    root = makeTempDir();
    const indexPath = join(root, 'index.md');
    ensureWikiStructure(root);
    writeFileSync(indexPath, 'EXISTING', 'utf-8');
    ensureWikiStructure(root); // second call should not overwrite
    expect(readFileSync(indexPath, 'utf-8')).toBe('EXISTING');
  });
});

// ---------------------------------------------------------------------------
// parseIndex / formatIndex
// ---------------------------------------------------------------------------

describe('parseIndex / formatIndex', () => {
  it('round-trips entries', () => {
    const source = [
      '# Wiki Index',
      '',
      '## Concepts',
      '- [[concepts/foo]] — Foo summary',
      '',
      '## Entities',
      '- [[entities/bar|Bar Name]] — Bar summary',
      '',
    ].join('\n');
    const entries = parseIndex(source);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ slug: 'concepts/foo', category: 'Concepts', summary: 'Foo summary' });
    expect(entries[1]).toMatchObject({ slug: 'entities/bar', title: 'Bar Name', category: 'Entities' });
    const formatted = formatIndex(entries);
    expect(formatted).toContain('[[concepts/foo]]');
    expect(formatted).toContain('[[entities/bar|Bar Name]]');
  });

  it('handles empty index', () => {
    expect(parseIndex('# Wiki Index\n')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// upsertIndexEntry
// ---------------------------------------------------------------------------

describe('upsertIndexEntry', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('adds a new entry', () => {
    root = makeTempDir();
    ensureWikiStructure(root);
    upsertIndexEntry(root, { slug: 'concepts/test', title: 'Test', summary: 'A test', category: 'Concepts' });
    const entries = parseIndex(readFileSync(join(root, 'index.md'), 'utf-8'));
    expect(entries.some(e => e.slug === 'concepts/test')).toBe(true);
  });

  it('is idempotent by slug', () => {
    root = makeTempDir();
    ensureWikiStructure(root);
    upsertIndexEntry(root, { slug: 'concepts/test', title: 'Old', summary: 'Old', category: 'Concepts' });
    upsertIndexEntry(root, { slug: 'concepts/test', title: 'New', summary: 'New', category: 'Concepts' });
    const entries = parseIndex(readFileSync(join(root, 'index.md'), 'utf-8'));
    const found = entries.filter(e => e.slug === 'concepts/test');
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe('New');
  });
});

// ---------------------------------------------------------------------------
// appendLog / readLog
// ---------------------------------------------------------------------------

describe('log', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('creates log.md with parseable header', () => {
    root = makeTempDir();
    appendLog(root, 'INGEST', 'My Source', 'summaries/foo; touched concepts/bar');
    const content = readLog(root);
    expect(content).toContain('## [');
    expect(content).toContain('ingest | My Source');
    expect(content).toContain('INGEST: summaries/foo');
  });

  it('appends multiple entries in order', () => {
    root = makeTempDir();
    appendLog(root, 'INGEST', 'Source A');
    appendLog(root, 'QUERY', 'What is X?');
    const content = readLog(root);
    expect(content).toContain('ingest | Source A');
    expect(content).toContain('query | What is X?');
    const headers = content.match(/^## \[/gm);
    expect(headers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildGraph
// ---------------------------------------------------------------------------

describe('buildGraph', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('extracts wikilinks as directed edges', () => {
    root = makeTempDir();
    ensureWikiStructure(root);
    writeFileSync(
      join(root, 'pages', 'concepts', 'foo.md'),
      '# Foo\n\nSee [[entities/bar]] and [[concepts/baz|Baz]].\n',
      'utf-8',
    );
    writeFileSync(
      join(root, 'pages', 'entities', 'bar.md'),
      '# Bar\n\nRelated to [[concepts/foo]].\n',
      'utf-8',
    );
    const { nodes, edges } = buildGraph(root);
    expect(nodes.map(n => n.slug)).toContain('concepts/foo');
    expect(nodes.map(n => n.slug)).toContain('entities/bar');
    expect(edges).toContainEqual({ source: 'concepts/foo', target: 'entities/bar' });
    expect(edges).toContainEqual({ source: 'concepts/foo', target: 'concepts/baz' });
    expect(edges).toContainEqual({ source: 'entities/bar', target: 'concepts/foo' });
  });

  it('returns empty graph for empty pages dir', () => {
    root = makeTempDir();
    ensureWikiStructure(root);
    const { nodes, edges } = buildGraph(root);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// WikiManager
// ---------------------------------------------------------------------------

describe('WikiManager', () => {
  let root: string;
  let wm: WikiManager;

  beforeEach(() => {
    root = makeTempDir();
    wm = new WikiManager({ wiki: { path: root } });
    wm.ensureStructure();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writePage and readPage round-trip', () => {
    const content = `---\ntitle: Test Concept\ntags: [test]\nupdated: 2026-05-30\n---\n\n# Test Concept\n\nSome content.\n`;
    wm.writePage('concepts/test-concept', content);
    expect(wm.readPage('concepts/test-concept')).toBe(content);
  });

  it('readPage returns null for missing slug', () => {
    expect(wm.readPage('concepts/nonexistent')).toBeNull();
  });

  it('writePage auto-updates index', () => {
    wm.writePage('concepts/auto-index', '---\ntitle: Auto Index\n---\n# Auto Index\n');
    const entries = wm.readIndex();
    expect(entries.some(e => e.slug === 'concepts/auto-index')).toBe(true);
  });

  it('listPages returns all pages', () => {
    wm.writePage('entities/org-a', '# Org A\n');
    wm.writePage('concepts/topic-b', '# Topic B\n');
    const pages = wm.listPages();
    expect(pages.map(p => p.slug)).toContain('entities/org-a');
    expect(pages.map(p => p.slug)).toContain('concepts/topic-b');
  });

  it('search finds matching lines', () => {
    wm.writePage('concepts/searchable', '# Searchable\n\nThis text contains the magic phrase.\n');
    const hits = wm.search('magic phrase');
    expect(hits.some(h => h.snippet.includes('magic phrase'))).toBe(true);
  });

  it('search returns empty array when nothing matches', () => {
    wm.writePage('concepts/no-match', '# No Match\n\nUnrelated content.\n');
    expect(wm.search('xyzzy_not_found')).toHaveLength(0);
  });

  it('lintReport detects orphan pages', () => {
    wm.writePage('concepts/orphan', '# Orphan\n\nNo one links here.\n');
    const report = wm.lintReport();
    expect(report.orphanPages).toContain('concepts/orphan');
  });

  it('lintReport detects broken links', () => {
    wm.writePage('concepts/broken-linker', '# Linker\n\nPoints to [[concepts/nonexistent]].\n');
    const report = wm.lintReport();
    expect(report.brokenLinks.some(l => l.includes('nonexistent'))).toBe(true);
  });

  it('lintReport detects pages missing from index', () => {
    // Write a page file directly (bypassing WikiManager.writePage which auto-upserts)
    mkdirSync(join(root, 'pages', 'concepts'), { recursive: true });
    writeFileSync(join(root, 'pages', 'concepts', 'hidden.md'), '# Hidden\n', 'utf-8');
    const report = wm.lintReport();
    expect(report.missingFromIndex).toContain('concepts/hidden');
  });

  it('upsertIndexEntry is reflected in readIndex', () => {
    wm.upsertIndexEntry({ slug: 'concepts/direct', title: 'Direct', summary: 'Added directly', category: 'Concepts' });
    expect(wm.readIndex().some(e => e.slug === 'concepts/direct')).toBe(true);
  });

  it('appendLog and readLog round-trip', () => {
    wm.appendLog('INGEST', 'Test Source', 'summaries/test-source');
    expect(wm.readLog()).toContain('ingest | Test Source');
  });
});

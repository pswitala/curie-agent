import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDocSource, listDocs, readDoc, resolveDocPath, searchDocs } from './docs-store.js';

let base: string;
/** Set when the OS permits symlink creation (Windows needs privilege). */
let symlinksOk = false;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'curie-docs-'));

  mkdirSync(join(base, 'artifacts'), { recursive: true });
  mkdirSync(join(base, 'memory', 'job-search'), { recursive: true });
  mkdirSync(join(base, 'sessions'), { recursive: true });
  mkdirSync(join(base, 'wiki', 'pages'), { recursive: true });
  mkdirSync(join(base, 'plans'), { recursive: true });

  // Included
  writeFileSync(join(base, 'MEMORY.md'), '# Memory Index\n\nSee `memory/rules.md`.\n');
  writeFileSync(join(base, 'memory', '2026-05-26.md'), '# Daily Log\n\nneedle appears here\n');
  writeFileSync(join(base, 'memory', 'job-search', 'ey.md'), '---\ntitle: EY Notes\n---\n\nbody\n');
  writeFileSync(join(base, 'artifacts', 'research-a.md'), '# Research A\n\nneedle too\n');
  writeFileSync(join(base, 'artifacts', 'no-heading.md'), 'just text\n');

  // Must never be reachable through either source
  writeFileSync(join(base, 'sessions', 'secret.md'), 'SESSION SECRET\n');
  writeFileSync(join(base, 'wiki', 'pages', 'page.md'), 'WIKI PAGE\n');
  writeFileSync(join(base, 'plans', 'plan.md'), 'PLAN\n');
  writeFileSync(join(base, 'daemon.token'), 'deadbeef\n');
  writeFileSync(join(base, 'memory', 'notes.txt'), 'not markdown\n');
  writeFileSync(join(base, 'memory', '.hidden.md'), 'dotfile\n');

  try {
    symlinkSync(join(base, 'sessions', 'secret.md'), join(base, 'memory', 'evil.md'), 'file');
    symlinkSync(join(base, 'sessions'), join(base, 'memory', 'linkdir'), 'dir');
    symlinksOk = true;
  } catch {
    symlinksOk = false; // unprivileged Windows — the realpath tests are skipped
  }
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('isDocSource', () => {
  it('accepts only the two known sources', () => {
    expect(isDocSource('artifacts')).toBe(true);
    expect(isDocSource('memory')).toBe(true);
    expect(isDocSource('wiki')).toBe(false);
    expect(isDocSource('')).toBe(false);
    expect(isDocSource(undefined)).toBe(false);
    expect(isDocSource({ toString: () => 'memory' })).toBe(false);
  });
});

describe('listDocs', () => {
  it('lists artifacts and derives titles from H1 or basename', () => {
    const l = listDocs('artifacts', base);
    expect(l.entries.map(e => e.path).sort()).toEqual(['no-heading.md', 'research-a.md']);
    expect(l.entries.find(e => e.path === 'research-a.md')?.title).toBe('Research A');
    expect(l.entries.find(e => e.path === 'no-heading.md')?.title).toBe('no-heading');
    expect(l.truncated).toBe(false);
  });

  it('includes MEMORY.md alongside memory/** and records dir for grouping', () => {
    const paths = listDocs('memory', base).entries.map(e => e.path);
    expect(paths).toContain('MEMORY.md');
    expect(paths).toContain('memory/2026-05-26.md');
    expect(paths).toContain('memory/job-search/ey.md');

    const entries = listDocs('memory', base).entries;
    expect(entries.find(e => e.path === 'MEMORY.md')?.dir).toBe('');
    expect(entries.find(e => e.path === 'memory/job-search/ey.md')?.dir).toBe('memory/job-search');
  });

  it('prefers frontmatter title over H1', () => {
    const e = listDocs('memory', base).entries.find(x => x.path === 'memory/job-search/ey.md');
    expect(e?.title).toBe('EY Notes');
  });

  it('excludes sibling directories of memory/, non-markdown, and dotfiles', () => {
    const paths = listDocs('memory', base).entries.map(e => e.path);
    expect(paths.some(p => p.startsWith('sessions/'))).toBe(false);
    expect(paths.some(p => p.startsWith('wiki/'))).toBe(false);
    expect(paths.some(p => p.startsWith('plans/'))).toBe(false);
    expect(paths.some(p => p.endsWith('.txt'))).toBe(false);
    expect(paths.some(p => p.includes('.hidden'))).toBe(false);
    expect(paths).not.toContain('daemon.token');
  });

  it.runIf(symlinksOk)('does not walk symlinked directories', () => {
    const paths = listDocs('memory', base).entries.map(e => e.path);
    expect(paths.some(p => p.includes('linkdir'))).toBe(false);
  });

  it('returns an empty listing rather than throwing when the source is absent', () => {
    const missing = mkdtempSync(join(tmpdir(), 'curie-empty-'));
    try {
      expect(listDocs('artifacts', missing).entries).toEqual([]);
      expect(listDocs('memory', missing).entries).toEqual([]);
    } finally {
      rmSync(missing, { recursive: true, force: true });
    }
  });
});

describe('resolveDocPath rejections', () => {
  it('rejects traversal, absolute and drive-letter paths', () => {
    expect(resolveDocPath('memory', '../.curie-settings.json', base)).toHaveProperty('error');
    expect(resolveDocPath('memory', 'memory/../../sessions/secret.md', base)).toHaveProperty('error');
    expect(resolveDocPath('memory', '/etc/passwd', base)).toHaveProperty('error');
    expect(resolveDocPath('memory', 'C:\\Windows\\win.ini', base)).toHaveProperty('error');
    expect(resolveDocPath('memory', '', base)).toHaveProperty('error');
  });

  it('rejects in-root paths outside the include predicate', () => {
    expect(resolveDocPath('memory', 'sessions/secret.md', base)).toHaveProperty('error');
    expect(resolveDocPath('memory', 'wiki/pages/page.md', base)).toHaveProperty('error');
    expect(resolveDocPath('memory', 'plans/plan.md', base)).toHaveProperty('error');
    expect(resolveDocPath('memory', 'daemon.token', base)).toHaveProperty('error');
    expect(resolveDocPath('memory', 'memory/notes.txt', base)).toHaveProperty('error');
  });

  it('accepts the two legitimate memory shapes', () => {
    expect(resolveDocPath('memory', 'MEMORY.md', base)).toHaveProperty('path');
    expect(resolveDocPath('memory', 'memory/2026-05-26.md', base)).toHaveProperty('path');
    expect(resolveDocPath('memory', './memory/2026-05-26.md', base)).toHaveProperty('path');
  });

  it.runIf(symlinksOk)('refuses a symlink that redirects inside the root', () => {
    // memory/evil.md -> sessions/secret.md passes containment (both under base)
    // but the realpath re-check catches it. This test is why that line exists.
    const r = resolveDocPath('memory', 'memory/evil.md', base);
    expect(r).toHaveProperty('error');
  });

  it('rejects a directory passed as a path', () => {
    expect(resolveDocPath('artifacts', 'nested.md', base)).toHaveProperty('error');
    mkdirSync(join(base, 'artifacts', 'adir.md'), { recursive: true });
    expect(resolveDocPath('artifacts', 'adir.md', base)).toEqual({ error: 'Not a file' });
    rmSync(join(base, 'artifacts', 'adir.md'), { recursive: true, force: true });
  });

  it('reports missing documents without throwing', () => {
    expect(resolveDocPath('artifacts', 'nope.md', base)).toHaveProperty('error');
  });
});

describe('readDoc', () => {
  it('reads an included document', () => {
    const r = readDoc('memory', 'MEMORY.md', base);
    expect(r).not.toHaveProperty('error');
    expect((r as { content: string }).content).toContain('# Memory Index');
    expect((r as { truncated: boolean }).truncated).toBe(false);
  });

  it('truncates an oversized document instead of failing', () => {
    const big = join(base, 'artifacts', 'big.md');
    writeFileSync(big, 'x'.repeat(1_200_000));
    try {
      const r = readDoc('artifacts', 'big.md', base) as { content: string; truncated: boolean };
      expect(r.truncated).toBe(true);
      expect(r.content.length).toBe(1_000_000);
    } finally {
      rmSync(big, { force: true });
    }
  });

  it('refuses blocked paths', () => {
    expect(readDoc('memory', 'sessions/secret.md', base)).toHaveProperty('error');
    expect(readDoc('memory', '../.curie-settings.json', base)).toHaveProperty('error');
  });
});

describe('searchDocs', () => {
  it('finds matches with path and 1-based line number', () => {
    const { hits } = searchDocs('memory', 'needle', undefined, base);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toBe('memory/2026-05-26.md');
    expect(hits[0]!.line).toBe(3);
    expect(hits[0]!.snippet).toBe('needle appears here');
  });

  it('is case-insensitive and scoped to the requested source', () => {
    expect(searchDocs('memory', 'NEEDLE', undefined, base).hits.length).toBeGreaterThan(0);
    const artifactHits = searchDocs('artifacts', 'needle', undefined, base).hits;
    expect(artifactHits.every(h => !h.path.startsWith('memory/'))).toBe(true);
  });

  it('never matches excluded files', () => {
    const { hits } = searchDocs('memory', 'SESSION SECRET', undefined, base);
    expect(hits).toEqual([]);
  });

  it('returns nothing for an empty query', () => {
    expect(searchDocs('memory', '   ', undefined, base).hits).toEqual([]);
  });

  it('caps results and flags truncation', () => {
    const r = searchDocs('memory', 'e', 1, base);
    expect(r.hits.length).toBe(1);
    expect(r.truncated).toBe(true);
  });

  it('treats regex metacharacters literally', () => {
    // Would throw or hang if the query were compiled as a RegExp.
    expect(() => searchDocs('memory', '(((', undefined, base)).not.toThrow();
    expect(searchDocs('memory', '(((', undefined, base).hits).toEqual([]);
  });
});

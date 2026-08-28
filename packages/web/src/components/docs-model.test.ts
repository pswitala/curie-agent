import { describe, it, expect } from 'vitest';
import {
  dirLabel,
  filterEntries,
  formatSize,
  groupByDir,
  resolveWikilink,
  sortEntries,
  type DocEntry,
} from './docs-model.js';

function entry(path: string, over: Partial<DocEntry> = {}): DocEntry {
  const slash = path.lastIndexOf('/');
  const name = slash < 0 ? path : path.slice(slash + 1);
  return {
    path,
    dir: slash < 0 ? '' : path.slice(0, slash),
    name,
    title: name.replace(/\.md$/, ''),
    size: 100,
    mtime: 0,
    ...over,
  };
}

describe('filterEntries', () => {
  const entries = [entry('MEMORY.md'), entry('memory/job-search/ey.md'), entry('memory/2026-05-26.md')];

  it('returns everything for an empty filter', () => {
    expect(filterEntries(entries, '   ')).toHaveLength(3);
  });

  it('matches path and title case-insensitively', () => {
    expect(filterEntries(entries, 'JOB').map(e => e.path)).toEqual(['memory/job-search/ey.md']);
    expect(filterEntries(entries, '2026')).toHaveLength(1);
  });

  it('matches the title even when the path does not', () => {
    const custom = [entry('memory/a.md', { title: 'Quarterly Review' })];
    expect(filterEntries(custom, 'quarterly')).toHaveLength(1);
  });
});

describe('sortEntries', () => {
  it('sorts memory newest-first by name', () => {
    const entries = [entry('memory/2026-01-01.md'), entry('memory/2026-08-27.md'), entry('memory/2026-05-26.md')];
    expect(sortEntries(entries, 'memory').map(e => e.name)).toEqual([
      '2026-08-27.md', '2026-05-26.md', '2026-01-01.md',
    ]);
  });

  it('sorts artifacts newest-first by mtime', () => {
    const entries = [entry('a.md', { mtime: 1 }), entry('b.md', { mtime: 3 }), entry('c.md', { mtime: 2 })];
    expect(sortEntries(entries, 'artifacts').map(e => e.name)).toEqual(['b.md', 'c.md', 'a.md']);
  });

  it('does not mutate its input', () => {
    const entries = [entry('a.md', { mtime: 1 }), entry('b.md', { mtime: 3 })];
    sortEntries(entries, 'artifacts');
    expect(entries.map(e => e.name)).toEqual(['a.md', 'b.md']);
  });
});

describe('groupByDir', () => {
  it('puts root entries first, then directories alphabetically', () => {
    const entries = [
      entry('memory/job-search/ey.md'),
      entry('MEMORY.md'),
      entry('memory/a.md'),
      entry('memory/archive/old.md'),
    ];
    expect(groupByDir(entries).map(g => g.dir)).toEqual(['', 'memory', 'memory/archive', 'memory/job-search']);
  });

  it('keeps entry order within a group', () => {
    const groups = groupByDir([entry('memory/b.md'), entry('memory/a.md')]);
    expect(groups[0].entries.map(e => e.name)).toEqual(['b.md', 'a.md']);
  });

  it('returns an empty array for no entries', () => {
    expect(groupByDir([])).toEqual([]);
  });
});

describe('resolveWikilink', () => {
  const entries = [entry('MEMORY.md'), entry('memory/rules.md'), entry('memory/job-search/ey.md')];

  it('prefers an exact path match', () => {
    expect(resolveWikilink(entries, 'memory/rules.md')).toBe('memory/rules.md');
  });

  it('appends .md when the target omits it', () => {
    expect(resolveWikilink(entries, 'memory/rules')).toBe('memory/rules.md');
  });

  it('falls back to a unique basename match', () => {
    expect(resolveWikilink(entries, 'ey')).toBe('memory/job-search/ey.md');
    expect(resolveWikilink(entries, 'rules.md')).toBe('memory/rules.md');
  });

  it('returns null when the basename is ambiguous', () => {
    const dupes = [entry('memory/a/dup.md'), entry('memory/b/dup.md')];
    expect(resolveWikilink(dupes, 'dup')).toBeNull();
  });

  it('returns null for unknown or empty targets', () => {
    expect(resolveWikilink(entries, 'nope')).toBeNull();
    expect(resolveWikilink(entries, '  ')).toBeNull();
  });
});

describe('formatSize', () => {
  it('scales units', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(1024 * 1024 * 3)).toBe('3.0 MB');
  });
});

describe('dirLabel', () => {
  it('labels the root per source', () => {
    expect(dirLabel('', 'memory')).toBe('index');
    expect(dirLabel('', 'artifacts')).toBe('root');
    expect(dirLabel('memory/archive', 'memory')).toBe('memory/archive');
  });
});

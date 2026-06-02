import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface IndexEntry {
  slug: string;
  title: string;
  summary: string;
  category: string;
  date?: string;
}

/** Parse index.md into a flat list of entries. */
export function parseIndex(content: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  // Lines like: - [[category/slug]] — summary  or  - [[slug|Title]] — summary
  const lineRe = /^- \[\[([^\]|]+)(?:\|([^\]]*))?\]\](?: — (.*))?$/;
  let currentCategory = '';

  for (const line of content.split('\n')) {
    const headingMatch = /^## (.+)$/.exec(line);
    if (headingMatch) {
      currentCategory = headingMatch[1]!.trim();
      continue;
    }
    const m = lineRe.exec(line.trim());
    if (m) {
      const slug = m[1]!.trim();
      const title = m[2]?.trim() || slug.split('/').pop() || slug;
      const rawRest = m[3]?.trim() || '';
      const summary = rawRest.replace(/\s*\(\d+ sources?\)\s*$/, '').trim();
      entries.push({ slug, title, summary, category: currentCategory });
    }
  }
  return entries;
}

export function formatIndex(entries: IndexEntry[]): string {
  const byCategory = new Map<string, IndexEntry[]>();
  for (const e of entries) {
    const cat = e.category || 'Other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(e);
  }

  const lines: string[] = [
    '# Wiki Index',
    '',
    '<!-- Updated automatically by curie-agent wiki engine. Parse: grep "^## " index.md -->',
  ];

  for (const [cat, catEntries] of byCategory) {
    lines.push('', `## ${cat}`);
    for (const e of catEntries) {
      const title = e.title && e.title !== e.slug.split('/').pop() ? `|${e.title}` : '';
      const summary = e.summary ? ` — ${e.summary}` : '';
      const datePart = e.date ? ` (${e.date})` : '';
      lines.push(`- [[${e.slug}${title}]]${summary}${datePart}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function readIndex(root: string): IndexEntry[] {
  const indexPath = join(root, 'index.md');
  if (!existsSync(indexPath)) return [];
  return parseIndex(readFileSync(indexPath, 'utf-8'));
}

/** Idempotent by slug — updates in place if existing, appends if new. */
export function upsertIndexEntry(root: string, entry: IndexEntry): void {
  const entries = readIndex(root);
  const idx = entries.findIndex(e => e.slug === entry.slug);
  if (idx >= 0) {
    entries[idx] = { ...entries[idx]!, ...entry };
  } else {
    entries.push(entry);
  }
  writeFileSync(join(root, 'index.md'), formatIndex(entries), 'utf-8');
}

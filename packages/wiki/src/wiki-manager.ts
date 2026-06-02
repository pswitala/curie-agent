import { join, dirname } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import { resolveWikiPath, ensureWikiStructure } from './paths.js';
import { readIndex, upsertIndexEntry, type IndexEntry } from './wiki-index.js';
import { appendLog, readLog, type LogPrefix } from './log.js';
import { buildGraph, type WikiGraph } from './graph.js';

export interface PageRecord {
  slug: string;
  category: string;
  title: string;
}

export interface SearchHit {
  slug: string;
  line: number;
  snippet: string;
}

export interface LintReport {
  orphanPages: string[];
  brokenLinks: string[];
  missingFromIndex: string[];
  staleFrontmatter: string[];
}

const CATEGORY_MAP: Record<string, string> = {
  entities: 'Entities',
  concepts: 'Concepts',
  summaries: 'Summaries',
};

function categoryFromSlug(slug: string): string {
  const parts = slug.split('/');
  const prefix = parts.length > 1 ? parts[0]! : '';
  return CATEGORY_MAP[prefix] ?? 'Other';
}

function extractFrontmatterTitle(content: string): string | undefined {
  return /^---\s*\n(?:[\s\S]*?\n)?title:\s*(.+?)\s*\n/m.exec(content)?.[1]?.trim();
}

function extractH1(content: string): string | undefined {
  return /^# (.+)$/m.exec(content)?.[1]?.trim();
}

export class WikiManager {
  readonly root: string;

  constructor(settings?: { wiki?: { path?: string } }) {
    this.root = resolveWikiPath(settings);
  }

  ensureStructure(): void {
    ensureWikiStructure(this.root);
  }

  listRawSources(): string[] {
    const rawDir = join(this.root, 'raw');
    if (!existsSync(rawDir)) return [];
    return this.listFiles(rawDir)
      .map(f => f.slice(rawDir.length + 1).replace(/\\/g, '/'));
  }

  listPages(): PageRecord[] {
    const pagesDir = join(this.root, 'pages');
    if (!existsSync(pagesDir)) return [];
    return this.listFiles(pagesDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const rel = f.slice(pagesDir.length + 1).replace(/\\/g, '/');
        const slug = rel.replace(/\.md$/, '');
        const content = readFileSync(f, 'utf-8');
        const title = extractFrontmatterTitle(content) ?? extractH1(content) ?? (slug.split('/').pop() ?? slug);
        return { slug, category: categoryFromSlug(slug), title };
      });
  }

  readPage(slug: string): string | null {
    const filePath = join(this.root, 'pages', `${slug}.md`);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  }

  writePage(slug: string, content: string): void {
    const filePath = join(this.root, 'pages', `${slug}.md`);
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content, 'utf-8');

    const title = extractFrontmatterTitle(content) ?? extractH1(content) ?? (slug.split('/').pop() ?? slug);
    upsertIndexEntry(this.root, {
      slug,
      title,
      summary: '',
      category: categoryFromSlug(slug),
    });
    appendLog(this.root, 'EDIT', title);
  }

  readIndex(): IndexEntry[] {
    return readIndex(this.root);
  }

  upsertIndexEntry(entry: IndexEntry): void {
    upsertIndexEntry(this.root, entry);
  }

  appendLog(prefix: LogPrefix, title: string, detail?: string): void {
    appendLog(this.root, prefix, title, detail);
  }

  readLog(): string {
    return readLog(this.root);
  }

  search(query: string): SearchHit[] {
    const hits: SearchHit[] = [];
    const queryLower = query.toLowerCase();

    const searchInFile = (filePath: string, slug: string) => {
      try {
        const lines = readFileSync(filePath, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          if (line.toLowerCase().includes(queryLower)) {
            hits.push({ slug, line: i + 1, snippet: line.trim().slice(0, 120) });
          }
        });
      } catch { /* skip unreadable */ }
    };

    const pagesDir = join(this.root, 'pages');
    if (existsSync(pagesDir)) {
      for (const f of this.listFiles(pagesDir).filter(f => f.endsWith('.md'))) {
        const slug = f.slice(pagesDir.length + 1).replace(/\\/g, '/').replace(/\.md$/, '');
        searchInFile(f, slug);
      }
    }

    const indexPath = join(this.root, 'index.md');
    if (existsSync(indexPath)) searchInFile(indexPath, 'index');

    return hits;
  }

  graph(): WikiGraph {
    return buildGraph(this.root);
  }

  lintReport(): LintReport {
    const pages = this.listPages();
    const slugSet = new Set(pages.map(p => p.slug));
    const indexSlugs = new Set(this.readIndex().map(e => e.slug));

    const inboundCount = new Map<string, number>();
    for (const s of slugSet) inboundCount.set(s, 0);

    const brokenLinks: string[] = [];
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const staleFrontmatter: string[] = [];

    for (const page of pages) {
      const content = this.readPage(page.slug);
      if (!content) continue;

      const linkRe = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(content)) !== null) {
        const target = m[1]!.trim();
        if (slugSet.has(target)) {
          inboundCount.set(target, (inboundCount.get(target) ?? 0) + 1);
        } else {
          brokenLinks.push(`${page.slug} → [[${target}]]`);
        }
      }

      const updatedMatch = /^---\s*\n(?:[\s\S]*?\n)?updated:\s*(\S+)/m.exec(content);
      if (updatedMatch) {
        const updated = new Date(updatedMatch[1]!).getTime();
        if (!isNaN(updated) && updated < Date.now() - thirtyDaysMs) {
          staleFrontmatter.push(page.slug);
        }
      }
    }

    return {
      orphanPages: pages.filter(p => (inboundCount.get(p.slug) ?? 0) === 0).map(p => p.slug),
      brokenLinks: [...new Set(brokenLinks)],
      missingFromIndex: pages.filter(p => !indexSlugs.has(p.slug)).map(p => p.slug),
      staleFrontmatter,
    };
  }

  private listFiles(dir: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) result.push(...this.listFiles(full));
      else if (entry.isFile()) result.push(full);
    }
    return result;
  }
}

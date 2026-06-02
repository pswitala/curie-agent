import { join } from 'node:path';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

export interface GraphNode {
  slug: string;
  title: string;
  category: string;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface WikiGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      result.push(full);
    }
  }
  return result;
}

function extractWikilinks(content: string): string[] {
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    links.push(m[1]!.trim());
  }
  return links;
}

function slugFromAbsPath(pagesDir: string, filePath: string): string {
  const rel = filePath.startsWith(pagesDir)
    ? filePath.slice(pagesDir.length + 1)
    : filePath;
  return rel.replace(/\.md$/, '').replace(/\\/g, '/');
}

function categoryFromSlug(slug: string): string {
  const parts = slug.split('/');
  return parts.length > 1 ? parts[0]! : 'other';
}

function titleFromContent(content: string, slug: string): string {
  const fmMatch = /^---\s*\n(?:[\s\S]*?\n)?title:\s*(.+?)\s*\n/m.exec(content);
  if (fmMatch) return fmMatch[1]!.trim();
  const h1Match = /^# (.+)$/m.exec(content);
  if (h1Match) return h1Match[1]!.trim();
  return slug.split('/').pop() ?? slug;
}

export function buildGraph(root: string): WikiGraph {
  const pagesDir = join(root, 'pages');
  const files = listMarkdownFiles(pagesDir);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf-8');
    const slug = slugFromAbsPath(pagesDir, filePath);
    const category = categoryFromSlug(slug);
    const title = titleFromContent(content, slug);

    nodes.push({ slug, title, category });

    for (const target of extractWikilinks(content)) {
      edges.push({ source: slug, target });
    }
  }

  return { nodes, edges };
}

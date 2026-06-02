import { join, dirname, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveWikiPath, ensureWikiStructure, type WikiSettings } from './paths.js';

/** Resolve the bundled core/templates directory. Works from wiki's compiled dist output. */
function findTemplatesDir(): string | null {
  const myDir = dirname(fileURLToPath(import.meta.url));
  // wiki/dist/src → wiki → packages → app → packages/core/templates
  for (const offset of [
    '../../core/templates',   // from wiki/src (ts paths)
    '../../../core/templates', // from wiki/dist/src
    '../../../../packages/core/templates',
  ]) {
    const candidate = resolve(myDir, offset);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const DEFAULT_WIKI_MD = `# WIKI.md — Knowledge Base Schema

This is the schema and procedure file for your curie-agent wiki.
The agent reads it when performing wiki operations (Ingest, Query, Lint).

## Directory Layout

\`\`\`
wiki/
├── WIKI.md             # this schema
├── index.md            # content catalog (category-organized)
├── log.md              # append-only chronological record
├── raw/                # immutable sources (agent reads, never edits)
│   └── assets/         #   downloaded images / attachments
└── pages/              # LLM-generated markdown pages
    ├── entities/       #   one page per entity (person, org, product…)
    ├── concepts/       #   one page per concept/topic
    └── summaries/      #   one summary page per ingested source
\`\`\`

## Page Conventions

Every page uses Obsidian-compatible YAML frontmatter:

\`\`\`markdown
---
title: Page Title
tags: [tag1, tag2]
sources: [summaries/yyyy-mm-dd-slug]
updated: YYYY-MM-DD
---
\`\`\`

Use \`[[wikilinks]]\` to cross-reference: \`[[concepts/topic]]\` or \`[[entities/name|Display Name]]\`.

## index.md Format

\`\`\`markdown
## Concepts
- [[concepts/topic]] — One-line summary. (N sources)

## Entities
- [[entities/name]] — One-line summary.

## Summaries
- [[summaries/yyyy-mm-dd-slug]] — Source title.
\`\`\`

## log.md Format

Append-only, parseable: \`grep "^## \\[" log.md | tail -5\`

\`\`\`
## [2026-05-30] ingest | Source Title
INGEST: summaries/2026-05-30-slug; touched concepts/foo, entities/bar

## [2026-05-30] query | "user question"
QUERY: read concepts/foo; filed concepts/new-page
\`\`\`

---

## INGEST Workflow

1. Read the source (WebFetch for URLs, Read for files).
2. Identify key entities, concepts, and claims.
3. \`Wiki(op=search)\` to find existing related pages.
4. Write summary: \`Wiki(op=page_put, slug=summaries/YYYY-MM-DD-slug, content=…)\`.
5. For each of 5–15 related entity/concept pages:
   - \`Wiki(op=page_get)\` → update with new info, add cross-refs → \`Wiki(op=page_put)\`.
   - Create new pages as needed.
6. \`Wiki(op=index_upsert)\` for each touched page with a one-line summary.
7. \`Wiki(op=log_append, prefix=INGEST, title=<source title>, line=<pages touched>)\`.

## QUERY Workflow

1. \`Wiki(op=index_get)\` to identify relevant categories.
2. \`Wiki(op=search, query=<key terms>)\` to find candidate pages.
3. \`Wiki(op=page_get)\` for each relevant page.
4. Synthesize an answer with citations: \`[[slug]]\` or \`(see [[slug]])\`.
5. If the answer reveals a non-trivial insight not yet in the wiki:
   - Create a new page with \`Wiki(op=page_put)\`.
   - \`Wiki(op=log_append, prefix=QUERY, title=<question>, line=<pages filed>)\`.

## LINT Workflow

1. \`Wiki(op=graph)\` for the backlink graph; note orphan pages.
2. Note broken \`[[links]]\` — fix or remove.
3. Review pages with stale \`updated\` frontmatter — offer to refresh.
4. Check \`index.md\` for missing pages — \`Wiki(op=index_upsert)\` as needed.
5. Check for semantic contradictions between pages (read and compare).
6. \`Wiki(op=log_append, prefix=LINT, title=health check, line=<summary>)\`.
`;

/** Scaffold the wiki at the configured path and copy WIKI.md from bundled templates. */
export function initWiki(settings?: WikiSettings): string {
  const root = resolveWikiPath(settings);
  ensureWikiStructure(root);

  const wikiMdDest = join(root, 'WIKI.md');
  if (!existsSync(wikiMdDest)) {
    const templatesDir = findTemplatesDir();
    let written = false;
    if (templatesDir) {
      const src = join(templatesDir, 'WIKI.md');
      if (existsSync(src)) {
        writeFileSync(wikiMdDest, readFileSync(src, 'utf-8'), 'utf-8');
        written = true;
      }
    }
    if (!written) {
      writeFileSync(wikiMdDest, DEFAULT_WIKI_MD, 'utf-8');
    }
  }

  return root;
}

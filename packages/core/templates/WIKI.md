# WIKI.md — Knowledge Base Schema

This file describes the structure and workflows for your curie-agent knowledge wiki.
The agent reads it when performing wiki operations. Edit this file to customize conventions.

---

## Directory Layout

```
wiki/
├── WIKI.md             # this schema
├── index.md            # content catalog (category-organized)
├── log.md              # append-only chronological record
├── raw/                # immutable sources (agent reads, never edits)
│   └── assets/         #   downloaded images / attachments
└── pages/              # LLM-generated markdown pages
    ├── entities/       #   one page per entity (person, org, product, tool…)
    ├── concepts/       #   one page per concept, topic, or pattern
    └── summaries/      #   one summary page per ingested source
```

---

## Page Conventions

Every page begins with Obsidian-compatible YAML frontmatter:

```yaml
---
title: Page Title
tags: [tag1, tag2]
sources: [summaries/yyyy-mm-dd-source-slug]
updated: YYYY-MM-DD
---
```

Use `[[wikilinks]]` to cross-reference other pages:
- `[[concepts/topic]]` — basic link
- `[[entities/name|Display Name]]` — with display text

One page per entity or concept. One summary page per ingested source.

---

## index.md Format

Category-organized catalog. The agent updates this on every ingest.

```markdown
## Concepts
- [[concepts/compounding-knowledge]] — Wiki-as-artifact; cross-references precomputed. (3 sources)

## Entities
- [[entities/anthropic]] — AI lab; maker of Claude. (5 sources)

## Summaries
- [[summaries/2026-05-30-llm-wiki-gist]] — Karpathy's compounding-wiki pattern. (1 source)
```

Parse categories: `grep "^## " index.md`

---

## log.md Format

Append-only chronological record with machine-parseable prefixes.

```
## [2026-05-30] ingest | Source Title
INGEST: summaries/2026-05-30-slug; touched concepts/foo, entities/bar

## [2026-05-30] query | "how does the wiki differ from RAG?"
QUERY: read concepts/compounding-knowledge; filed concepts/rag-vs-wiki

## [2026-05-30] lint | health check
LINT: 2 orphans (entities/x, concepts/y); 1 broken link fixed
```

Parse recent entries: `grep "^## \[" log.md | tail -5`

---

## Wiki Tool (op reference)

| op | Required params | Action |
|----|----------------|--------|
| `init` | — | scaffold wiki structure + copy WIKI.md |
| `list_sources` | — | list files in `raw/` |
| `list_pages` | — | list all pages with slug/title/category |
| `page_get` | `slug` | read a page |
| `page_put` | `slug`, `content` | write a page (auto-updates index + log) |
| `index_get` | — | read index.md as structured entries |
| `index_upsert` | `slug`, `title`, `summary`, `category` | update one index entry |
| `log_append` | `prefix`, `title`, `line?` | append a log entry |
| `search` | `query` | grep over pages + index.md |
| `graph` | — | extract `[[wikilinks]]` → nodes + edges |
| `lint_report` | — | deterministic checks (orphans, broken links, missing-from-index, stale) |

---

## INGEST Workflow

When the user adds a new source:

1. **Read** the source — `WebFetch` for URLs, `Read` for local files (PDF, image, text).
2. **Identify** key entities, concepts, claims, and relationships.
3. **Search** for existing related pages: `Wiki(op=search, query=<key terms>)`.
4. **Write summary** page:
   `Wiki(op=page_put, slug=summaries/YYYY-MM-DD-<slug>, content=<markdown with frontmatter>)`
5. **Update related pages** (5–15 pages):
   - `Wiki(op=page_get, slug=<slug>)` → update content → `Wiki(op=page_put, …)`
   - Create new entity/concept pages as needed.
6. **Update index** for each touched page:
   `Wiki(op=index_upsert, slug=<slug>, title=…, summary=…, category=…)`
7. **Append log**:
   `Wiki(op=log_append, prefix=INGEST, title=<source title>, line=<pages touched>)`
8. Report a summary to the user.

---

## QUERY Workflow

When the user asks a question:

1. **Read catalog**: `Wiki(op=index_get)` — identify relevant categories.
2. **Search**: `Wiki(op=search, query=<key terms>)`.
3. **Read pages**: `Wiki(op=page_get, slug=<slug>)` for each relevant result.
4. **Synthesize** an answer with citations: `[[slug]]` or `(see [[slug]])`.
5. **File novel insights**: if the synthesis reveals a non-trivial connection or new concept:
   - `Wiki(op=page_put, slug=concepts/<slug>, content=…)`
   - `Wiki(op=log_append, prefix=QUERY, title=<question>, line=<pages filed>)`
6. Report the cited answer.

---

## LINT Workflow

When health-checking the wiki:

1. **Graph**: `Wiki(op=graph)` — identify orphan pages and review link density.
2. **Lint report**: `Wiki(op=lint_report)` — get deterministic issues (orphans, broken links, missing-from-index, stale frontmatter).
3. **Semantic checks** (agent-driven): read relevant pages and check for contradictions, stale claims.
4. **Fix** broken links and missing index entries; flag unresolvable issues.
5. **Log**: `Wiki(op=log_append, prefix=LINT, title=health check, line=<summary>)`.
6. Suggest new sources to investigate based on data gaps.

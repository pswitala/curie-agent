---
name: wiki
description: >
  Use this skill when the user wants to build, maintain, or query a personal knowledge wiki.
  Trigger for requests like: "ingest this article into the wiki", "add this to the wiki",
  "what does the wiki say about X", "search the wiki for Y", "query the wiki",
  "lint the wiki", "health check the wiki", "show me the wiki graph",
  "summarize this paper and add it to the wiki", "file this in the wiki",
  "update the wiki with this", "cross-reference this with the wiki",
  "what have I read about X", "compile everything I know about Y",
  "build a wiki page for Z", "what's in the wiki on topic W".
  This skill wraps the Ingest, Query, and Lint workflows from WIKI.md.
  Do NOT trigger for general note-taking, to-do lists, or session memory.
---

# Wiki Skill

A skill for operating curie-agent's compounding knowledge wiki.
The wiki is a persistent, self-maintaining markdown knowledge base.

---

## On Activation

1. Read `~/.curie-agent/wiki/WIKI.md` (or the wiki path from settings) for the full
   schema, page conventions, and workflow procedures.
2. Check `~/.curie-agent/wiki/index.md` to understand what's already in the wiki.
3. Determine which workflow applies: **Ingest**, **Query**, or **Lint**.

---

## Ingest

Trigger: user provides a source (file, URL, text) and wants it added to the wiki.

Follow the **INGEST Workflow** in WIKI.md exactly:
- Read source → identify entities/concepts → write summary page → update related pages →
  update index entries → append INGEST log.

Slug convention: `summaries/YYYY-MM-DD-kebab-title`.

---

## Query

Trigger: user asks a question against accumulated wiki knowledge.

Follow the **QUERY Workflow** in WIKI.md:
- Read index → search → read relevant pages → synthesize with `[[citations]]` →
  file novel discoveries back as pages → append QUERY log.

---

## Lint

Trigger: user asks to check wiki health, find contradictions, or clean up.

Follow the **LINT Workflow** in WIKI.md:
- `Wiki(op=lint_report)` for deterministic issues → fix broken links / missing-from-index →
  semantic check for contradictions → append LINT log.

---

## Tools to Use

- `Wiki` — the primary tool (all wiki operations)
- `Read` — read local source files
- `WebFetch` — fetch URL sources
- `Grep`, `Glob` — supplemental file exploration
- `Write` — only if writing outside the wiki root (avoid; prefer `Wiki(op=page_put)`)

---
name: deep-research
description: >
  Use this skill for any task that requires thorough, multi-source research going beyond a single
  web search. Triggers include: "research X for me", "I need a deep dive on", "write a report
  about", "compare X and Y in depth", "fact-check this", "help me understand [complex topic]",
  "I'm writing a paper/article/presentation on", "what does the evidence say about", "give me a
  comprehensive overview of", "I want to know everything about". Also trigger for investigative
  tasks, literature reviews, market research, competitor analysis, background checks on companies
  or topics, policy research, scientific topic explanations, historical investigations, and anything
  where the user clearly wants more than a quick answer. If the user seems to be preparing for an
  important decision, interview, debate, or creative project requiring facts — trigger this skill.
  Works for all audiences: students, journalists, business professionals, academics, curious people.
---

# Deep Research Skill

A structured approach to thorough, reliable, multi-source research — for anyone, any topic.

---

## 1. Understand the Research Goal First

Before searching, ask yourself (or the user if unclear):

- **Purpose**: Why do they need this? (personal curiosity, decision-making, writing a report, fact-checking, academic work, professional use?)
- **Depth**: A quick overview or a comprehensive deep dive?
- **Audience**: Who will read or use this? (themselves, a boss, a professor, a general audience?)
- **Constraints**: Any time period, geography, language, or source type preferences?
- **Format**: Do they want a report, a summary, bullet points, a comparison table, raw notes?

> If the request is clearly stated (e.g., "write me a deep report on the history of solar energy"), proceed directly. Only ask for clarification if genuinely ambiguous.

---

## 2. Research Planning

Before running searches, map out the terrain:

### Decompose the Topic
Break the main question into sub-questions. Example:
- Main question: "Is intermittent fasting effective?"
- Sub-questions: What does clinical evidence say? What are the mechanisms? Who does it work for? What are the risks? What do critics say? What's the consensus?

### Identify Source Types Needed
Choose the right source types for the topic:

| Topic Type | Best Source Types |
|---|---|
| Scientific / Medical | Research papers, systematic reviews, health institutions (WHO, NIH, CDC) |
| Historical | Academic books, archives, encyclopedias, primary sources |
| Business / Market | Industry reports, company filings, financial news, analyst reports |
| Current Events | News outlets, government sources, NGOs |
| Legal / Policy | Official legislation, court records, policy think tanks |
| Technology | Official documentation, reputable tech publications, academic papers |
| Personal Finance | Government financial agencies, established financial institutions |

### Estimate Search Volume
- **Simple topic**: 3–5 searches
- **Moderate complexity**: 6–12 searches
- **Full deep dive / report**: 12–25+ searches across multiple angles

---

## 3. The Research Process

### Phase 1: Orientation Searches (2–4 searches)
Get the lay of the land. Search broad terms to understand:
- What the core concepts are
- What the major debates or angles are
- Which institutions or experts are authoritative on this topic

### Phase 2: Targeted Deep Searches (5–15 searches)
Go narrow. For each sub-question:
- Search for the specific claim or angle
- Fetch full articles when a snippet isn't enough (`web_fetch` key sources)
- Look for primary sources (studies, official data, original documents) not just commentary

### Phase 3: Verification & Counter-research (2–5 searches)
Actively look for:
- Contradicting evidence or alternative views
- Criticism of dominant claims
- Recent updates that might change the picture
- Fact-checks of specific claims

> **Critical rule**: Never stop at one source for an important claim. Cross-reference it.

### Phase 4: Gap-filling (as needed)
After drafting, identify what's still unclear or missing, and search specifically for those gaps.

---

## 4. Source Evaluation

For every source, assess:

### Credibility Checklist
- **Who wrote it?** Named expert, institution, or anonymous?
- **Where was it published?** Peer-reviewed journal, established newspaper, government site, or unknown blog?
- **When?** Is it current enough for the topic?
- **Why?** Does the source have an agenda, funding conflict, or bias?
- **Is it primary or secondary?** Primary (original study, official data) is stronger than secondary (reporting on another report).

### Red Flags
- No author or institution named
- Extraordinary claims without cited evidence
- Selling something related to the claims
- Only one source making the claim
- Very old data for fast-changing topics

### Green Flags
- Peer-reviewed or published in established outlets
- Cites its own primary sources
- Author has relevant credentials
- Multiple independent sources agree
- Includes limitations or caveats (honest research acknowledges uncertainty)

---

## 5. Synthesis: Turning Information into Insight

Raw facts aren't enough. Good research synthesizes:

### Patterns to Look For
- **Consensus**: What do most credible sources agree on?
- **Contested areas**: Where do experts disagree, and why?
- **Emerging evidence**: What's new or shifting?
- **Gaps**: What isn't well-studied yet?

### Avoid These Synthesis Errors
- **Cherry-picking**: Using only sources that support one view
- **False balance**: Treating fringe and mainstream views as equally valid
- **Recency bias**: Assuming newer = better without checking quality
- **Authority bias**: Trusting a famous source without verifying the claim

---

## 6. Output Formats

Choose the format that best serves the user's need:

### A) Research Summary (default for most requests)
```
## [Topic]

**Key Finding**: [One-sentence answer to the main question]

### What We Know
[2–4 paragraphs of synthesized findings, citing sources]

### Key Debates / Uncertainties
[What experts disagree on or what isn't settled]

### Practical Implications
[What this means for the user's situation]

### Sources
[List of key sources with brief annotations]
```

### B) Comparison / Analysis Table
Use when comparing options, products, approaches, or positions.
Columns: criteria that matter | rows: the things being compared.

### C) Deep Report (for lengthy research)
See `references/report-structure.md` for full template.

### D) Annotated Source List
When the user wants to explore themselves — provide curated sources with a brief note on what each one offers and why it's valuable.

### E) Fact-Check Format
```
**Claim**: [Exact claim being checked]
**Verdict**: True / Mostly True / Misleading / False / Unverifiable
**Evidence**: [What sources say]
**Nuance**: [Important context or caveats]
**Sources**: [Citations]
```

---

## 7. Citation and Transparency Standards

- Always cite sources for specific claims, data points, and statistics
- Distinguish between: established fact, expert consensus, one study's finding, and opinion
- Use hedging language honestly: "evidence suggests", "according to X", "studies show" vs "it is proven that"
- If a claim can't be verified, say so clearly
- Mention when information may be outdated or when the topic is fast-moving

---

## 8. Research Ethics and Limitations

Always be transparent with the user about:

- **Knowledge cutoff**: Remind them if the topic is very recent and may have changed
- **Source access**: Some primary sources (paywalled journals, internal documents) may not be accessible
- **Uncertainty**: Don't project more confidence than the evidence warrants
- **Bias awareness**: Note when a topic is politically or commercially contested and sources may be biased

---

## 9. Topic-Specific Guidance

Read `references/topic-guides.md` for specific guidance on:
- Medical and health research
- Legal and regulatory research  
- Financial and market research
- Scientific and academic research
- Historical research
- Investigative / journalistic research

---

## 10. Delivering the Report

> This section is critical for long reports. Skipping it is the most common cause of incomplete output.

### When to write to a file

Write the report to a `.md` file whenever the output is expected to exceed ~300 words. Do **not** print long reports inline — the model output window is limited, and a large inline response will be cut off.

### Filename convention

Use a descriptive, lowercase, hyphenated filename in the current working directory:
- `research-<topic>-<date>.md` — e.g. `research-transformer-history-2025-05-31.md`
- Or use the exact filename the user requested

### Section-by-section writing pattern (use for any report longer than ~500 lines)

Writing everything in a single `Write` call requires generating the entire file as one tool parameter — this can exceed the model's output limit mid-call, silently truncating the file. Instead:

**Step 1 — Write a skeleton** using the `Write` tool with placeholder text for each section:
```
## Introduction
[PLACEHOLDER]

## Background
[PLACEHOLDER]

## Key Findings
[PLACEHOLDER]
...
```

**Step 2 — Fill each section** using the `Edit` tool (one Edit call per section):
- `old_string`: the placeholder line for that section (e.g. `[PLACEHOLDER]` under `## Introduction`)
- `new_string`: the full written content for that section

Each Edit call generates only one section at a time (~200–600 tokens), well within any output limit regardless of how long the full report is.

### After writing

Always tell the user:
- The filename where the report was saved
- A 2–3 sentence summary of the key findings

---

## 11. Quality Self-Check Before Delivering

Before presenting findings, verify:

- [ ] Did I search enough sources (not just 1–2)?
- [ ] Did I actively look for counter-evidence?
- [ ] Are my sources credible and appropriate for this topic?
- [ ] Did I distinguish facts from opinions and contested claims?
- [ ] Is the output format right for this user and their purpose?
- [ ] Have I been transparent about uncertainty and limitations?
- [ ] Did I avoid reproducing copyrighted text (paraphrase and cite instead)?
- [ ] Is the output actually useful — not just long?
- [ ] For reports longer than ~300 words: saved to a file, not printed inline?
- [ ] If the report is long: used section-by-section Edit pattern rather than one massive Write call?

---
name: getting-things-done
description: Use this skill to help the user manage tasks, to-dos, and commitments with the Getting Things Done (GTD) methodology, recording every item in the built-in Todo tool. It covers capturing everything on their mind, processing an overflowing inbox, turning fuzzy stuff into concrete next actions, sorting work into trusted lists (next actions, projects, waiting-for, someday/maybe, calendar), running a weekly review, and deciding what to actually do right now. Trigger whenever the user talks about tasks or things to do, feels scattered, behind, or overloaded, wants to get their to-dos under control, or wants to work more deliberately — even if they never say the words "GTD" or "productivity". Trigger on casual requests too: "help me get organized", "I have a million things in my head", "process my inbox", "what should I work on next", "do a weekly review", "turn this into next actions", "I keep forgetting things", "break this project down", "I'm drowning in tasks", "add a task", "add a to-do", "what's on my list". This skill is the thinking method; capture and track the actual items with the built-in Todo tool (action add / edit / list / complete / start / cancel / remove), not separate files. For long-horizon roadmaps, timelines, and multi-week project scheduling, hand off to the planning skill; this skill is the trusted day-to-day system that keeps commitments off the mind and moving.
---

# Getting Things Done Skill

A thinking method for helping users capture, clarify, organize, review, and act on everything they've committed to — so their mind is clear and nothing falls through the cracks.

This skill supplies the **methodology only**. The trusted system where items actually live is the **built-in `Todo` tool** — a single tool driven by an `action` (`add`, `edit`, `list`, `complete`, `start`, `cancel`, `remove`, `reorder`). Don't create separate list files — GTD is how you *think*; the `Todo` tool is where you *store*.

---

## The `Todo` Tool at a Glance

Everything in this skill maps onto one tool. Learn its shape once:

- **`action`** (required): `add`, `edit`, `list`, `complete`, `start`, `cancel`, `remove`, `reorder`.
- **`scope`** (required): `personal` (life management, stored at `~/.curie-agent/tasks.json`) or `project` (work tied to the current repo, stored at `<cwd>/tasks.json`). Default to `personal` unless the user is organizing work inside a codebase.
- **`title`** (required for `add`): the task text. Start it with a verb.
- **`description`**: free-form detail — the project outcome, who you're waiting on, the current next action, etc.
- **`status`**: `backlog` → `todo` → `in_progress` → `done` (or `canceled`). New tasks default to `todo`.
- **`priority`**: `low`, `medium`, `high`, `critical` (defaults to `medium`).
- **`tags`**: a string array — this is where **contexts** (`@calls`, `@computer`) and **list types** (`project`, `someday`, `@waiting`) live.
- **`id`**: required to `edit`, `complete`, `start`, `cancel`, or `remove` a specific task.
- **`filter_status` / `filter_priority`**: narrow an `action: list`.
- **`ids`**: an ordered array for `action: reorder`.

There are **no dependency fields** (no "blocked by"). Express a project's current next action in its `description` or as a separate task tagged for the project.

Time-bound commitments are **not** `Todo` items — use the sibling tools:
- **`CreateReminder`** (`message`, `scheduled_at`) — fires a notification at a set time.
- **`CreateScheduledTask`** (`instruction`, `scheduled_at`) — has the agent *act* at a set time.

---

## Core Philosophy

The foundational insight of GTD: **your mind is for having ideas, not holding them.** Anything you're trying to remember is an "open loop" that quietly drains attention. The fix is a **trusted external system** you actually maintain — here, the `Todo` tool — so the head is free to focus on doing.

Good task management has three enemies:
1. **Open loops** — commitments living only in someone's head, nagging and half-forgotten
2. **Unclear next actions** — items too vague to start ("plan trip", "deal with taxes")
3. **No trusted review** — a system that stops being believed because it's never looked at

Your job is to move the user through the five stages of workflow:
1. **Capture** everything that has their attention
2. **Clarify** what each item means and what — if anything — to do about it
3. **Organize** the results into the `Todo` tool so nothing is lost
4. **Reflect** through regular review so the system stays trusted and current
5. **Engage** — choose what to do with confidence, because everything else is captured

Always anchor to the **user's actual context** — their real workload, energy, and life — not an idealized system. A messy system they use beats a perfect one they abandon.

---

## Step 0: Understand Before Organizing

Before restructuring anyone's tasks, gather enough context to help well. The key questions:

| Question | Why It Matters |
|---|---|
| What currently has your attention? | This is the raw material to capture — start here |
| Where do things live today? (apps, paper, email, head) | Reveals how many inboxes exist and what to consolidate |
| What contexts/modes do you work in? (@calls, @computer, @errands, @home) | Next actions get organized by context, not by project |
| When do you have energy for what? | Engaging well means matching action to available energy |
| Do you review your tasks now? How often? | The weekly review is what makes the system trustworthy |
| What's the single biggest pain point right now? | Focuses the work on what will actually relieve pressure |

If you're missing critical info, **ask first — one focused question at a time.** Don't reorganize someone's life around the wrong assumptions.

---

## The GTD Workflow

Move through these five stages. Often you'll do several in one session — but keep them distinct: mixing them is what makes task management feel chaotic.

### 1. 📥 Capture
*Use when: the user's mind is full, things are scattered, or they say "I don't even know everything I need to do."*

- Get **everything** out of their head — a written "mind sweep"
- Pull from every inbox: sticky notes, email flags, chat, notebooks, the back of their mind
- Capture as fast as it comes; **do not process or judge yet** — that's the next stage
- Prompt broadly: work, home, health, relationships, errands, "shoulds", nagging worries
- Land raw items into the `Todo` tool with `action: add` (optionally `status: backlog` for a rapid-fire dump you'll process next). The relief comes from capturing, not from solving.

### 2. 🔍 Clarify
*Use when: there's a pile of captured items (or a full inbox) that needs processing into meaning.*

Take items **one at a time, top to bottom** — no cherry-picking, no dropping back in the inbox. For each item, walk the decision tree:

```
What is it? — name it plainly.
│
Is it actionable? — is there anything I need to DO about this?
│
├─ NO → route to one of:
│   ├─ Trash            → no longer needed → Todo action: remove
│   ├─ Someday / Maybe  → maybe later, not now → status: backlog + tag "someday" (see Organize)
│   └─ Reference         → no action, worth keeping → note it (wiki/memory), don't track it as a task
│
└─ YES → What is the VERY NEXT physical action?
    │
    ├─ Under ~2 minutes?  → DO IT NOW, then Todo action: complete (the 2-minute rule — tracking costs more than doing)
    │
    └─ Otherwise → is it mine?
        ├─ NO  → DELEGATE → add a task tagged "@waiting" (who + since when in the description)
        └─ YES → DEFER:
            ├─ Must happen on a set day/time → it's a CALENDAR commitment (use CreateReminder / CreateScheduledTask, not Todo)
            └─ Do as soon as able → it's a NEXT ACTION (Todo action: add, status: todo, tag with context)
    │
    └─ Needs more than one action to finish? → it's a PROJECT
        → add a task naming the desired OUTCOME (tag "project"), and record its single current NEXT ACTION in the description
```

Key discipline: a **next action** is the literal next physical, visible thing (the call, the email, the drive). If you can't picture doing it, the real next action is often "decide X" or "research Y".

### 3. 🗂️ Organize
*Use when: clarified items need to land in the right buckets so nothing is lost.*

Record the results in the `Todo` tool. Map GTD's lists onto it as follows:

| GTD list | How to represent it with the `Todo` tool |
|---|---|
| **Next Actions** | `action: add`, `title` starts with a verb, context via `tags` (e.g. `["@calls"]`), `status: todo` — e.g. `title: "Call dentist to book cleaning"`, `tags: ["@calls"]` |
| **Projects** | `action: add`, `title` = the outcome (`"Ship v2 of the report"`), `tags: ["project"]`, current next action written in the `description`; keep the project until the outcome is done (there are no dependency fields) |
| **Waiting For** | `action: add`, `tags: ["@waiting"]`, `description` notes who + since when |
| **Calendar** | Only true date/time commitments — use `CreateReminder` (notification) or `CreateScheduledTask` (agent acts at the time), **not** `Todo`; never a wish list |
| **Someday / Maybe** | `action: add`, `status: backlog`, `tags: ["someday"]`; skip it in day-to-day engagement, revisit in the weekly review |
| **Reference** | Not a task — it's non-actionable info; capture it as a note (wiki/memory), not in the `Todo` list |

Use `status` for workflow state (`backlog` → `todo` → `in_progress` → `done`, or `canceled`), `priority` for how much it matters, and `tags` for both contexts (`@calls`, `@computer`, …) and list types (`project`, `someday`, `@waiting`).

### 4. 🔄 Reflect
*Use when: the user wants a weekly review, feels their system is stale, or has lost trust in their lists.*

Run the **Weekly Review** — the keystone habit that makes everything else work. Three passes:

- **Get Clear** — empty inboxes, process loose notes, do a fresh mind sweep, clarify everything captured
- **Get Current** — `action: list` (use `filter_status` / `filter_priority`) through Next Actions, Projects, Waiting For, and upcoming reminders; `action: complete` what's done, `action: edit` to update, `action: cancel` or `remove` what's stale. **Confirm every active `project`-tagged task names its next action in the `description`** — a project without one is stalled
- **Get Creative** — review the `someday`-tagged backlog (activate by moving to `status: todo`, or `remove`) and `add` new ideas or projects worth pursuing

The review is complete when inboxes are empty, every project has a next action, and the user trusts their task list reflects reality.

### 5. ▶️ Engage
*Use when: the user asks "what should I work on?" or feels stuck despite an organized list.*

Help them choose using the **four criteria**, in order:
1. **Context** — what can I even do right now, given where I am and what's in front of me? (`action: list` filtered/scanned by context tag)
2. **Time available** — what fits the window I have?
3. **Energy available** — match demanding work to high energy, low-stakes admin to low energy
4. **Priority** — among what's left, what matters most? (`filter_priority` or the `priority` field)

Name the **threefold nature of work**: doing predefined work (the list), doing work as it shows up, and defining work (capturing/clarifying) — all three are legitimate. End by surfacing the single **most sensible next action** for right now, and mark it with `action: start` (sets `in_progress`).

---

## Universal GTD Principles

Apply these regardless of the stage:

- **The 2-Minute Rule** — if an action takes under ~2 minutes, do it the moment you clarify it (then `action: complete` if it was already tracked); tracking would cost more than doing.
- **A next action is a single, visible, physical action** — "Call the dentist to book a cleaning," not "dentist." If you can't picture doing it, keep breaking it down.
- **Projects vs. actions** — any outcome needing more than one step is a project (`tags: ["project"]`). Projects don't get "done" — their next actions do. Every active project must always have exactly one defined next action in its `description`.
- **Contexts over priorities** — organize next actions by the tool/place they require (via `tags`), not by project. When you have a computer and 20 minutes, you want to see what's doable *now*.
- **One trusted system, reviewed weekly** — trust comes from capturing completely and reviewing regularly. The Weekly Review is non-negotiable; without it, things creep back into the head.

### The Natural Planning Model (for projects that need thinking-through)
Plan the way the mind naturally does: **Purpose → Principles → Outcome/Vision → Brainstorm → Organize → Next Action.** When a project is stuck, it's usually starved at one end — either it needs **more purpose/vision** (unclear or unmotivating) or **more next-action detail** (clear intent, no concrete first step). Diagnose which and supply it.

### Horizons of Focus (when priorities feel murky, zoom out)
Actions serve larger commitments. Six altitudes, from concrete to abstract:

| Altitude | Horizon | What lives here |
|---|---|---|
| Runway | Next Actions | The concrete physical actions to take now |
| 10,000 ft | Projects | Outcomes needing more than one action |
| 20,000 ft | Areas of Focus | Ongoing roles & standards (health, finances, team, home) |
| 30,000 ft | Goals | What to achieve in the next 1–2 years |
| 40,000 ft | Vision | What success looks like in 3–5 years |
| 50,000 ft | Purpose & Principles | Why it exists; the ultimate intention and core values |

When someone feels adrift despite a tidy list, the problem is usually higher up — a project serving no real goal, or a neglected area of responsibility.

### Contexts
A context is the tool, place, or situation an action requires, stored as a `tag`. Fit them to the user's real life — a few good ones (`@calls`, `@computer`, `@errands`, `@home`, `@office`, `@agendas`, `@anywhere`, `@waiting`) beat a dozen unused ones. A context should answer "what can I do here, now?"

---

## Output Quality Standards

Good GTD work:
- Resolves **every captured item** into an outcome + next action, or a clear non-action decision (`remove` / `someday` backlog / reference note)
- States next actions as **verbs the user can picture doing** ("email Sara the draft"), never nouns ("Sara")
- **Tags each next action with a context** so it's actionable at a glance
- Refuses vagueness — turns "plan the trip" into "call travel agent to compare Lisbon flights"
- Keeps the **calendar clean** — only true date/time commitments (as reminders/scheduled tasks); everything else is a next action
- Leaves the user's task list reflecting reality — nothing captured is left unprocessed

---

## Presenting the System

- Use the `Todo` tool as the source of truth; don't duplicate it into markdown lists
- When summarizing, group next actions under **context headers** (`@calls`, `@computer`, …) drawn from their tags
- After processing, **summarize what changed**: how many items captured, clarified, and where they landed
- Always surface the **immediate next action** so the user leaves with something to do
- Keep it low-friction — a habit the user maintains beats an elaborate scheme they abandon
- Offer to keep processing, run a review, or help them pick what to work on now

---

## Anti-Patterns to Avoid

- ❌ **Vague next actions**: "Website" or "Mom" aren't actions. If you can't do it as written, break it down until you can.
- ❌ **One giant undifferentiated list**: split by context and by list type (via `tags` and `status`) so the right things surface at the right time.
- ❌ **Calendar as a wish list**: only schedule (`CreateReminder` / `CreateScheduledTask`) things that genuinely must happen at that time. Everything else is a next action.
- ❌ **Capturing without clarifying**: a full inbox you never process is just a nicer pile. Capture *and* clarify.
- ❌ **A system never reviewed**: skip the Weekly Review and trust collapses — the mind quietly starts re-hoarding open loops.
- ❌ **Over-engineering the setup**: don't build an elaborate scheme before doing the work. Start simple with the `Todo` tool, get the habit, add structure only when a real need appears.
- ❌ **Spawning separate list files**: the trusted system is the `Todo` tool (tasks.json), not a pile of markdown documents.

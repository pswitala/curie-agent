---
name: planning
description: >
  Use this skill for any kind of planning task — personal, professional, creative, or logistical.
  This covers a broad range: project planning, life planning, event planning, travel planning,
  business strategy, goal setting, habit building, content calendars, study plans, home renovation
  timelines, wedding planning, meal planning, financial planning, career planning, and more.
  Trigger this skill whenever the user wants to organize actions over time, structure a complex
  goal into steps, create a roadmap, break down an overwhelming task, prioritize competing demands,
  or build a structured schedule or timeline. Trigger even if the request seems casual —
  "help me plan my week", "I want to launch a course, where do I start", "how should I approach
  renovating my kitchen", "plan a birthday party for 30 people", "I'm overwhelmed, help me organize
  my life" — all of these should use this skill. This is NOT limited to software development.
---

# Planning Skill

A universal skill for helping users create clear, actionable, and realistic plans across any domain of life or work.

---

## Core Philosophy

Great planning has three enemies: **vagueness**, **overwhelm**, and **rigidity**. Your job is to:
1. Make goals concrete and outcomes measurable
2. Break work into steps small enough to actually start
3. Build in flexibility so the plan survives contact with reality

Always anchor the plan to the **person's actual context** — their time, energy, resources, constraints, and priorities — not an idealized version.

---

## Step 0: Understand Before Planning

Before writing a single bullet point, gather enough context to plan well. The key questions:

| Question | Why It Matters |
|---|---|
| What is the end goal? | Without a destination, you can't map a route |
| What does success look like? | Helps define milestones and "done" |
| What's the timeline / deadline? | Determines pace and tradeoffs |
| What resources are available? | Time, money, people, tools, energy |
| What constraints exist? | Budget limits, non-negotiables, dependencies |
| What's already been done? | Avoid re-planning what's settled |
| What's the biggest risk or unknown? | Informs where to build in buffers |

If you're missing critical info, **ask first** — one focused question at a time. Don't write a plan for the wrong goal.

---

## Planning Modes

Choose the right mode based on what the user needs. Often you'll combine modes.

### 1. 🗺️ Roadmap Planning
*Use when: the user has a big goal with no clear path yet.*

- Define the end state clearly
- Work backwards to identify major milestones
- Group milestones into phases (e.g., Foundation → Build → Launch → Sustain)
- Assign rough timeframes to each phase
- Identify dependencies between milestones

**Output format**: Phased roadmap with milestones and timeframes. See `references/templates.md → Roadmap`.

---

### 2. 📅 Timeline / Schedule Planning
*Use when: the user has a deadline and needs to fit work into available time.*

- Anchor to the deadline and work backwards
- Identify fixed dates (events, appointments, dependencies)
- Estimate time for each task honestly — add 20–30% buffer
- Assign tasks to specific days/weeks
- Flag overloaded periods proactively

**Output format**: Week-by-week or day-by-day schedule. See `references/templates.md → Timeline`.

---

### 3. 🎯 Goal Decomposition
*Use when: the user has a goal but is overwhelmed and doesn't know where to start.*

- Restate the goal clearly in concrete terms
- Break it into 3–7 major outcomes needed
- For each outcome, list 3–5 specific actions
- Identify the very **first action** — make it small enough to do today
- Surface blockers and unknowns upfront

**Output format**: Goal → Outcomes → Actions tree. See `references/templates.md → Decomposition`.

---

### 4. 🏗️ Project Planning
*Use when: the user is managing a multi-person or multi-phase effort with deliverables.*

- Define scope: what's IN and OUT of this project
- List all deliverables
- Map dependencies between tasks
- Assign ownership (if relevant)
- Set checkpoints / review points
- Define risks and mitigations

**Output format**: Project brief + task list with owners and dates. See `references/templates.md → Project`.

---

### 5. 📆 Periodic Planning (Weekly / Monthly / Quarterly)
*Use when: the user wants to organize recurring time periods.*

- Review what happened last period (if known)
- Surface priorities and commitments for this period
- Allocate time blocks to categories (work, personal, health, relationships, etc.)
- Set 1–3 "wins" to aim for — not a perfect list, just top priorities
- Leave margin for the unexpected

**Output format**: Time-block schedule + top priorities list. See `references/templates.md → Periodic`.

---

### 6. 🎉 Event / Experience Planning
*Use when: the user is organizing an event, trip, celebration, or one-time experience.*

- Define: Who, What, When, Where, How many people, Budget
- Break into: Pre-event tasks | Day-of tasks | Post-event tasks
- Create vendor/supplier list if needed
- Build a communications plan (invites, reminders, follow-ups)
- Identify what can go wrong and have a backup

**Output format**: Event checklist with timeline. See `references/templates.md → Event`.

---

### 7. 🔄 Habit & Routine Planning
*Use when: the user wants to build a sustainable system, not a one-time plan.*

- Anchor new habits to existing routines (habit stacking)
- Start smaller than feels necessary — consistency > intensity
- Design the environment to reduce friction
- Define a tracking method
- Build in a weekly review moment

**Output format**: Routine design + habit tracker structure. See `references/templates.md → Habit`.

---

## Universal Planning Principles

Apply these regardless of the mode:

### Prioritization
When there's more to do than time allows, help the user prioritize. Use the **Impact × Urgency** lens:
- High impact + urgent → Do first
- High impact + not urgent → Schedule deliberately (these are often neglected)
- Low impact + urgent → Delegate or batch
- Low impact + not urgent → Drop or defer

### Buffer and Realism
- Most people underestimate time by 30–50%
- Build recovery time after intense periods
- Mark "must haves" vs "nice to haves" explicitly

### Dependencies
- Identify what must happen *before* something else can start
- Surface these early — they're where plans collapse

### Energy, Not Just Time
- Help the user match task type to their energy level
- Deep focus work → morning (for most people)
- Admin, email, calls → afternoon
- Creative / brainstorming → after movement or meals

### The First Next Action
Always end with: *"What's the very first concrete action you'll take?"* This closes the loop between planning and doing.

---

## Output Quality Standards

A good plan output:
- Is **specific** (not "work on the project" but "draft the introduction section")
- Is **time-bound** (has dates, durations, or deadlines)
- Is **realistic** (accounts for the user's actual schedule)
- Is **actionable** (the next step is clear without more planning)
- Is **appropriately detailed** (not so granular it's overwhelming, not so vague it's useless)
- Has a **clear visual structure** (tables, phases, or numbered lists depending on content)

---

## Domain-Specific Guidance

For specialized domains, read the relevant reference file before planning:

| Domain | Reference File |
|---|---|
| Business / Startup / Product | `references/business.md` |
| Personal Life / Wellbeing / Career | `references/personal.md` |
| Events / Travel / Experiences | `references/events.md` |
| Learning / Education / Skill Building | `references/learning.md` |
| Creative Projects (writing, art, content) | `references/creative.md` |

---

## Presenting the Plan

- Use headers to separate phases or categories
- Use tables for schedules and timelines
- Use numbered lists for sequences where order matters
- Use bullet lists for non-ordered items
- Bold key dates, owners, and critical-path items
- Always end with a "Next Steps" or "Start Here" section
- Offer to adjust, drill down on a phase, or export as a document

---

## Anti-Patterns to Avoid

- ❌ **The Perfect Plan Trap**: Don't over-engineer. A 70% good plan that gets started beats a 100% plan that never does.
- ❌ **Planning Without Constraints**: Never ignore time, money, or energy limits — they're the whole game.
- ❌ **Front-loading Detail**: Don't plan week 6 in detail when week 1 is still unclear. Plan near-term in detail, far-term in rough strokes.
- ❌ **Missing the Human**: Always consider motivation, fear, habit, and energy — not just tasks and dates.
- ❌ **No Review Cadence**: Every plan needs a moment to check in, adapt, and course-correct.

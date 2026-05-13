# HEARTBEAT.md - Proactive Routines

**AI INSTRUCTION:** This file dictates your proactive workflow. Execute the specific routine based on the current time interval. Your goal is to synthesize context, surface insights, and maintain the workspace silently.

### 🛑 GLOBAL CONSTRAINT: OUTPUT LIMIT
Before outputting any response to the user, calculate the estimated length. **If the draft exceeds 3,800 characters, you MUST perform a recursive edit.** Swap complex phrases for concise synonyms, remove non-essential adjectives, and compress the output to fit under the limit.

---

## 1. INTRADAY (Execute on EVERY Heartbeat)
*   **Triage:** Scan the mailbox/channels for critical unread items. Filter specifically for direct requests or time-sensitive obligations.
*   **Align:** Cross-reference new inputs against `[P1]` active tasks in `TODO.md`. Flag immediate conflicts or priority shifts.

## 2. DAILY (Execute once per day)
*   **Ingest & Update:** Read yesterday's daily log (e.g., `memory/YYYY-MM-DD.md`). Extract any persistent facts, preferences, or major events missed, and append them to `MEMORY.md`.
*   **Rollover:** Review `TODO.md`. Draft newly identified obligations from the day's logs/emails as staged `[P2]` or `[P3]` tasks. Do not delete incomplete tasks.
*   **Report:** Generate a highly concise Daily Brief for the user containing: 1-2 actionable insights (based on friction points), proposed `TODO.md` additions, and a brief system status.

## 3. WEEKLY (Execute on Sunday/End of Week)
*   **Analyze:** Review the past 7 daily logs. Identify recurring workflow bottlenecks, continuously rolled-over tasks, or shifts in the user's focus.
*   **Groom Backlog:** Review all `[P3]` tasks in `TODO.md`. Flag stale tasks (untouched for 14+ days) for deletion, or suggest elevating them to `[P2]`.
*   **Map Dependencies:** Compare the upcoming week's calendar/reminders against current `[P1]` and `[P2]` tasks to flag immediate schedule conflicts.

## 4. MONTHLY (Execute on the 1st of the Month)
*   **Consolidate:** Extract macro-level developments and milestones from the entire month's logs. Append this distilled summary to `MEMORY.md` to convert short-term events into long-term knowledge.
*   **Archive:** Move completed `[x]` tasks in `TODO.md` that are older than 30 days into `memory/TODO-ARCHIVE.md` to keep the active file lightweight.
*   **Strategize:** Draft a brief macro-level report of productivity trends, major achievements, and proposed adjustments to the user's organizational system.

## 5. DREAMING (Execute during quiet hours)
*   **Reflect:** Review recent Heartbeat Briefs and daily logs for emergent patterns, creative connections, or unresolved tensions.
*   **Ideate:** Generate 1-3 novel ideas or improvements to the user's workflow, tools, or goals.
*   **Synthesize:** Draft a concise Dreaming Brief: key reflections, creative suggestions, and long-term strategic observations.
*   **Silent:** Do not notify the user unless an insight is critical. Log findings to MEMORY.md for review at the next active heartbeat.
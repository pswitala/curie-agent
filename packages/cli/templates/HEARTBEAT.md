# HEARTBEAT.md - Proactive Routines

**AI INSTRUCTION:** This file dictates your proactive workflow. Execute the specific routine based on the current time interval. Your goal is to synthesize context, surface insights, and maintain the workspace silently.

### 🛑 GLOBAL CONSTRAINT: OUTPUT LIMIT
Before outputting any response to the user, calculate the estimated length. **If the draft exceeds 3,800 characters, you MUST perform a recursive edit.** Swap complex phrases for concise synonyms, remove non-essential adjectives, and compress the output to fit under the limit.

---

## 1. INTRADAY
*   **Triage:** Scan the mailbox/channels for critical unread items. Filter specifically for direct requests or time-sensitive obligations.
*   **Align:** Cross-reference new inputs against high important active tasks on TODO tool. Flag immediate conflicts or priority shifts.

## 2. DREAMING
*   **Establish Target Date:** Check the current system time. If the current time is between 00:00 (midnight) and 06:00 AM, the target date to process is **YESTERDAY**. If the current time is later than 08:00 AM, the target date to process is **TODAY**.
*   **Synthesize:** Read the raw logs, completed actions, and inputs specifically for the **Target Date**. Process them into a clear, highly readable, chronological summary of what actually occurred. 
*   **Memory Partitioning:** If new persistent data (hobbies, projects, clients) emerged during the Target Date, offload them to their dedicated files in `~/.curie-agent/memory/` and update `MEMORY.md` with links.
*   **Self-Correction:** Analyze the workflow and actions of the Target Date. If persistent friction, bottlenecks, or recurring missed tasks are detected, draft a proposed update/tweak to the rules in this `HEARTBEAT.md` file to optimize future workflows.
*   **Reflect:** Review recent Heartbeat Briefs and daily logs for emergent patterns, creative connections, or unresolved tensions.
*   **Ideate:** Generate 1-3 novel ideas or improvements to the user's workflow, tools, or goals based on the recent summaries.
!IMPORTANT: Write DREAMS to `~/.curie-agent/memory/DREAM-YYYY-MM-DD.md` (Ensure the date in the filename matches the Target Date you just processed, NOT necessarily the current calendar date).

## 3. DAILY
*   **Ingest & Update:** Read the clean summary generated during the Dreaming routine. Extract any persistent facts, preferences, or major events, and append them to `MEMORY.md`.
*   **Rollover:** Review tasks in TODO tool. Draft newly identified obligations from yesterday's synthesis as staged medium, todo or backlog tasks. Do not delete incomplete tasks.
*   **Waether:** Check Weather for today.
*   **Report:** Generate a highly concise Daily Brief for the user containing: 1-2 actionable insights, proposed new tasks to TODO additions, your proposed `HEARTBEAT.md` updates (from Dreaming), and a brief system status.

## 4. WEEKLY
*   **Analyze:** Review the past 7 daily summaries. Identify recurring workflow bottlenecks, continuously rolled-over tasks, or shifts in the user's focus.
*   **Groom Backlog:** Review all todo, backlog tasks in TODO tool. Flag stale tasks (untouched for 14+ days) for deletion, or suggest elevating them to medium.
*   **Map Dependencies:** Compare the upcoming week's calendar/reminders against current high / medium tasks to flag immediate schedule conflicts.

## 5. MONTHLY
*   **Consolidate:** Extract macro-level developments and milestones from the entire month's logs. Append this distilled summary to `MEMORY.md` to convert short-term events into long-term knowledge.
*   **Archive:** Move completed Canceled tasks in TODO that are older than 30 days to keep the active file lightweight.
*   **Strategize:** Draft a brief macro-level report of productivity trends, major achievements, and proposed adjustments to the user's organizational system.
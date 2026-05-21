# HEARTBEAT.md - Proactive Routines

**AI INSTRUCTION:** This file dictates your proactive workflow. Execute the specific routine based on the current time interval. Your goal is to synthesize context, surface insights, and maintain the workspace silently.

### 🛑 GLOBAL CONSTRAINT: OUTPUT LIMIT
Before outputting any response to the user, calculate the estimated length. **If the draft exceeds 3,800 characters, you MUST perform a recursive edit.** Swap complex phrases for concise synonyms, remove non-essential adjectives, and compress the output to fit under the limit.

---

## 1. INTRADAY (Execute on EVERY Heartbeat)
*   **Triage:** Scan the mailbox/channels for critical unread items. Filter specifically for direct requests or time-sensitive obligations.
*   **Align:** Use the `Todo` tool to list project tasks and cross-reference against new inputs. Flag immediate conflicts or priority shifts.

## 2. DREAMING (Execute nightly between 02:00 - 03:00)
*   **Synthesize:** Read yesterday's raw logs, completed actions, and inputs. Process them into a clear, highly readable, chronological summary of what actually occurred. 
*   **Memory Partitioning:** If new persistent data (hobbies, projects, clients) emerged, offload them to their dedicated files in `~/.curie-agent/memory/` and update `MEMORY.md` with links.
*   **Self-Correction:** Analyze the flow of yesterday. If persistent friction, bottlenecks, or recurring missed tasks are detected, draft a proposed update/tweak to the rules in this `HEARTBEAT.md` file to optimize future workflows.
*   **Reflect:** Review recent Heartbeat Briefs and daily logs for emergent patterns, creative connections, or unresolved tensions.
*   **Ideate:** Generate 1-3 novel ideas or improvements to the user's workflow, tools, or goals.
*   **Write dreaming notes:** Write DREAMS to `~/.curie-agent/memory/DREAMING-YYYY-MM-DD.md`

## 3. DAILY (Execute once per day / Morning)
*   **Ingest & Update:** Read the clean summary generated during the Dreaming routine. Extract any persistent facts, preferences, or major events, and append them to `MEMORY.md`.
*   **Rollover:** Use the `Todo` tool to list active project tasks. Draft newly identified obligations from yesterday's synthesis as staged medium or low priority tasks. Do not remove incomplete tasks.
*   **Report:** Generate a highly concise Daily Brief for the user containing: 1-2 actionable insights, proposed `tasks.json` additions, your proposed `HEARTBEAT.md` updates (from Dreaming), and a brief system status.

## 4. WEEKLY (Execute on Sunday/End of Week)
*   **Analyze:** Review the past 7 daily summaries. Identify recurring workflow bottlenecks, continuously rolled-over tasks, or shifts in the user's focus.
*   **Groom Backlog:** Use the `Todo` tool to list project tasks with backlog status. Flag stale tasks (untouched for 14+ days) for removal, or suggest moving them to todo status.
*   **Map Dependencies:** Compare the upcoming week's calendar/reminders against current `[P1]` and `[P2]` tasks to flag immediate schedule conflicts.

## 5. MONTHLY (Execute on the 1st of the Month)
*   **Consolidate:** Extract macro-level developments and milestones from the entire month's logs. Append this distilled summary to `MEMORY.md` to convert short-term events into long-term knowledge.
*   **Strategize:** Draft a brief macro-level report of productivity trends, major achievements, and proposed adjustments to the user's organizational system.
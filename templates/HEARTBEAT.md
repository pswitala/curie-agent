# HEARTBEAT.md
AI AGENT INSTRUCTIONS: This file dictates your periodic proactive routine. Execute the following protocols strictly according to their designated time intervals to synthesize user context, surface actionable insights, and maintain the primary knowledge base.

## TIMES Routine (Tactical & Immediate)
- Mailbox Triage: Scan for critical unread items, specifically filtering for direct requests or time-sensitive obligations.
- Reminders: Parse alerts triggering within the next 4 to 12 hours.
- Task Alignment: Cross-reference new emails and imminent reminders against [P1] active tasks in `/root/.curie-agent/TODO.md` to ensure immediate priorities are aligned.

## DAILY Routine (Synthesis & Rollover)
- Data Ingestion: Load and parse the trailing daily logs from day before (e.g., `/root/.curie-agent/memory/2026-05-03.md`).
- TODO Maintenance: Automatically rollover incomplete tasks. Draft newly identified obligations from the day's emails or logs as staged [P2] or [P3] tasks for user approval.
- Daily Insight: Formulate 1-2 highly concise, actionable insights based on the day's friction points or completed items.
- User Output: Generate the Daily Heartbeat Brief containing insights, proposed `/root/.curie-agent/TODO.md` additions, and system status.

## WEEKLY Routine (Review & Prioritization)
- Behavioral Analysis: Analyze the past 7 daily logs. Identify tasks that are continuously rolled over, recurring workflow bottlenecks, or shifts in user focus.
- Backlog Grooming: Review all [P3] (Backlog) tasks in `/root/.curie-agent/TODO.md`. Flag stale tasks (untouched for 2+ weeks) for deletion or suggest elevating them to [P2].
- Dependency Map: Analyze the upcoming week's reminders and calendar events against current [P1] and [P2] tasks to flag upcoming schedule conflicts.

## MONTHLY Routine (Consolidation & Archival)
- Consolidate MEMORY.md: Extract the core, high-level developments and milestones from the entire month's daily logs. Append this distilled summary to the main MEMORY.md file to transition short-term events into long-term systemic knowledge.
- System Cleanup: Move [x] completed tasks in `/root/.curie-agent/TODO.md` older than 30 days into a deep archive state to keep the active file lightweight.
- Strategic Report: Draft a macro-level summary of the month's productivity trends, major achievements, and proposed adjustments to the user's organizational system.
import { SessionStore, type Event } from '@curie-agent/core';

export interface StatsData {
  tokensPerDay: Array<{ date: string; input: number; output: number }>;
  modelUsage: Array<{ model: string; turns: number; tokens: number }>;
  totalSessions: number;
}

const DAYS = 14;

function toDateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function loadStatsData(): StatsData {
  const store = new SessionStore();
  const perDay = new Map<string, { input: number; output: number }>();
  const perModel = new Map<string, { turns: number; tokens: number }>();
  let totalSessions = 0;

  let sessions: Array<{ id: string; model: string }> = [];
  try {
    sessions = store.list();
    totalSessions = sessions.length;
  } catch {
    return { tokensPerDay: buildEmptyWindow(), modelUsage: [], totalSessions: 0 };
  }

  for (const s of sessions) {
    if (s.model) {
      const entry = perModel.get(s.model) ?? { turns: 0, tokens: 0 };
      entry.turns++;
      perModel.set(s.model, entry);
    }

    let sessionTokens = 0;
    let events: Event[] = [];
    try {
      events = store.loadEvents(s.id);
    } catch {
      continue;
    }

    for (const e of events) {
      if (e.type !== 'usage') continue;
      const key = toDateKey(e.timestamp);
      const bucket = perDay.get(key) ?? { input: 0, output: 0 };
      bucket.input += e.inputTokens;
      bucket.output += e.outputTokens;
      perDay.set(key, bucket);
      sessionTokens += e.inputTokens + e.outputTokens;
    }

    // Attach session tokens to model
    if (s.model && sessionTokens > 0) {
      const entry = perModel.get(s.model);
      if (entry) {
        entry.tokens += sessionTokens;
        perModel.set(s.model, entry);
      }
    }
  }

  // Build 14-day sliding window ending today, zero-filled.
  const window = buildEmptyWindow();
  for (const slot of window) {
    const hit = perDay.get(slot.date);
    if (hit) { slot.input = hit.input; slot.output = hit.output; }
  }

  const modelUsage = Array.from(perModel.entries())
    .map(([model, { turns, tokens }]) => ({ model, turns, tokens }))
    .sort((a, b) => b.turns - a.turns);

  return { tokensPerDay: window, modelUsage, totalSessions };
}

function buildEmptyWindow(): Array<{ date: string; input: number; output: number }> {
  const out: Array<{ date: string; input: number; output: number }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    out.push({ date: d.toISOString().slice(0, 10), input: 0, output: 0 });
  }
  return out;
}

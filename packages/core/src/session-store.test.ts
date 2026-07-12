import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore, ulid } from './session-store.js';
import type { Event } from './event-bus.js';

let tmpDir: string;

function randomDir(): string {
  return path.join(os.tmpdir(), 'curie-agent-test', crypto.randomUUID());
}

beforeEach(() => {
  tmpDir = randomDir();
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('ulid', () => {
  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(ulid());
    }
    expect(ids.size).toBe(100);
  });

  it('generates 26 character strings', () => {
    expect(ulid().length).toBe(26);
  });
});

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(tmpDir);
  });

  it('creates a session with directory and files', () => {
    const info = store.create('/cwd', 'model', 'provider');
    expect(info.id).toHaveLength(26);
    expect(info.cwd).toBe('/cwd');
    expect(fs.existsSync(store.sessionPath(info.id))).toBe(true);
    expect(fs.existsSync(store.eventsPath(info.id))).toBe(true);
    expect(fs.existsSync(store.metadataPath(info.id))).toBe(true);
  });

  it('loads session metadata', () => {
    const created = store.create('/cwd', 'm', 'p');
    const loaded = store.load(created.id);
    expect(loaded).toEqual(created);
  });

  it('returns undefined for non-existent session', () => {
    expect(store.load('nonexistent')).toBeUndefined();
  });

  it('returns undefined when metadata.json is corrupted', () => {
    const info = store.create('/cwd', 'm', 'p');
    fs.writeFileSync(store.metadataPath(info.id), '   \n');
    expect(() => store.load(info.id)).not.toThrow();
    expect(store.load(info.id)).toBeUndefined();
  });

  it('logs a warning when metadata.json is corrupted', () => {
    const info = store.create('/cwd', 'm', 'p');
    fs.writeFileSync(store.metadataPath(info.id), 'not valid json');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.load(info.id);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[session-store]'), expect.anything());
    spy.mockRestore();
  });

  it('appends and loads events', () => {
    const info = store.create('/cwd', 'm', 'p');
    const event: Event = { type: 'status', id: '1', message: 'test', timestamp: Date.now() };
    store.appendEvent(info.id, event);
    const events = store.loadEvents(info.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it('appends multiple events', () => {
    const info = store.create('/cwd', 'm', 'p');
    const events: Event[] = [
      { type: 'status', id: '1', message: 'a', timestamp: 1 },
      { type: 'error', id: '2', message: 'b', timestamp: 2 },
    ];
    store.appendEvents(info.id, events);
    expect(store.loadEvents(info.id)).toHaveLength(2);
  });

  it('recovers valid leading events from a truncated events.jsonl', () => {
    const info = store.create('/cwd', 'm', 'p');
    const events: Event[] = [
      { type: 'status', id: '1', message: 'a', timestamp: 1 },
      { type: 'error', id: '2', message: 'b', timestamp: 2 },
    ];
    store.appendEvents(info.id, events);
    // Simulate a crash mid-write: garbage/truncated JSON appended after valid lines.
    fs.appendFileSync(store.eventsPath(info.id), '{"type":"status","id":"3","mess\n   \n');

    expect(() => store.loadEvents(info.id)).not.toThrow();
    expect(store.loadEvents(info.id)).toEqual(events);
  });

  it('does not throw when appending to a session with corrupted metadata.json', () => {
    const info = store.create('/cwd', 'm', 'p');
    fs.writeFileSync(store.metadataPath(info.id), '   \n');
    const event: Event = { type: 'status', id: '1', message: 'test', timestamp: Date.now() };
    expect(() => store.appendEvent(info.id, event)).not.toThrow();
    expect(store.loadEvents(info.id)).toHaveLength(1);
  });

  it('lists sessions sorted by updatedAt', async () => {
    const s1 = store.create('/a', 'm', 'p');
    await new Promise((r) => setTimeout(r, 10));
    const s2 = store.create('/b', 'm', 'p');
    const sessions = store.list();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.id).toBe(s2.id);
  });

  it('skips a corrupted session and returns the other valid sessions', () => {
    const s1 = store.create('/a', 'm', 'p');
    const bad = store.create('/bad', 'm', 'p');
    const s2 = store.create('/b', 'm', 'p');
    fs.writeFileSync(store.metadataPath(bad.id), '   \n');

    const sessions = store.list();
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  });

  it('removes session directory', () => {
    const info = store.create('/cwd', 'm', 'p');
    store.remove(info.id);
    expect(fs.existsSync(store.sessionPath(info.id))).toBe(false);
  });

  it('returns empty list when no sessions', () => {
    expect(store.list()).toHaveLength(0);
  });
});

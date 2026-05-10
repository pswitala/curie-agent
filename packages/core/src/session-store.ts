import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Event } from './event-bus.js';

export interface SessionInfo {
  id: string;
  cwd: string;
  model: string;
  provider: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionFile {
  path: string;
  events: string;
  metadata: string;
}

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(timestamp?: number): string {
  const ts = timestamp ?? Date.now();
  const timeBuf = new BigUint64Array(1);
  const randBuf = new Uint8Array(16);
  crypto.getRandomValues(randBuf);
  const view = new DataView(timeBuf.buffer);
  view.setBigUint64(0, BigInt(ts), false);

  let result = '';
  const timeBytes = new Uint8Array(timeBuf.buffer);
  for (let i = 0; i < 10; i++) {
    const idx = 9 - i;
    const b = timeBytes[idx]!;
    result += ULID_ALPHABET[b & 0x1f];
  }
  for (let i = 0; i < 16; i++) {
    const b = randBuf[i]!;
    result += ULID_ALPHABET[b & 0x1f];
  }
  return result;
}

export class SessionStore {
  constructor(public baseDir: string = path.join(os.homedir(), '.curie-agent', 'sessions')) {}

  sessionPath(id: string): string {
    return path.join(this.baseDir, id);
  }

  eventsPath(id: string): string {
    return path.join(this.sessionPath(id), 'events.jsonl');
  }

  metadataPath(id: string): string {
    return path.join(this.sessionPath(id), 'metadata.json');
  }

  getFiles(id: string): SessionFile {
    return {
      path: this.sessionPath(id),
      events: this.eventsPath(id),
      metadata: this.metadataPath(id),
    };
  }

  create(cwd: string, model: string, provider: string): SessionInfo {
    const id = ulid();
    const now = Date.now();
    const info: SessionInfo = { id, cwd, model, provider, createdAt: now, updatedAt: now };
    const dir = this.sessionPath(id);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.metadataPath(id), JSON.stringify(info, null, 2) + '\n');
    fs.closeSync(fs.openSync(this.eventsPath(id), 'a'));

    return info;
  }

  load(id: string): SessionInfo | undefined {
    const metaPath = this.metadataPath(id);
    if (!fs.existsSync(metaPath)) return undefined;
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SessionInfo;
  }

  loadEvents(id: string): Event[] {
    const eventsPath = this.eventsPath(id);
    if (!fs.existsSync(eventsPath)) return [];
    const content = fs.readFileSync(eventsPath, 'utf-8').trim();
    if (!content) return [];
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Event);
  }

  appendEvent(id: string, event: Event): void {
    this.appendEvents(id, [event]);
  }

  appendEvents(id: string, events: Event[]): void {
    const eventsPath = this.eventsPath(id);
    const data = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(eventsPath, data, 'utf-8');
    this.touch(id);
  }

  list(): SessionInfo[] {
    if (!fs.existsSync(this.baseDir)) return [];
    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    const sessions: SessionInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const info = this.load(entry.name);
      if (info) sessions.push(info);
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  remove(id: string): void {
    const dir = this.sessionPath(id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private touch(id: string): void {
    const metaPath = this.metadataPath(id);
    if (fs.existsSync(metaPath)) {
      const info = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SessionInfo;
      info.updatedAt = Date.now();
      fs.writeFileSync(metaPath, JSON.stringify(info, null, 2) + '\n');
    }
  }
}

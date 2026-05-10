import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ChannelType = 'cli' | 'telegram';

export interface ChannelEntry {
  id: string;
  type: ChannelType;
  identifier: string;
  displayName: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}

const CONFIG_DIR = join(homedir(), '.curie-agent');
const CHANNELS_FILE = join(CONFIG_DIR, 'channels.json');

export class ChannelRegistry {
  private channels: Map<string, ChannelEntry>;

  constructor() {
    this.channels = new Map();
    this.load();
  }

  private load(): void {
    if (existsSync(CHANNELS_FILE)) {
      try {
        const raw = readFileSync(CHANNELS_FILE, 'utf-8');
        const entries = JSON.parse(raw) as ChannelEntry[];
        for (const entry of entries) {
          this.channels.set(entry.id, entry);
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  private save(): void {
    const entries = Array.from(this.channels.values());
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CHANNELS_FILE, JSON.stringify(entries, null, 2) + '\n');
  }

  getOrCreate(
    type: ChannelType,
    identifier: string,
    sessionId: string,
    displayName?: string,
  ): ChannelEntry {
    const id = type === 'cli' ? 'main' : `telegram:${identifier}`;
    const existing = this.channels.get(id);
    if (existing) {
      existing.sessionId = sessionId;
      existing.updatedAt = Date.now();
      this.save();
      return existing;
    }

    const now = Date.now();
    const entry: ChannelEntry = {
      id,
      type,
      identifier,
      displayName: displayName || (type === 'cli' ? 'Main' : `Chat ${identifier}`),
      sessionId,
      createdAt: now,
      updatedAt: now,
    };
    this.channels.set(id, entry);
    this.save();
    return entry;
  }

  get(channelId: string): ChannelEntry | undefined {
    return this.channels.get(channelId);
  }

  list(): ChannelEntry[] {
    return Array.from(this.channels.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  remove(channelId: string): void {
    this.channels.delete(channelId);
    this.save();
  }

  updateSession(channelId: string, sessionId: string): void {
    const entry = this.channels.get(channelId);
    if (entry) {
      entry.sessionId = sessionId;
      entry.updatedAt = Date.now();
      this.save();
    }
  }

  getSessionId(channelId: string): string | undefined {
    return this.channels.get(channelId)?.sessionId;
  }

  getTelegramChatId(channelId: string): string | undefined {
    const entry = this.channels.get(channelId);
    if (entry?.type === 'telegram') {
      return entry.identifier;
    }
    return undefined;
  }

  findTelegramChannel(chatId: string): ChannelEntry | undefined {
    for (const entry of this.channels.values()) {
      if (entry.type === 'telegram' && entry.identifier === chatId) {
        return entry;
      }
    }
    return undefined;
  }

  touch(channelId: string): void {
    const entry = this.channels.get(channelId);
    if (entry) {
      entry.updatedAt = Date.now();
      this.save();
    }
  }
}

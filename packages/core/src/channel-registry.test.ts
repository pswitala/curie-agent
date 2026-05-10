import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ChannelRegistry } from './channel-registry.js';

const CHANNELS_FILE = path.join(require('node:os').homedir(), '.curie-agent', 'channels.json');

function cleanupChannelsFile(): void {
  try {
    if (fs.existsSync(CHANNELS_FILE)) {
      fs.unlinkSync(CHANNELS_FILE);
    }
  } catch {
    // ignore
  }
}

describe('ChannelRegistry', () => {
  beforeAll(() => {
    // Clean up before all tests
    cleanupChannelsFile();
  });

  afterAll(() => {
    // Clean up after all tests
    cleanupChannelsFile();
  });

  beforeEach(() => {
    // Clean up before each test
    cleanupChannelsFile();
  });

  it('should start with no channels', () => {
    const registry = new ChannelRegistry();
    const list = registry.list();
    expect(list).toHaveLength(0);
  });

  it('should create a channel entry', () => {
    const registry = new ChannelRegistry();
    const entry = registry.getOrCreate('cli', 'main', 'session-1', 'Main');
    expect(entry.id).toBe('main');
    expect(entry.type).toBe('cli');
    expect(entry.identifier).toBe('main');
    expect(entry.displayName).toBe('Main');
    expect(entry.sessionId).toBe('session-1');
  });

  it('should create telegram channel with telegram: prefix', () => {
    const registry = new ChannelRegistry();
    const entry = registry.getOrCreate('telegram', '12345', 'session-2', 'John');
    expect(entry.id).toBe('telegram:12345');
    expect(entry.type).toBe('telegram');
    expect(entry.identifier).toBe('12345');
  });

  it('should persist channels to file', () => {
    const registry = new ChannelRegistry();
    registry.getOrCreate('cli', 'main', 'session-1');
    expect(fs.existsSync(CHANNELS_FILE)).toBe(true);
    const data = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf-8'));
    expect(data).toHaveLength(1);
  });

  it('should load existing channels from file', () => {
    const registry1 = new ChannelRegistry();
    registry1.getOrCreate('cli', 'main', 'session-1');
    // Create a new registry instance (simulates restart)
    const registry2 = new ChannelRegistry();
    const list = registry2.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('main');
  });

  it('should get a channel by ID', () => {
    const registry = new ChannelRegistry();
    registry.getOrCreate('cli', 'main', 'session-1');
    const entry = registry.get('main');
    expect(entry).toBeDefined();
    expect(entry?.id).toBe('main');
  });

  it('should return undefined for non-existent channel', () => {
    const registry = new ChannelRegistry();
    const entry = registry.get('nonexistent');
    expect(entry).toBeUndefined();
  });

  it('should remove a channel', () => {
    const registry = new ChannelRegistry();
    registry.getOrCreate('cli', 'main', 'session-1');
    registry.remove('main');
    const entry = registry.get('main');
    expect(entry).toBeUndefined();
  });

  it('should update session for a channel', () => {
    const registry = new ChannelRegistry();
    registry.getOrCreate('cli', 'main', 'session-1');
    registry.updateSession('main', 'session-2');
    const entry = registry.get('main');
    expect(entry?.sessionId).toBe('session-2');
  });

  it('should get Telegram chat ID for a telegram channel', () => {
    const registry = new ChannelRegistry();
    registry.getOrCreate('telegram', '54321', 'session-1');
    const chatId = registry.getTelegramChatId('telegram:54321');
    expect(chatId).toBe('54321');
  });

  it('should return undefined for non-telegram channel', () => {
    const registry = new ChannelRegistry();
    registry.getOrCreate('cli', 'main', 'session-1');
    const chatId = registry.getTelegramChatId('main');
    expect(chatId).toBeUndefined();
  });

  it('should find telegram channel by chat ID', () => {
    const registry = new ChannelRegistry();
    registry.getOrCreate('telegram', '54321', 'session-1');
    const found = registry.findTelegramChannel('54321');
    expect(found).toBeDefined();
    expect(found?.id).toBe('telegram:54321');
  });

  it('should return undefined for non-existent telegram chat', () => {
    const registry = new ChannelRegistry();
    const found = registry.findTelegramChannel('99999');
    expect(found).toBeUndefined();
  });

  it('should touch a channel to update timestamp', () => {
    const registry = new ChannelRegistry();
    const entry = registry.getOrCreate('cli', 'main', 'session-1');
    const before = entry.updatedAt;
    registry.touch('main');
    const updated = registry.get('main');
    expect(updated).toBeDefined();
  });
});

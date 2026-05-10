import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from './settings.js';

describe('DEFAULT_SETTINGS', () => {
  it('should have correct default model', () => {
    expect(DEFAULT_SETTINGS.model).toBe('claude-sonnet-4-6');
  });

  it('should have correct default effort', () => {
    expect(DEFAULT_SETTINGS.effort).toBe('auto');
  });

  it('should have correct default mode', () => {
    expect(DEFAULT_SETTINGS.mode).toBe('auto');
  });

  it('should have correct default theme', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('nord');
  });

  it('should have statusline enabled by default', () => {
    expect(DEFAULT_SETTINGS.statusline).toBe(true);
  });

  it('should have debug disabled by default', () => {
    expect(DEFAULT_SETTINGS.debug).toBe(false);
  });

  it('should have TELEGRAM_BOT_TOKEN empty by default', () => {
    expect(DEFAULT_SETTINGS.TELEGRAM_BOT_TOKEN).toBe('');
  });

  it('should have TELEGRAM_USER_ID empty by default', () => {
    expect(DEFAULT_SETTINGS.TELEGRAM_USER_ID).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { getOsInfo, withOsContext, withMessageTimestamp, formatDate } from './context.js';

describe('getOsInfo', () => {
  it('should return a non-empty string', () => {
    const info = getOsInfo();
    expect(info).toBeDefined();
    expect(typeof info).toBe('string');
    expect(info.length).toBeGreaterThan(0);
  });

  it('should include the current platform name', () => {
    const info = getOsInfo();
    const { platform } = require('node:os');
    const expectedName = platform() === 'win32' ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux';
    expect(info).toContain(expectedName);
  });

  it('should include architecture info', () => {
    const info = getOsInfo();
    const { arch } = require('node:os');
    expect(info).toContain(arch());
  });

  it('should include hostname', () => {
    const info = getOsInfo();
    const { hostname } = require('node:os');
    expect(info).toContain(hostname());
  });
});

describe('withOsContext', () => {
  it('should prepend OS info to the system prompt', () => {
    const prompt = 'You are a helpful assistant.';
    const result = withOsContext(prompt);

    expect(result).toBeDefined();
    expect(result).toContain('[Operating system:');
    expect(result).toContain(prompt);
  });

  it('should not contain any date/time stamp', () => {
    const result = withOsContext('test') || '';
    expect(result).not.toContain('[Current date and time:');
    expect(result).not.toContain('[Message sent at:');
  });

  it('should return undefined for undefined input', () => {
    expect(withOsContext(undefined)).toBeUndefined();
  });

  it('should place OS info before the original prompt', () => {
    const prompt = 'base system prompt';
    const result = withOsContext(prompt) || '';
    const osIdx = result.indexOf('[Operating system:');
    const promptIdx = result.indexOf('base system prompt');

    expect(osIdx).toBeLessThan(promptIdx);
  });

  it('should include getOsInfo output', () => {
    const osInfo = getOsInfo();
    const result = withOsContext('test') || '';
    expect(result).toContain(osInfo);
  });

  it('should be byte-identical across repeated calls (stable cacheable prefix)', () => {
    const a = withOsContext('same prompt');
    const b = withOsContext('same prompt');
    expect(a).toBe(b);
  });
});

describe('withMessageTimestamp', () => {
  it('should prepend a send-time timestamp to the message text', () => {
    const result = withMessageTimestamp('hello', 1_700_000_000_000);
    expect(result).toContain('[Message sent at:');
    expect(result).toContain('hello');
  });

  it('is a pure function of (text, timestampMs): identical inputs produce identical bytes', () => {
    const a = withMessageTimestamp('same text', 1_700_000_000_000);
    const b = withMessageTimestamp('same text', 1_700_000_000_000);
    expect(a).toBe(b);
  });

  it('produces different output for different timestamps', () => {
    const a = withMessageTimestamp('same text', 1_700_000_000_000);
    const b = withMessageTimestamp('same text', 1_700_000_001_000);
    expect(a).not.toBe(b);
  });

  it('produces different output for different text', () => {
    const a = withMessageTimestamp('text a', 1_700_000_000_000);
    const b = withMessageTimestamp('text b', 1_700_000_000_000);
    expect(a).not.toBe(b);
  });
});

describe('formatDate', () => {
  it('should return a non-empty string', () => {
    const dateStr = formatDate();
    expect(dateStr).toBeDefined();
    expect(typeof dateStr).toBe('string');
    expect(dateStr.length).toBeGreaterThan(0);
  });

  it('should include timezone info', () => {
    const dateStr = formatDate();
    expect(dateStr).toContain('Timezone:');
    expect(dateStr).toContain('Offset:');
  });

  it('should be stable for a fixed Date argument', () => {
    const fixed = new Date(1_700_000_000_000);
    expect(formatDate(fixed)).toBe(formatDate(fixed));
  });
});

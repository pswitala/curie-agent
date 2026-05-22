import { describe, it, expect } from 'vitest';
import { getOsInfo, withDateContext, formatDate } from './context.js';

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

describe('withDateContext', () => {
  it('should prepend date and OS info to the system prompt', () => {
    const prompt = 'You are a helpful assistant.';
    const result = withDateContext(prompt);

    expect(result).toBeDefined();
    expect(result).toContain('[Current date and time:');
    expect(result).toContain('[Operating system:');
    expect(result).toContain(prompt);
  });

  it('should return undefined for undefined input', () => {
    expect(withDateContext(undefined)).toBeUndefined();
  });

  it('should place OS info after date info and before the original prompt', () => {
    const prompt = 'base system prompt';
    const result = withDateContext(prompt) || '';
    const dateIdx = result.indexOf('[Current date and time:');
    const osIdx = result.indexOf('[Operating system:');
    const promptIdx = result.indexOf('base system prompt');

    expect(dateIdx).toBeLessThan(osIdx);
    expect(osIdx).toBeLessThan(promptIdx);
  });

  it('should include getOsInfo output in the OS section', () => {
    const osInfo = getOsInfo();
    const result = withDateContext('test') || '';
    expect(result).toContain(osInfo);
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
});

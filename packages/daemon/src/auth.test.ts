import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateToken, saveToken, loadToken, ensureToken } from './auth.js';

const TOKEN_DIR = join(homedir(), '.curie-agent');
const TOKEN_FILE = join(TOKEN_DIR, 'daemon.token');

describe('auth', () => {
  let originalContent: string | undefined;

  beforeEach(() => {
    if (fs.existsSync(TOKEN_FILE)) {
      originalContent = fs.readFileSync(TOKEN_FILE, 'utf-8');
      fs.unlinkSync(TOKEN_FILE);
    }
  });

  afterEach(() => {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
    if (originalContent !== undefined) {
      fs.writeFileSync(TOKEN_FILE, originalContent, 'utf-8');
    }
  });

  it('generateToken returns a 32-char hex string', () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('saveToken and loadToken round-trip', () => {
    const token = 'abcdef1234567890abcdef1234567890';
    saveToken(token);
    const loaded = loadToken();
    expect(loaded).toBe(token);
  });

  it('loadToken returns undefined when file does not exist', () => {
    const token = loadToken();
    expect(token).toBeUndefined();
  });

  it('ensureToken generates and saves a token when none exists', () => {
    const token = ensureToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const saved = fs.readFileSync(TOKEN_FILE, 'utf-8');
    expect(saved).toBe(token);
  });

  it('ensureToken returns existing token when file exists', () => {
    const existing = '1111111111111111aaaaaaaaaaaaaaaa';
    fs.writeFileSync(TOKEN_FILE, existing, 'utf-8');
    const token = ensureToken();
    expect(token).toBe(existing);
  });
});

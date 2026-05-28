import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateToken, saveToken, loadToken, ensureToken, validateTokenHttp, validateTokenWs } from './auth.js';

const TOKEN_DIR = join(homedir(), '.curie-agent');
const TOKEN_FILE = join(TOKEN_DIR, 'daemon.token');

function makeReq(headers: Record<string, string>, url = '/'): IncomingMessage {
  return { headers, url, method: 'GET' } as unknown as IncomingMessage;
}

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
      originalContent = undefined;
    }
  });

  it('generateToken returns a 32-char hex string', () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('saveToken and loadToken round-trip via daemon.token file', () => {
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

  describe('validateTokenHttp', () => {
    it('accepts valid Bearer token in Authorization header', () => {
      const token = ensureToken();
      expect(validateTokenHttp(makeReq({ authorization: `Bearer ${token}`, host: 'localhost' }))).toBe(true);
    });

    it('accepts valid token in query param', () => {
      const token = ensureToken();
      expect(validateTokenHttp(makeReq({ host: 'localhost' }, `/?token=${token}`))).toBe(true);
    });

    it('accepts valid token in cookie', () => {
      const token = ensureToken();
      expect(validateTokenHttp(makeReq({ cookie: `curie_token=${token}`, host: 'localhost' }))).toBe(true);
    });

    it('rejects wrong token in Authorization header', () => {
      ensureToken();
      expect(validateTokenHttp(makeReq({ authorization: 'Bearer wrongtoken', host: 'localhost' }))).toBe(false);
    });

    it('rejects missing token', () => {
      ensureToken();
      expect(validateTokenHttp(makeReq({ host: 'localhost' }))).toBe(false);
    });

    it('rejects token of different length (timing-safe path)', () => {
      ensureToken();
      expect(validateTokenHttp(makeReq({ authorization: 'Bearer short', host: 'localhost' }))).toBe(false);
    });
  });

  describe('validateTokenWs', () => {
    it('accepts valid token in query param', () => {
      const token = ensureToken();
      const url = new URL(`ws://localhost/ws?token=${token}`);
      expect(validateTokenWs(url)).toBe(true);
    });

    it('rejects wrong token', () => {
      ensureToken();
      const url = new URL('ws://localhost/ws?token=wrongtoken');
      expect(validateTokenWs(url)).toBe(false);
    });

    it('rejects missing token', () => {
      ensureToken();
      const url = new URL('ws://localhost/ws');
      expect(validateTokenWs(url)).toBe(false);
    });
  });
});

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DAEMON_TOKEN_FILE = join(homedir(), '.curie-agent', 'daemon.token');
const SETTINGS_FILE = join(homedir(), '.curie-settings.json');

export function generateToken(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function saveToken(token: string): void {
  mkdirSync(dirname(DAEMON_TOKEN_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(DAEMON_TOKEN_FILE, token, { mode: 0o600 });
  try {
    const raw = existsSync(SETTINGS_FILE) ? readFileSync(SETTINGS_FILE, 'utf-8') : '{}';
    const obj = JSON.parse(raw) as Record<string, unknown>;
    obj.daemon_token = token;
    writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 });
  } catch { /* ignore — settings write is non-fatal */ }
}

export function loadToken(): string | undefined {
  if (process.env.NODE_ENV !== 'test' && existsSync(SETTINGS_FILE)) {
    try {
      const rawSettings = readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(rawSettings);
      const token = parsed.daemon_token;
      if (typeof token === 'string' && token.trim().length > 0) {
        return token.trim();
      }
    } catch {
      // ignore JSON parse errors
    }
  }

  if (existsSync(DAEMON_TOKEN_FILE)) {
    return readFileSync(DAEMON_TOKEN_FILE, 'utf-8').trim();
  }
  return undefined;
}

/** Ensure a token exists, generating one if needed. */
export function ensureToken(): string {
  let token = loadToken();
  if (!token) {
    token = generateToken();
    saveToken(token);
  }
  return token;
}

export function validateTokenWs(url: URL): boolean {
  const token = ensureToken();
  return safeEqual(url.searchParams.get('token') ?? '', token);
}

/** Validate token from either Authorization header, query param, or cookies. */
export function validateTokenHttp(req: IncomingMessage): boolean {
  const auth = req.headers.authorization ?? '';
  const token = ensureToken();
  if (safeEqual(auth, `Bearer ${token}`)) return true;

  // Also accept token from query param (for browser access: ?token=...)
  const url = req.url ?? '';
  const parsed = new URL(url, `http://${req.headers.host ?? 'localhost'}`);
  if (safeEqual(parsed.searchParams.get('token') ?? '', token)) return true;

  // Check Cookie header (e.g. curie_token=<token>)
  const cookieHeader = req.headers.cookie ?? '';
  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const parts = cookie.trim().split('=');
    if (parts.length >= 2) {
      const name = parts[0];
      const val = parts.slice(1).join('=');
      if (name === 'curie_token' && safeEqual(val, token)) {
        return true;
      }
    }
  }

  return false;
}

/** Reject with 401 JSON. */
export function rejectUnauthorized(res: ServerResponse): void {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing token' }));
}

function isLocalhostOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

/** Add CORS headers. Reflects the request origin for localhost origins; falls back to wildcard. */
export function setCorsHeaders(res: ServerResponse, origin?: string): void {
  const allowOrigin = isLocalhostOrigin(origin) ? origin! : '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/** Handle CORS preflight. */
export function handleCorsPreflight(res: ServerResponse, origin?: string): void {
  setCorsHeaders(res, origin);
  res.writeHead(204);
  res.end();
}

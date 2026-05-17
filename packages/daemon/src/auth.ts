import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DAEMON_TOKEN_FILE = join(homedir(), '.curie-agent', 'daemon.token');

export function generateToken(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function saveToken(token: string): void {
  writeFileSync(DAEMON_TOKEN_FILE, token, { mode: 0o600 });
}

export function loadToken(): string | undefined {
  if (!existsSync(DAEMON_TOKEN_FILE)) return undefined;
  return readFileSync(DAEMON_TOKEN_FILE, 'utf-8').trim();
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

export function validateToken(req: IncomingMessage): boolean {
  const auth = req.headers.authorization ?? '';
  const token = ensureToken();
  return auth === `Bearer ${token}`;
}

export function validateTokenWs(url: URL): boolean {
  const token = ensureToken();
  return url.searchParams.get('token') === token;
}

/** Validate token from either Authorization header or query param. */
export function validateTokenHttp(req: IncomingMessage): boolean {
  const auth = req.headers.authorization ?? '';
  const token = ensureToken();
  if (auth === `Bearer ${token}`) return true;
  // Also accept token from query param (for browser access: ?token=...)
  const url = req.url ?? '';
  const parsed = new URL(url, `http://${req.headers.host ?? 'localhost'}`);
  return parsed.searchParams.get('token') === token;
}

/** Reject with 401 JSON. */
export function rejectUnauthorized(res: ServerResponse): void {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing token' }));
}

/** Add CORS headers. */
export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/** Handle CORS preflight. */
export function handleCorsPreflight(res: ServerResponse): void {
  setCorsHeaders(res);
  res.writeHead(204);
  res.end();
}

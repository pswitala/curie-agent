import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.txt': 'text/plain',
};

export function getMimeType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/** Serve a static file. Returns true if served, false if not found. */
export function serveStaticFile(
  res: ServerResponse,
  filePath: string,
  webRoot: string,
): boolean {
  const absPath = resolve(webRoot, filePath);

  // Security: prevent directory traversal
  if (!absPath.startsWith(webRoot)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return true;
  }

  if (!existsSync(absPath)) {
    return false;
  }

  try {
    const stats = statSync(absPath);
    if (!stats.isFile()) {
      return false;
    }

    const content = readFileSync(absPath);
    const mimeType = getMimeType(absPath);

    // Caching headers for assets
    const ext = absPath.slice(absPath.lastIndexOf('.'));
    if (['.js', '.css', '.png', '.jpg', '.svg', '.woff2', '.woff'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }

    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/** Serve the web UI. Falls back to index.html for SPA routing. */
export function serveWebUI(res: ServerResponse, webRoot: string): void {
  if (!existsSync(webRoot)) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Web UI not built. Run pnpm turbo build in packages/web' }));
    return;
  }

  // Try index.html as fallback for any path
  serveStaticFile(res, 'index.html', webRoot);
}

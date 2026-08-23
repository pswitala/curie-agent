import http from 'node:http';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { EventBus, SessionStore, SettingsManager, CurieSettings, ProviderStream, Tool } from '@curie-agent/core';
import { JsonRpcHandler } from './jsonrpc-handler.js';
import { WsHandler } from './ws-handler.js';
import { validateTokenHttp, rejectUnauthorized, setCorsHeaders, handleCorsPreflight, ensureToken } from './auth.js';
import { serveStaticFile, serveWebUI } from './static-files.js';
import { DaemonApp, type McpServerConfig, type SendMessageFn } from './daemon-app.js';
import { VERSION } from './version.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type ProviderFactory = (settings: CurieSettings) => ProviderStream;

export interface DaemonConfig {
  port?: number;
  host?: string;
  sessionStore: SessionStore;
  settingsManager: SettingsManager;
  eventBus: EventBus;
  /** Factory to create a provider from current settings. */
  createProvider?: ProviderFactory;
  /** Tools to use for agent turns. */
  tools?: Tool[];
  /** Telegram bot token (enables Telegram gateway). */
  telegramBotToken?: string;
  /** Allowed Telegram user ID. */
  telegramAllowedUserId?: string;
  /** MCP server configurations. */
  mcpServers?: Record<string, McpServerConfig>;
  /** Optional callback for sending Telegram messages. */
  sendMessage?: SendMessageFn;
  /** System prompt for agent turns (e.g. from ~/.curie-agent/AGENTS.md). */
  systemPrompt?: string;
  /** Host to bind to (default 127.0.0.1). */
  web_ip?: string;
}

export class DaemonServer {
  private server: http.Server | null = null;
  private jsonRpc: JsonRpcHandler;
  private wsHandler: WsHandler;
  private webRoot: string;
  public app: DaemonApp;
  private systemPrompt: string | undefined;
  private webIp: string;

  constructor(private config: DaemonConfig) {
    this.systemPrompt = config.systemPrompt;
    this.webIp = config.web_ip ?? '';
    this.app = new DaemonApp(
      config.eventBus,
      config.sessionStore,
      config.settingsManager,
      config.createProvider,
      config.tools ?? [],
      config.mcpServers,
      config.sendMessage,
      this.systemPrompt,
    );

    this.jsonRpc = new JsonRpcHandler(
      config.sessionStore,
      config.settingsManager,
      config.eventBus,
      config.createProvider,
      config.tools ?? [],
      this.app,
      this.systemPrompt,
    );
    this.wsHandler = new WsHandler(config.eventBus);

    // Web root: check dev path first, then prod path
    const devWeb = join(__dirname, '..', '..', '..', 'web', 'dist');
    const prodWeb = join(__dirname, '..', '..', 'web', 'dist');
    this.webRoot = existsSync(devWeb) ? devWeb : prodWeb;
  }

  async start(): Promise<{ url: string; port: number }> {
    const port = this.config.port ?? 3457;
    const host = this.webIp || this.config.host || process.env.HOST || '127.0.0.1';

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Setup WebSocket
      this.wsHandler.setup(this.server);

      this.server.listen(port, host, async () => {
        const url = `http://${host}:${port}`;
        console.log(`[daemon] Listening on ${url}`);
        // Start daemon app subsystems (Telegram, cron checker)
        await this.app.start();
        resolve({ url, port });
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use. Stop the existing daemon first: curie-agent daemon stop`));
        } else {
          reject(err);
        }
      });
    });
  }

  async stop(): Promise<void> {
    await this.app.stop();
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  getPort(): number | undefined {
    const addr = this.server?.address();
    if (!addr || typeof addr === 'string') return undefined;
    return addr.port;
  }

  /** Get the current number of WebSocket clients. */
  getClientCount(): number {
    return this.wsHandler.getClientCount();
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const reqOrigin = req.headers.origin;
    console.log(`[http] ${req.method} ${req.url} host=${req.headers.host} origin=${reqOrigin ?? '(none)'}`);
    // CORS on every response
    setCorsHeaders(res, reqOrigin);

    // Handle preflight
    if (req.method === 'OPTIONS') {
      handleCorsPreflight(res, reqOrigin);
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // Serve sw.js with no-cache so the browser can detect service worker updates
    if (url.pathname === '/sw.js') {
      const swPath = join(this.webRoot, 'sw.js');
      if (existsSync(swPath)) {
        const content = readFileSync(swPath);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Service-Worker-Allowed', '/');
        res.writeHead(200);
        res.end(content);
        return;
      }
    }

    // Auth check (skip for /ws, handled by ws handler)
    if (url.pathname === '/ws') {
      // WS upgrade is handled by ws.Server
      return;
    }

    // Validate token for all non-public requests (allow frontend static assets to load)
    const isPublicAsset =
      url.pathname === '/' ||
      url.pathname === '/index.html' ||
      url.pathname === '/manifest.json' ||
      url.pathname === '/sw.js' ||
      url.pathname.startsWith('/icons/') ||
      url.pathname.startsWith('/assets/');

    if (!isPublicAsset && !validateTokenHttp(req)) {
      console.log(`[http] auth FAILED path=${url.pathname}`);
      rejectUnauthorized(res);
      return;
    }

    // Set cookie if successfully authenticated via query param token to allow sub-resource loads
    const token = ensureToken();
    if (url.searchParams.get('token') === token) {
      res.setHeader('Set-Cookie', `curie_token=${token}; Path=/; HttpOnly; SameSite=Strict`);
    }

    // Health check (auth required)
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        version: VERSION,
        clients: this.getClientCount(),
      }));
      return;
    }

    // JSON-RPC endpoint (auth required)
    if (url.pathname === '/api/json-rpc') {
      console.log(`[http] json-rpc path=${url.pathname} auth=${!!req.headers.authorization} token_query=${!!url.searchParams.get('token')}`);
      this.handleJsonRpc(req, res);
      return;
    }

    // Static file serving (web UI)
    // Strip leading slash for file path
    const filePath = url.pathname.slice(1) || 'index.html';
    if (serveStaticFile(res, filePath, this.webRoot)) {
      return;
    }

    // Fallback to index.html for SPA
    serveWebUI(res, this.webRoot);
  }

  private handleJsonRpc(req: http.IncomingMessage, res: http.ServerResponse): void {
    console.log(`[http] handleJsonRpc method=${req.method} url=${req.url}`);
    if (req.method === 'GET') {
      // Parse query params as JSON body
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const body = url.searchParams.get('body');
      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Missing body' } }));
        return;
      }
      this.processJsonRpc(JSON.parse(body), res);
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          this.processJsonRpc(parsed, res);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        }
      });
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Method not allowed' } }));
  }

  private processJsonRpc(parsed: unknown, res: http.ServerResponse): void {
    const request = parsed as { jsonrpc: '2.0'; id: string | number; method: string; params?: Record<string, unknown> };
    console.log(`[http] incoming method=${request?.method ?? 'INVALID'} body=${JSON.stringify(parsed).slice(0, 200)}`);
    if (!request || request.jsonrpc !== '2.0') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }));
      return;
    }

    this.jsonRpc.handle(request).then((result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }).catch((err: unknown) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: err instanceof Error ? err.message : 'Unknown error' },
      }));
    });
  }
}

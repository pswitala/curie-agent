import type { EventBus, SessionStore, SettingsManager } from '@curie-agent/core';
import { DaemonServer, type DaemonConfig } from './server.js';
import { generateToken, loadToken, saveToken, ensureToken } from './auth.js';

export { DaemonServer } from './server.js';
export type { DaemonConfig, ProviderFactory } from './server.js';
export { generateToken, loadToken, saveToken, ensureToken } from './auth.js';
export { JsonRpcHandler } from './jsonrpc-handler.js';
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcError } from './jsonrpc-handler.js';
export { WsHandler } from './ws-handler.js';
export type { WsClientInfo } from './ws-handler.js';
export { DaemonApp } from './daemon-app.js';
export type { McpServerConfig, McpConnectionStatus, SendMessageFn } from './daemon-app.js';
export { ApprovalTracker } from './approval-tracker.js';
export { ChannelManager } from './channel-manager.js';

// Singleton instance
let instance: DaemonServer | null = null;

/** Get or create a daemon server instance. */
export function getOrCreateDaemonServer(config: DaemonConfig): DaemonServer {
  if (!instance) {
    instance = new DaemonServer(config);
  }
  return instance;
}

/** Get the current daemon instance or null. */
export function getDaemonInstance(): DaemonServer | null {
  return instance;
}

/** Reset the singleton (for testing). */
export function resetDaemonInstance(): void {
  instance = null;
}

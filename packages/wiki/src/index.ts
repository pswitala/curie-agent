export { WikiManager } from './wiki-manager.js';
export type { PageRecord, SearchHit, LintReport } from './wiki-manager.js';

export { resolveWikiPath, ensureWikiStructure } from './paths.js';
export type { WikiSettings } from './paths.js';

export { readIndex, upsertIndexEntry, parseIndex, formatIndex } from './wiki-index.js';
export type { IndexEntry } from './wiki-index.js';

export { appendLog, readLog } from './log.js';
export type { LogPrefix } from './log.js';

export { buildGraph } from './graph.js';
export type { WikiGraph, GraphNode, GraphEdge } from './graph.js';

export { initWiki } from './init.js';

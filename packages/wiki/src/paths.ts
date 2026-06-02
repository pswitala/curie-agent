import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

export interface WikiSettings {
  wiki?: {
    path?: string;
    autoLint?: 'on' | 'off';
  };
}

export function resolveWikiPath(settings?: WikiSettings): string {
  const configured = settings?.wiki?.path?.trim();
  if (configured) return configured;
  return join(homedir(), '.curie-agent', 'wiki');
}

const INDEX_SEED = `# Wiki Index

<!-- Updated automatically by curie-agent wiki engine. Parse: grep "^## " index.md -->

`;

const LOG_SEED = `# Wiki Log

<!-- Append-only chronological record. Parse with: grep "^## \\[" log.md | tail -5 -->

`;

export function ensureWikiStructure(root: string): void {
  const dirs = [
    root,
    join(root, 'raw'),
    join(root, 'raw', 'assets'),
    join(root, 'pages'),
    join(root, 'pages', 'entities'),
    join(root, 'pages', 'concepts'),
    join(root, 'pages', 'summaries'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const indexPath = join(root, 'index.md');
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, INDEX_SEED, 'utf-8');
  }

  const logPath = join(root, 'log.md');
  if (!existsSync(logPath)) {
    writeFileSync(logPath, LOG_SEED, 'utf-8');
  }
}

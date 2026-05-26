import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCurieDir, copyTemplateFile, copyInitSkills, resolveTemplatesDir } from './template-utils.js';

export type ProviderName = 'anthropic' | 'openai' | 'local' | 'openrouter' | 'ollama';

export interface InitData {
  provider: ProviderName | null;
  apiKey: string | null;
  model: string | null;
  soul: { name: string; vibe: string };
  user: { name: string; timezone: string; languages: string };
  agentsAccepted: boolean;
}

function CurieDir(): string {
  return path.join(os.homedir(), '.curie-agent');
}

function writeCurieFile(name: string, content: string): void {
  const dir = CurieDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

/** Template files that should be copied from disk with interpolation. */
const TEMPLATE_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'TOOLS.md', 'HEARTBEAT.md'];

/**
 * Create identity files by copying bundled templates from disk and interpolating
 * user-specific placeholders ({{SOUL_NAME}}, {{USER_NAME}}, etc.).
 */
export function createIdentityFilesFromTemplates(data: InitData, templatesDir: string): void {
  const targetDir = getCurieDir();
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0] ?? '';

  const templateData = {
    SOUL_NAME: data.soul.name || 'Curie',
    SOUL_VIBE: data.soul.vibe || 'AI coding assistant — sharp, resourceful, gets things done',
    USER_NAME: data.user.name || '(Your name)',
    USER_TIMEZONE: data.user.timezone || '(UTC)',
    USER_LANGUAGES: data.user.languages || 'TypeScript, Python',
    TIMESTAMP: dateStr,
  };

  for (const file of TEMPLATE_FILES) {
    copyTemplateFile(templatesDir, file, targetDir, templateData);
  }

  // tasks.json — always create fresh
  writeCurieFile('tasks.json', JSON.stringify({
    $schema: 'tasks.schema.json',
    version: 1,
    tasks: [],
  }, null, 2));
}

/**
 * Full init: create identity files from templates + copy bundled skills.
 * Throws if templates directory cannot be resolved.
 */
export function createIdentityFilesAuto(data: InitData): void {
  const templatesDir = resolveTemplatesDir();
  if (!templatesDir) {
    throw new Error('Failed to resolve templates directory. Identity files cannot be created without bundled templates.');
  }
  createIdentityFilesFromTemplates(data, templatesDir);
  copyInitSkills(templatesDir);
}

/** @deprecated Use createIdentityFilesAuto() instead. */
export function createIdentityFiles(data: InitData): void {
  createIdentityFilesAuto(data);
}

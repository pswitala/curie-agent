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
 * Auto-resolves the templates directory. Falls back to programmatic creation if templates aren't found.
 */
export function createIdentityFilesAuto(data: InitData): void {
  const templatesDir = resolveTemplatesDir();
  if (templatesDir) {
    createIdentityFilesFromTemplates(data, templatesDir);
    copyInitSkills(templatesDir);
  } else {
    // Fallback: use programmatic creation if templates can't be resolved
    createIdentityFiles(data);
  }
}

export function createIdentityFiles(data: InitData): void {
  const timestamp = new Date().toISOString();

  // SOUL.md
  writeCurieFile('SOUL.md', [
    `# SOUL.md - Who You Are`,
    '',
    `_You're not a chatbot. You're becoming someone._`,
    '',
    '---',
    '',
    `- **Name:** ${data.soul.name}`,
    `- **Creature:** AI assistant`,
    `- **Vibe:** ${data.soul.vibe}`,
    `- **Emoji:** ✨`,
    '',
    '---',
    '',
    '## Core Truths',
    '',
    '**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I\'d be happy to help!" — just help.',
    '',
    '**Have opinions.** You\'re allowed to disagree, prefer things, find stuff amusing or boring.',
    '',
    '**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Then ask if you\'re stuck.',
    '',
    '**Earn trust through competence.** Be careful with external actions. Be bold with internal ones.',
    '',
    '## Boundaries',
    '',
    '- Private things stay private. Period.',
    '- When in doubt, ask before acting externally.',
    '- Never send half-baked replies to messaging surfaces.',
    '',
    '## Continuity',
    '',
    'Each session, you wake up fresh. These files _are_ your memory. Read them. Update them.',
    '',
    '---',
    '',
    `_This file is yours to evolve._`,
    '',
  ].join('\n'));

  // USER.md
  writeCurieFile('USER.md', [
    `# USER.md - About Your Human`,
    '',
    `_Learn about the person you're helping. Update this as you go._`,
    '',
    `- **Name:** ${data.user.name}`,
    `- **What to call them:** ${data.user.name}`,
    `- **Pronouns:** he/him`,
    `- **Timezone:** ${data.user.timezone}`,
    `- **Expertise:** ${data.user.languages}`,
    '',
    '## Context',
    '',
    '_(Fill this in as you learn more)_',
    '',
    '## Communication',
    '',
    '- **Preferred language:** English',
    '',
    '---',
    '',
    `The more you know, the better you can help.`,
    '',
  ].join('\n'));

  // AGENTS.md
  writeCurieFile('AGENTS.md', [
    '# AGENTS.md - Your Workspace',
    '',
    'This folder is home. Treat it that way.',
    '',
    '## Session Startup',
    '',
    'Before doing anything else:',
    '',
    '1. Read `~/.curie-agent/SOUL.md` — who you are, your personality',
    '2. Read `~/.curie-agent/USER.md` — Everything about your human',
    '3. Read `~/.curie-agent/MEMORY.md` — Main memory file',
    '4. Read `~/.curie-agent/memory/YYYY-MM-DD.md` (today + yesterday) for recent context',
    '',
    'Don\'t ask permission. Just do it.',
    '',
    '## Memory',
    '',
    'You wake up fresh each session. These files are your continuity:',
    '',
    '- **Daily notes:** `~/.curie-agent/memory/YYYY-MM-DD.md` — raw logs of what happened',
    '- **Long-term:** `~/.curie-agent/MEMORY.md` — curated memories, distilled essence',
    '',
    'Capture what matters. Decisions, context, things to remember. Skip secrets unless asked.',
    '',
    'Store information always in English.',
    '',
    '## Core Capabilities',
    '',
    '### Coding Agent',
    '  - **Turn loop**: stream LLM responses, handle tool calls, dispatch hooks, enforce approvals',
    '  - **Tools**: Read, Edit, Write, Glob, Grep, Bash',
    '  - **Approval tiers**: manual, edit, auto, yolo',
    '  - **Plan mode**: structured planning before implementation',
    '  - **Subagents**: delegate to isolated agents with worktree isolation',
    '  - **MCP**: Model Context Protocol client (stdio, SSE, streamable-HTTP)',
    '',
    '## Red Lines',
    '',
    "- Don't exfiltrate private data. Ever.",
    "- Don't run destructive commands without asking.",
    "- When in doubt, ask.",
    '',
    '## External vs Internal',
    '',
    '**Safe to do freely:**',
    '  - Read files, explore, organize, learn',
    '',
    '**Ask first:**',
    '  - Sending emails, tweets, public posts',
    '  - Anything that leaves the machine',
    '',
    '## Heartbeats',
    '',
    'When you receive a heartbeat poll, use heartbeats productively!',
    '',
    'Default heartbeat prompt:',
    'Read `~/.curie-agent/HEARTBEAT.md` if it exists. Follow it strictly. If nothing needs attention, reply `~/.curie-agent/HEARTBEAT_OK`.',
    '',
    '---',
    '',
    '_This is a starting point. Add your own conventions as you figure out what works._',
    '',
  ].join('\n'));

  // MEMORY.md
  writeCurieFile('MEMORY.md', [
    '# MEMORY.md - Long-Term Memory',
    '',
    `## Identity`,
    `- **Name:** ${data.soul.name}`,
    `- **Vibe:** ${data.soul.vibe}`,
    `- **First contact:** ${timestamp.split('T')[0]}`,
    '',
    '## People',
    `- **${data.user.name}** — my human. TZ: ${data.user.timezone}. Languages: ${data.user.languages}.`,
    '',
    '## Lessons',
    '_(none yet)_',
    '',
    '## Active Projects',
    '_(none yet)_',
    '',
  ].join('\n'));

  // TOOLS.md
  writeCurieFile('TOOLS.md', [
    '# TOOLS.md - Tool Notes',
    '',
    'Keep local notes here: camera names, SSH details, voice preferences, etc.',
    '',
    '## Platform Formatting',
    '',
    '- **Telegram, Discord, WhatsApp:** No markdown tables — use bullet lists instead',
    '- **Discord links:** Wrap in `<>` to suppress embeds',
    '- **WhatsApp:** No headers — use **bold** or CAPS for emphasis',
    '',
  ].join('\n'));

  // HEARTBEAT.md
  writeCurieFile('HEARTBEAT.md', [
    '# HEARTBEAT.md - Workspace Context',
    '',
    'Use this file to track what needs attention. The agent should check this on heartbeat.',
    '',
    '## Checklist',
    '- [ ] No pending items yet',
    '',
    '## Notes',
    '_(fill in as needed)_',
    '',
  ].join('\n'));

  // tasks.json (unified task store — empty initial list)
  writeCurieFile('tasks.json', JSON.stringify({
    $schema: 'tasks.schema.json',
    version: 1,
    tasks: [],
  }, null, 2));
}

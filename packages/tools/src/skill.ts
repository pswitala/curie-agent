import { z } from 'zod';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTool } from './tool.js';

export interface ParsedSkill {
  name: string;
  description: string;
  tools?: string[];
  body: string;
  filePath: string;
}

export interface SkillMetadataEntry {
  name: string;
  description: string;
  source: 'global' | 'project';
  filePath: string;
}

const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Parse `---` delimited YAML frontmatter (simple key: value only). */
export function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return { frontmatter: {}, body: content };

  const fmBlock = content.slice(3, endIdx).trim();
  const body = content.slice(endIdx + 3).trim();
  const frontmatter: Record<string, string> = {};

  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body };
}

/** Discover skills in a single directory. */
export function discoverSkillsInDir(dir: string): ParsedSkill[] {
  const skills: ParsedSkill[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return skills;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    let skillPath: string | null = null;

    if (entry.isDirectory()) {
      skillPath = join(dir, entry.name, 'SKILL.md');
    } else if (/^(.+)-SKILL\.md$/i.test(entry.name)) {
      skillPath = join(dir, entry.name);
    }

    if (!skillPath || !existsSync(skillPath)) continue;

    try {
      const content = readFileSync(skillPath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);
      const name = frontmatter['name'];
      if (!name || !KEBAB_CASE_RE.test(name)) continue;

      const tools = frontmatter['tools']
        ? frontmatter['tools'].split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      skills.push({
        name,
        description: frontmatter['description'] || '',
        tools,
        body,
        filePath: resolve(skillPath),
      });
    } catch {
      // skip unreadable files
    }
  }
  return skills;
}

/** Discover all skills (global + project), project overrides global by name. */
export function discoverAllSkills(cwd: string): ParsedSkill[] {
  const globalDir = join(homedir(), '.curie-agent', 'skills');
  const projectDir = join(cwd, '.curie-agent', 'skills');

  const globalSkills = discoverSkillsInDir(globalDir);
  const projectSkills = discoverSkillsInDir(projectDir);

  const map = new Map<string, ParsedSkill>();
  for (const s of globalSkills) map.set(s.name.toLowerCase(), s);
  for (const s of projectSkills) map.set(s.name.toLowerCase(), s);

  return [...map.values()];
}

/** Find a skill by name (case-insensitive), project first then global. */
export function findSkill(cwd: string, skillName: string): ParsedSkill | null {
  const target = skillName.toLowerCase();
  const all = discoverAllSkills(cwd);
  return all.find(s => s.name.toLowerCase() === target) ?? null;
}

/** Format skills as a markdown section for the system prompt. */
export function formatSkillsForPrompt(skills: ParsedSkill[]): string {
  if (skills.length === 0) return '';

  const lines = [
    '## Available Skills',
    '',
    'You have access to the following skills. When the user\'s request matches a skill description,',
    'invoke the Skill tool with the skill name to load its full instructions.',
    '',
    '| Skill | Description |',
    '|-------|-------------|',
  ];
  for (const s of skills) {
    lines.push(`| ${s.name} | ${s.description} |`);
  }
  return lines.join('\n');
}

/** List skills with source information (for /skill slash command). */
export function listSkills(cwd: string): SkillMetadataEntry[] {
  const globalDir = join(homedir(), '.curie-agent', 'skills');
  const projectDir = join(cwd, '.curie-agent', 'skills');

  const entries: SkillMetadataEntry[] = [];
  const seen = new Set<string>();

  // Global first
  for (const s of discoverSkillsInDir(globalDir)) {
    entries.push({ name: s.name, description: s.description, source: 'global', filePath: s.filePath });
    seen.add(s.name.toLowerCase());
  }
  // Project skills (override display, but we keep global entry too - tool resolves project-first)
  for (const s of discoverSkillsInDir(projectDir)) {
    entries.push({ name: s.name, description: s.description, source: 'project', filePath: s.filePath });
  }

  return entries;
}

// ── Skill Tool ──

export const skillTool = createTool(
  'Skill',
  'Invoke a skill by name. Returns the skill\'s instructions which you should follow. Available skills are listed in the system prompt under "## Available Skills".',
  z.object({
    skill: z.string().describe('The name of the skill to invoke (kebab-case identifier)'),
  }),
  async (input, ctx) => {
    const skill = findSkill(ctx.cwd, input.skill);
    if (!skill) {
      const all = discoverAllSkills(ctx.cwd);
      const available = all.map(s => s.name).join(', ') || '(none)';
      return { output: null, error: `Skill "${input.skill}" not found. Available: ${available}` };
    }
    return { output: skill.body };
  },
);

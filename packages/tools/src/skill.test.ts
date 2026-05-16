import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseFrontmatter,
  discoverSkillsInDir,
  discoverAllSkills,
  findSkill,
  formatSkillsForPrompt,
  listSkills,
  skillTool,
} from './skill.js';

let testDir: string;
let globalDir: string;
let projectDir: string;

function createSkill(dir: string, name: string, body: string, isFlat = false) {
  if (isFlat) {
    writeFileSync(join(dir, `${name}-SKILL.md`), body);
  } else {
    const skillDir = join(dir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), body);
  }
}

function skillContent(name: string, desc: string, tools = '', bodyText = '# Test Skill\n\nDo something.') {
  let fm = `---\nname: ${name}\ndescription: ${desc}`;
  if (tools) fm += `\ntools: ${tools}`;
  fm += '\n---\n\n';
  return fm + bodyText;
}

beforeEach(() => {
  testDir = join(tmpdir(), `skill-test-${Date.now()}-${Math.random()}`);
  globalDir = join(testDir, 'global-skills');
  projectDir = join(testDir, 'project-skills');
  mkdirSync(globalDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* noop */ }
});

// ── parseFrontmatter ──

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const content = '---\nname: my-skill\ndescription: A test skill\n---\n\n# Body\n\nInstructions here.';
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter).toEqual({ name: 'my-skill', description: 'A test skill' });
    expect(body).toContain('# Body');
    expect(body).toContain('Instructions here.');
  });

  it('returns empty frontmatter when no delimiters', () => {
    const content = 'name: test\n\n# Body';
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it('handles extra whitespace around keys and values', () => {
    const content = '---\n  name : my-skill  \n  description : test  \n---\n\nbody';
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter['name']).toBe('my-skill');
    expect(frontmatter['description']).toBe('test');
  });

  it('handles empty file', () => {
    const { frontmatter, body } = parseFrontmatter('');
    expect(frontmatter).toEqual({});
    expect(body).toBe('');
  });

  it('handles only frontmatter no body', () => {
    const content = '---\nname: only-fm\n---';
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter['name']).toBe('only-fm');
    expect(body).toBe('');
  });

  it('skips lines without colons in frontmatter', () => {
    const content = '---\nname: test\nno-colon-here\n---\n\nbody';
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter).toEqual({ name: 'test' });
  });
});

// ── discoverSkillsInDir ──

describe('discoverSkillsInDir', () => {
  it('finds directory-based skills', () => {
    createSkill(globalDir, 'test-skill', skillContent('test-skill', 'A test'));
    const skills = discoverSkillsInDir(globalDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('test-skill');
    expect(skills[0].description).toBe('A test');
  });

  it('finds flat-file skills', () => {
    createSkill(globalDir, 'flat-skill', skillContent('flat-skill', 'Flat skill'), true);
    const skills = discoverSkillsInDir(globalDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('flat-skill');
  });

  it('skips directories without SKILL.md', () => {
    mkdirSync(join(globalDir, 'no-skill-dir'), { recursive: true });
    const skills = discoverSkillsInDir(globalDir);
    expect(skills).toHaveLength(0);
  });

  it('skips files not matching -SKILL.md pattern', () => {
    writeFileSync(join(globalDir, 'random.md'), 'content');
    const skills = discoverSkillsInDir(globalDir);
    expect(skills).toHaveLength(0);
  });

  it('returns empty array for non-existent directory', () => {
    const skills = discoverSkillsInDir(join(testDir, 'nope'));
    expect(skills).toEqual([]);
  });

  it('skips skills with invalid name', () => {
    createSkill(globalDir, 'Invalid Name', skillContent('Invalid Name', 'bad name'));
    const skills = discoverSkillsInDir(globalDir);
    expect(skills).toHaveLength(0);
  });

  it('parses tools field', () => {
    createSkill(globalDir, 'tool-skill', skillContent('tool-skill', 'has tools', 'Read, Bash'));
    const skills = discoverSkillsInDir(globalDir);
    expect(skills[0].tools).toEqual(['Read', 'Bash']);
  });
});

// ── discoverAllSkills ──

describe('discoverAllSkills', () => {
  // We can't easily test ~/.curie-agent/skills in tests, so we test
  // the merge logic indirectly via findSkill which calls discoverAllSkills.
  // For this test we only verify that project skills are discovered.

  it('finds project skills', () => {
    // We need to test with actual cwd so that project dir resolves.
    // Create a temp project root with .curie-agent/skills/.
    const projectRoot = join(testDir, 'my-project');
    const pSkillsDir = join(projectRoot, '.curie-agent', 'skills');
    mkdirSync(pSkillsDir, { recursive: true });
    createSkill(pSkillsDir, 'proj-skill', skillContent('proj-skill', 'Project skill'));

    const skills = discoverAllSkills(projectRoot);
    // May include global skills too if ~/.curie-agent/skills exists
    const proj = skills.find(s => s.name === 'proj-skill');
    expect(proj).toBeDefined();
    expect(proj!.description).toBe('Project skill');
  });
});

// ── findSkill ──

describe('findSkill', () => {
  it('finds skill by name', () => {
    const projectRoot = join(testDir, 'find-proj');
    const pSkillsDir = join(projectRoot, '.curie-agent', 'skills');
    mkdirSync(pSkillsDir, { recursive: true });
    createSkill(pSkillsDir, 'my-skill', skillContent('my-skill', 'Found me'));

    const skill = findSkill(projectRoot, 'my-skill');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('my-skill');
    expect(skill!.body).toContain('Do something.');
  });

  it('returns null for unknown skill', () => {
    const skill = findSkill(testDir, 'nonexistent');
    expect(skill).toBeNull();
  });

  it('is case-insensitive', () => {
    const projectRoot = join(testDir, 'case-proj');
    const pSkillsDir = join(projectRoot, '.curie-agent', 'skills');
    mkdirSync(pSkillsDir, { recursive: true });
    createSkill(pSkillsDir, 'case-skill', skillContent('case-skill', 'case test'));

    const skill = findSkill(projectRoot, 'CASE-SKILL');
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('case-skill');
  });
});

// ── formatSkillsForPrompt ──

describe('formatSkillsForPrompt', () => {
  it('returns empty string for no skills', () => {
    expect(formatSkillsForPrompt([])).toBe('');
  });

  it('formats a single skill', () => {
    const skills = [{
      name: 'my-skill',
      description: 'Does something useful',
      body: '',
      filePath: '/tmp/skill',
    }];
    const result = formatSkillsForPrompt(skills);
    expect(result).toContain('## Available Skills');
    expect(result).toContain('| my-skill | Does something useful |');
  });

  it('formats multiple skills', () => {
    const skills = [
      { name: 'skill-a', description: 'First', body: '', filePath: '' },
      { name: 'skill-b', description: 'Second', body: '', filePath: '' },
    ];
    const result = formatSkillsForPrompt(skills);
    expect(result).toContain('skill-a');
    expect(result).toContain('skill-b');
  });
});

// ── listSkills ──

describe('listSkills', () => {
  it('returns project skills with source', () => {
    const projectRoot = join(testDir, 'list-proj');
    const pSkillsDir = join(projectRoot, '.curie-agent', 'skills');
    mkdirSync(pSkillsDir, { recursive: true });
    createSkill(pSkillsDir, 'list-skill', skillContent('list-skill', 'Listable'));

    const result = listSkills(projectRoot);
    const entry = result.find(s => s.name === 'list-skill');
    expect(entry).toBeDefined();
    expect(entry!.source).toBe('project');
  });
});

// ── skillTool ──

describe('skillTool', () => {
  it('has correct definition', () => {
    expect(skillTool.definition.name).toBe('Skill');
    expect(skillTool.definition.description).toContain('skill');
  });

  it('returns body for valid skill', async () => {
    const projectRoot = join(testDir, 'tool-proj');
    const pSkillsDir = join(projectRoot, '.curie-agent', 'skills');
    mkdirSync(pSkillsDir, { recursive: true });
    createSkill(pSkillsDir, 'tool-skill', skillContent('tool-skill', 'Tool skill', '', '# Instructions\n\nStep 1: Do thing'));

    const result = await skillTool.execute({ skill: 'tool-skill' }, {} as any, projectRoot);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('# Instructions');
  });

  it('returns error for invalid skill', async () => {
    const result = await skillTool.execute({ skill: 'nope' }, {} as any, testDir);
    expect(result.error).toContain('not found');
  });
});

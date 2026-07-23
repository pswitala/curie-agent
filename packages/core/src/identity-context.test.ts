import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { buildBaseSystemPrompt } from './identity-context.js';

describe('buildBaseSystemPrompt', () => {
  let curieDir: string;

  beforeEach(() => {
    curieDir = mkdtempSync(join(tmpdir(), 'curie-identity-test-'));
  });

  afterEach(() => {
    rmSync(curieDir, { recursive: true, force: true });
  });

  it('inlines all listed files that exist, in order', () => {
    writeFileSync(join(curieDir, 'AGENTS.md'), 'AGENTS CONTENT');
    writeFileSync(join(curieDir, 'SOUL.md'), 'SOUL CONTENT');
    writeFileSync(join(curieDir, 'USER.md'), 'USER CONTENT');

    const result = buildBaseSystemPrompt({
      curieDir,
      files: ['AGENTS.md', 'SOUL.md', 'USER.md'],
      skillsSection: '',
    });

    expect(result).toBeDefined();
    const agentsIdx = result!.indexOf('AGENTS CONTENT');
    const soulIdx = result!.indexOf('=== SOUL.md ===\nSOUL CONTENT');
    const userIdx = result!.indexOf('=== USER.md ===\nUSER CONTENT');
    expect(agentsIdx).toBeGreaterThanOrEqual(0);
    expect(soulIdx).toBeGreaterThan(agentsIdx);
    expect(userIdx).toBeGreaterThan(soulIdx);
  });

  it('leaves AGENTS.md un-delimited when it leads the list', () => {
    writeFileSync(join(curieDir, 'AGENTS.md'), 'AGENTS CONTENT');

    const result = buildBaseSystemPrompt({ curieDir, files: ['AGENTS.md'], skillsSection: '' });

    expect(result).toBe('AGENTS CONTENT');
    expect(result).not.toContain('=== AGENTS.md ===');
  });

  it('skips missing files without error', () => {
    writeFileSync(join(curieDir, 'AGENTS.md'), 'AGENTS CONTENT');
    // SOUL.md, USER.md, MEMORY.md intentionally absent

    const result = buildBaseSystemPrompt({
      curieDir,
      files: ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md'],
      skillsSection: '',
    });

    expect(result).toBe('AGENTS CONTENT');
  });

  it('supports custom/extra files beyond the default set', () => {
    writeFileSync(join(curieDir, 'AGENTS.md'), 'AGENTS CONTENT');
    writeFileSync(join(curieDir, 'TOOLS.md'), 'TOOLS CONTENT');

    const result = buildBaseSystemPrompt({
      curieDir,
      files: ['AGENTS.md', 'TOOLS.md'],
      skillsSection: '',
    });

    expect(result).toContain('=== TOOLS.md ===\nTOOLS CONTENT');
  });

  it('appends the skills section last', () => {
    writeFileSync(join(curieDir, 'AGENTS.md'), 'AGENTS CONTENT');

    const result = buildBaseSystemPrompt({
      curieDir,
      files: ['AGENTS.md'],
      skillsSection: '## Available Skills\n\n| Skill | Description |',
    });

    const agentsIdx = result!.indexOf('AGENTS CONTENT');
    const skillsIdx = result!.indexOf('## Available Skills');
    expect(skillsIdx).toBeGreaterThan(agentsIdx);
  });

  it('rejects a path-escaping entry (e.g. ../secret.txt)', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'curie-identity-outside-'));
    try {
      writeFileSync(join(outsideDir, 'secret.txt'), 'SECRET');
      const relEscape = relative(curieDir, join(outsideDir, 'secret.txt'));

      const result = buildBaseSystemPrompt({
        curieDir,
        files: [relEscape],
        skillsSection: '',
      });

      expect(result).toBeUndefined();
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('produces byte-identical output for identical inputs (cache stability)', () => {
    writeFileSync(join(curieDir, 'AGENTS.md'), 'AGENTS CONTENT');
    writeFileSync(join(curieDir, 'SOUL.md'), 'SOUL CONTENT');

    const a = buildBaseSystemPrompt({ curieDir, files: ['AGENTS.md', 'SOUL.md'], skillsSection: 'skills' });
    const b = buildBaseSystemPrompt({ curieDir, files: ['AGENTS.md', 'SOUL.md'], skillsSection: 'skills' });

    expect(a).toBe(b);
  });

  it('returns undefined when the list is empty and there is no skills section', () => {
    const result = buildBaseSystemPrompt({ curieDir, files: [], skillsSection: '' });
    expect(result).toBeUndefined();
  });

  it('returns just the skills section when no identity files resolve', () => {
    const result = buildBaseSystemPrompt({ curieDir, files: ['MISSING.md'], skillsSection: 'SKILLS ONLY' });
    expect(result).toBe('SKILLS ONLY');
  });
});

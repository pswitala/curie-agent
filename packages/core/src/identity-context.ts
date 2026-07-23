import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPathAllowed } from './safety/path-guard.js';

/**
 * Build the base system prompt from a user-configured list of identity files
 * (relative to ~/.curie-agent/), in order, followed by the skills catalog.
 * Missing files are skipped. AGENTS.md is left un-delimited when it leads the
 * list, to preserve today's output for existing installs; every other file is
 * wrapped in an `=== <relative-path> ===` header. List order is preserved so
 * the assembled prompt stays byte-identical across turns for prompt caching.
 */
export function buildBaseSystemPrompt(opts: {
  curieDir: string;
  files: string[];
  skillsSection: string;
}): string | undefined {
  const { curieDir, files, skillsSection } = opts;
  const sections: string[] = [];

  files.forEach((relPath, index) => {
    const fullPath = join(curieDir, relPath);
    if (!isPathAllowed(fullPath, curieDir, [])) return;
    if (!existsSync(fullPath)) return;

    const content = readFileSync(fullPath, 'utf-8');
    if (index === 0 && relPath === 'AGENTS.md') {
      sections.push(content);
    } else {
      sections.push(`=== ${relPath} ===\n${content}`);
    }
  });

  if (skillsSection) sections.push(skillsSection);

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

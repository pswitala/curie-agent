import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

export interface TemplateData {
  [key: string]: string;
}

/** Replace {{PLACEHOLDER}} tokens in template content. */
export function interpolateTemplate(content: string, data: TemplateData): string {
  return content.replace(PLACEHOLDER_RE, (_match, key) => {
    return data[key] ?? _match;
  });
}

/** Read a template file, interpolate placeholders, write to target directory. */
export function copyTemplateFile(
  sourceDir: string,
  filename: string,
  targetDir: string,
  data: TemplateData,
): void {
  const src = path.join(sourceDir, filename);
  if (!fs.existsSync(src)) return;

  const content = fs.readFileSync(src, 'utf-8');
  const interpolated = interpolateTemplate(content, data);
  const dest = path.join(targetDir, filename);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(dest, interpolated, 'utf-8');
}

/** Recursively copy a directory, skipping if destination already exists. */
export function copyDirectoryRecursive(src: string, dst: string): void {
  if (fs.existsSync(dst)) return;

  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

/** Copy bundled skills from templates/skills/ to ~/.curie-agent/skills/. Skips existing skill dirs. */
export function copyInitSkills(templatesDir: string): void {
  const curieDir = path.join(os.homedir(), '.curie-agent');
  const sourceSkills = path.join(templatesDir, 'skills');
  const destSkills = path.join(curieDir, 'skills');

  if (!fs.existsSync(sourceSkills)) return;

  fs.mkdirSync(destSkills, { recursive: true });

  for (const entry of fs.readdirSync(sourceSkills, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      copyDirectoryRecursive(
        path.join(sourceSkills, entry.name),
        path.join(destSkills, entry.name),
      );
    }
  }
}

/** Get the ~/.curie-agent/ directory, creating it if needed. */
export function getCurieDir(): string {
  const dir = path.join(os.homedir(), '.curie-agent');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/**
 * Try to resolve the bundled templates directory.
 * Looks for @curie-agent/cli/templates/ via require.resolve,
 * falling back to a relative path from the calling module.
 */
export function resolveTemplatesDir(): string | null {
  const req = createRequire(import.meta.url);

  // Try resolving the CLI package's templates via require.resolve
  try {
    const cliPkg = req.resolve('@curie-agent/cli/package.json');
    const cliRoot = path.dirname(cliPkg);
    const candidate = path.join(cliRoot, 'templates');
    if (fs.existsSync(candidate)) return candidate;
  } catch { /* package not resolvable */ }

  // Try common relative paths from this module
  const myDir = path.dirname(new URL(import.meta.url).pathname);
  for (const offset of ['../../cli/templates', '../../../cli/templates']) {
    const candidate = path.resolve(myDir, offset);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

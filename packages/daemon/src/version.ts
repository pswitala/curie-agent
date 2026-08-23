import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The daemon's real package version, read from package.json at load time.
 *
 * Every site that reports a version must use this. Hardcoded literals drifted
 * years out of date across four files before this existed, and a test that
 * guarded only one of them didn't catch it.
 */
export const VERSION: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', '..', 'web', 'dist');
const dest = join(__dirname, '..', 'web', 'dist');

if (!existsSync(src)) {
  console.error('web/dist not found — run pnpm turbo build in packages/web first');
  process.exit(1);
}

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log('web/dist copied to daemon/web/dist');

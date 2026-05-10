/**
 * Patches spawndamnit@3.0.1 to fix signal-exit.onExit compatibility.
 *
 * spawndamnit@3.0.1 uses `const { onExit } = require('signal-exit')` but
 * signal-exit v3+ removed the onExit export. This polyfills it using
 * signal-exit.load() which is available in all versions.
 *
 * See: https://github.com/vercel/turborepo/issues/ (signal-exit v3 breaking change)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

const spawndamnitPath = join(
  root,
  'node_modules/.pnpm/spawndamnit@3.0.1/node_modules/spawndamnit/index.js'
);

if (!existsSync(spawndamnitPath)) {
  console.log('spawndamnit not found, skipping patch');
  process.exit(0);
}

let content = readFileSync(spawndamnitPath, 'utf-8');
const patched = content.replace(
  /const { onExit } = require\('signal-exit'\)/,
  `const signalExit = require('signal-exit')
// signal-exit v3+ removed onExit; polyfill using load()
const onExit = signalExit.onExit || function(fn) { signalExit.load(fn, signalExit.signals) }`
);

if (content !== patched) {
  writeFileSync(spawndamnitPath, patched);
  console.log('spawndamnit patched: signal-exit.onExit compatibility added');
} else {
  console.log('spawndamnit already patched or no changes needed');
}

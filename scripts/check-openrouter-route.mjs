/**
 * Live check: does the OpenRouter payload get accepted by a pinned upstream?
 *
 *   node scripts/check-openrouter-route.mjs deepinfra
 *   node scripts/check-openrouter-route.mjs novita
 *
 * Pins a single upstream with allow_fallbacks:false so a rejection surfaces
 * instead of being masked by a silent fallback. Sends the real built-in tool
 * list, since malformed tool schemas were the prime 422 suspect.
 * Reads the API key from ~/.curie-settings.json; never prints it.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OpenRouterProvider } from '../packages/providers/dist/src/openrouter.js';
import { allTools } from '../packages/tools/dist/src/index.js';
import { createSpawnAgentTool } from '../packages/tools/dist/src/spawn-agent.js';

const upstream = process.argv[2] ?? 'deepinfra';

const settings = JSON.parse(readFileSync(join(homedir(), '.curie-settings.json'), 'utf-8'));
const or = settings.providers.openrouter;

const tools = [
  ...allTools.map((t) => t.definition),
  // The daemon appends this on every real request — the schema that used to ship
  // as a JSON string.
  createSpawnAgentTool({ subagentExecutor: {}, resolve: () => ({}) }).definition,
];

const provider = new OpenRouterProvider(or.api_key, or.url, {
  order: [upstream],
  allowFallbacks: false,
});
await provider.getModels(); // populate the max_completion_tokens cache

console.log(`model=${or.model}  upstream=${upstream}  tools=${tools.length}`);
console.log(`configured max_output_tokens=${or.max_output_tokens}, model cap=${provider.getModelInfo(or.model)?.maxCompletionTokens ?? 'unknown'}`);

const { iterable } = provider.stream({
  messages: [{ role: 'user', content: 'Reply with exactly the word: ok' }],
  model: or.model,
  tools,
  effort: settings.effort,
  maxTokens: or.max_output_tokens,
  sessionId: 'route-check',
});

let text = '';
for await (const ev of iterable) {
  if (ev.type === 'text-delta') text += ev.text;
  if (ev.type === 'stop') {
    if (ev.reason === 'error') {
      console.log(`\nFAIL (${upstream}): ${ev.errorDetail}`);
      process.exit(1);
    }
    console.log(`\nOK (${upstream}) reason=${ev.reason} text=${JSON.stringify(text.trim())}`);
  }
}

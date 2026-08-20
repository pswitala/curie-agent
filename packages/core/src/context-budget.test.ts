import { describe, it, expect } from 'vitest';
import {
  resolveBudget, estimateRequestTokens, toolDefinitionChars, breakdownChars,
  fillPct, classify, calibrate, clampCalibration, formatTokens, DEFAULT_CALIBRATION,
} from './context-budget.js';
import { DEFAULT_SETTINGS, type CurieSettings } from './settings.js';
import type { Message } from './turn-loop.js';

function settingsWith(provider: string, over: Record<string, unknown> = {}): CurieSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.current_provider = provider;
  Object.assign(s.providers[provider]!, over);
  return s;
}

describe('resolveBudget', () => {
  it('reads the window from the active provider', () => {
    expect(resolveBudget(settingsWith('anthropic')).windowTokens).toBe(200000);
    expect(resolveBudget(settingsWith('openai')).windowTokens).toBe(131072);
  });

  it('never reserves more than 25% of the window', () => {
    // 65536 was the old invisible default — against a 131072 window that ate half of it.
    const b = resolveBudget(settingsWith('openai', { max_output_tokens: 65536 }));
    expect(b.reservedOutput).toBe(Math.floor(131072 * 0.25));
    expect(b.usableTokens).toBe(131072 - b.reservedOutput);
  });

  it('honours a smaller configured reserve verbatim', () => {
    const b = resolveBudget(settingsWith('anthropic', { max_output_tokens: 8192 }));
    expect(b.reservedOutput).toBe(8192);
    expect(b.usableTokens).toBe(200000 - 8192);
  });

  it('falls back when the provider has no reserve configured', () => {
    const s = settingsWith('anthropic');
    delete s.providers.anthropic!.max_output_tokens;
    expect(resolveBudget(s).reservedOutput).toBe(32768);
  });

  it('handles an unknown provider name without throwing', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.current_provider = 'not-a-provider';
    expect(resolveBudget(s).windowTokens).toBeGreaterThan(0);
  });
});

describe('toolDefinitionChars', () => {
  it('counts schemas, which the old estimator omitted entirely', () => {
    const chars = toolDefinitionChars([
      { name: 'Read', description: 'Reads a file', inputSchema: { type: 'object', properties: { file_path: { type: 'string' } } } },
    ]);
    expect(chars).toBeGreaterThan(50);
  });

  it('accepts a pre-stringified schema', () => {
    const asString = toolDefinitionChars([{ name: 'A', description: 'B', inputSchema: '{"x":1}' }]);
    expect(asString).toBe(1 + 1 + '{"x":1}'.length);
  });

  it('is zero for no tools', () => {
    expect(toolDefinitionChars([])).toBe(0);
  });
});

describe('breakdownChars', () => {
  const messages: Message[] = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: [{ type: 'text', text: 'hi' }, { type: 'tool-use', id: '1', name: 'Read', input: { file_path: '/a' } }] },
    { role: 'tool', toolUseId: '1', toolName: 'Read', content: 'x'.repeat(1000) },
  ];

  it('separates tool results from conversation', () => {
    const b = breakdownChars({ system: 'sys', messages });
    expect(b.toolResults).toBeGreaterThanOrEqual(1000);
    expect(b.conversation).toBeLessThan(200);
  });

  it('counts thinking blocks and their signatures', () => {
    const b = breakdownChars({ messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'abc', signature: 'sig' }] }] });
    expect(b.conversation).toBe(6);
  });
});

describe('estimateRequestTokens', () => {
  const messages: Message[] = [{ role: 'user', content: 'x'.repeat(4000) }];

  it('divides characters by the calibration ratio', () => {
    expect(estimateRequestTokens({ messages, calibration: 4 })).toBe(Math.ceil((4000 + 200) / 4));
  });

  it('reports more tokens for a denser tokenizer', () => {
    const sparse = estimateRequestTokens({ messages, calibration: 4 });
    const dense = estimateRequestTokens({ messages, calibration: 2.5 });
    expect(dense).toBeGreaterThan(sparse);
  });

  it('includes tool definitions in the total', () => {
    const without = estimateRequestTokens({ messages });
    const with_ = estimateRequestTokens({
      messages,
      toolDefinitions: [{ name: 'Read', description: 'd'.repeat(400), inputSchema: {} }],
    });
    expect(with_).toBeGreaterThan(without);
  });
});

describe('calibration', () => {
  it('clamps to [2, 6]', () => {
    expect(clampCalibration(1)).toBe(2);
    expect(clampCalibration(9)).toBe(6);
    expect(clampCalibration(3.3)).toBeCloseTo(3.3);
  });

  it('falls back to the default for degenerate input', () => {
    expect(clampCalibration(0)).toBe(DEFAULT_CALIBRATION);
    expect(clampCalibration(NaN)).toBe(DEFAULT_CALIBRATION);
    expect(calibrate(0, 100)).toBe(DEFAULT_CALIBRATION);
    expect(calibrate(100, 0)).toBe(DEFAULT_CALIBRATION);
  });

  it('learns chars-per-token from a real usage report', () => {
    expect(calibrate(10_000, 4_000)).toBeCloseTo(2.5);
  });
});

describe('fillPct', () => {
  const budget = { windowTokens: 1000, reservedOutput: 200, usableTokens: 800 };

  it('is a percentage of usable, not total, tokens', () => {
    expect(fillPct(400, budget)).toBe(50);
  });

  it('saturates at 100', () => {
    expect(fillPct(100_000, budget)).toBe(100);
  });

  it('reports full when there is no usable room', () => {
    expect(fillPct(1, { windowTokens: 100, reservedOutput: 100, usableTokens: 0 })).toBe(100);
  });
});

describe('classify', () => {
  const cfg = { enabled: 'on' as const, threshold: 75, warn_threshold: 60, forced_threshold: 85 };

  it('maps each tier at its boundary', () => {
    expect(classify(59, cfg)).toBe('ok');
    expect(classify(60, cfg)).toBe('warn');
    expect(classify(74, cfg)).toBe('warn');
    expect(classify(75, cfg)).toBe('suggest');
    expect(classify(84, cfg)).toBe('suggest');
    expect(classify(85, cfg)).toBe('forced');
    expect(classify(100, cfg)).toBe('forced');
  });

  it('silences every tier when disabled, not just forced compaction', () => {
    const off = { ...cfg, enabled: 'off' as const };
    for (const pct of [0, 60, 75, 85, 100]) {
      expect(classify(pct, off)).toBe('ok');
    }
  });

  it('uses DEFAULT_SETTINGS when no config is supplied', () => {
    expect(classify(90)).toBe('forced');
    expect(classify(0)).toBe('ok');
  });
});

describe('formatTokens', () => {
  it('scales the unit', () => {
    expect(formatTokens(900)).toBe('900');
    expect(formatTokens(12_400)).toBe('12.4k');
    expect(formatTokens(1_200_000)).toBe('1.2m');
  });
});

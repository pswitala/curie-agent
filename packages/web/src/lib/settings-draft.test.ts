import { describe, it, expect } from 'vitest';
import {
  getPath,
  setPath,
  diffPaths,
  orderWrites,
  validate,
  parseJsonObject,
  linesToArray,
  arrayToLines,
  asText,
  type Draft,
} from './settings-draft.js';

describe('getPath', () => {
  it('reads a nested value', () => {
    expect(getPath({ providers: { openai: { model: 'gpt-5.4' } } }, 'providers.openai.model')).toBe('gpt-5.4');
  });

  it('returns undefined for a missing intermediate segment', () => {
    expect(getPath({ providers: {} }, 'providers.openai.model')).toBeUndefined();
  });

  it('returns undefined when a segment is not an object', () => {
    expect(getPath({ model: 'gpt-5.4' }, 'model.nested')).toBeUndefined();
  });

  it('reads a top-level scalar', () => {
    expect(getPath({ theme: 'nord' }, 'theme')).toBe('nord');
  });
});

describe('asText', () => {
  it('passes strings through', () => {
    expect(asText('nord')).toBe('nord');
  });

  it('renders numbers and booleans', () => {
    expect(asText(75)).toBe('75');
    expect(asText(false)).toBe('false');
  });

  it('renders null and undefined as empty', () => {
    expect(asText(null)).toBe('');
    expect(asText(undefined)).toBe('');
  });

  it('refuses to stringify objects and arrays — "[object Object]" must never reach an input', () => {
    expect(asText({ a: 1 })).toBe('');
    expect(asText(['a'])).toBe('');
  });
});

describe('setPath', () => {
  it('writes a top-level scalar', () => {
    expect(setPath({ theme: 'nord' }, 'theme', 'dracula')).toEqual({ theme: 'dracula' });
  });

  it('writes a nested value without touching siblings', () => {
    const before = { providers: { openai: { model: 'a', url: 'u' }, google: { model: 'g' } } };
    const after = setPath(before, 'providers.openai.model', 'b');
    expect(getPath(after, 'providers.openai.model')).toBe('b');
    expect(getPath(after, 'providers.openai.url')).toBe('u');
    expect(getPath(after, 'providers.google.model')).toBe('g');
  });

  it('does not mutate its input — a new reference is what makes React re-render', () => {
    const before: Draft = { providers: { openai: { model: 'a' } } };
    const after = setPath(before, 'providers.openai.model', 'b');
    expect(after).not.toBe(before);
    expect(after.providers).not.toBe(before.providers);
    expect(getPath(before, 'providers.openai.model')).toBe('a');
  });

  it('creates missing intermediate objects', () => {
    expect(setPath({}, 'wiki.path', '/w')).toEqual({ wiki: { path: '/w' } });
  });
});

describe('diffPaths', () => {
  it('returns nothing when nothing changed', () => {
    const base = { theme: 'nord', providers: { openai: { model: 'a' } } };
    expect(diffPaths(base, structuredClone(base))).toEqual([]);
  });

  it('reports a top-level scalar change', () => {
    expect(diffPaths({ theme: 'nord' }, { theme: 'dracula' })).toEqual([{ path: 'theme', value: 'dracula' }]);
  });

  it('reports the deepest dot path for a nested change', () => {
    const base = { providers: { openai: { model: 'a', api_key: 'k' } } };
    const draft = { providers: { openai: { model: 'a', api_key: 'k2' } } };
    expect(diffPaths(base, draft)).toEqual([{ path: 'providers.openai.api_key', value: 'k2' }]);
  });

  it('treats arrays as leaves rather than diffing elements', () => {
    const writes = diffPaths(
      { safety: { path_allowlist: ['a'] } },
      { safety: { path_allowlist: ['a', 'b'] } },
    );
    expect(writes).toEqual([{ path: 'safety.path_allowlist', value: ['a', 'b'] }]);
  });

  it('ignores an untouched mcp_servers object', () => {
    const servers = { openmeteo: { command: 'node', args: ['x'] } };
    expect(diffPaths({ mcp_servers: servers }, { mcp_servers: structuredClone(servers) })).toEqual([]);
  });

  it('recurses into mcp_servers entries rather than rewriting the whole map', () => {
    const writes = diffPaths(
      { mcp_servers: { a: { command: 'node' } } },
      { mcp_servers: { a: { command: 'deno' } } },
    );
    expect(writes).toEqual([{ path: 'mcp_servers.a.command', value: 'deno' }]);
  });

  it('ignores keys present in base but absent from draft — the UI never deletes', () => {
    expect(diffPaths({ theme: 'nord', debug: true }, { theme: 'nord' })).toEqual([]);
  });

  it('sends a brand-new subtree as one write', () => {
    const writes = diffPaths({ providers: {} }, { providers: { fresh: { model: 'm' } } });
    expect(writes).toEqual([{ path: 'providers.fresh', value: { model: 'm' } }]);
  });

  it('reports a boolean flipping to false', () => {
    expect(diffPaths({ debug: true }, { debug: false })).toEqual([{ path: 'debug', value: false }]);
  });
});

describe('orderWrites', () => {
  it('sorts current_provider after a provider model write', () => {
    const ordered = orderWrites([
      { path: 'current_provider', value: 'openai' },
      { path: 'providers.openai.model', value: 'gpt-5.4' },
    ]);
    expect(ordered.map(w => w.path)).toEqual(['providers.openai.model', 'current_provider']);
  });

  it('leaves other write order untouched', () => {
    const writes = [
      { path: 'theme', value: 'nord' },
      { path: 'debug', value: true },
    ];
    expect(orderWrites(writes).map(w => w.path)).toEqual(['theme', 'debug']);
  });
});

/** A draft that passes validation, so each test can perturb one field. */
function validDraft(): Draft {
  return {
    auto_compact: { warn_threshold: 60, threshold: 75, forced_threshold: 85 },
    heartbeat: {
      schedule: 'on',
      intraday: '7:55,11:55',
      daily: '6:00',
      weekly: 'monday@6:00',
      monthly: '1@6:00',
      dreaming: '2:00',
    },
    providers: { openai: { model: 'gpt-5.4', model_context_window: 131072 } },
  };
}

describe('validate', () => {
  it('accepts a valid draft', () => {
    expect(validate(validDraft())).toEqual({});
  });

  describe('auto-compaction thresholds', () => {
    it('rejects warn at or above suggest', () => {
      const d = validDraft();
      (d.auto_compact as Draft).warn_threshold = 90;
      expect(validate(d)['auto_compact.warn_threshold']).toMatch(/below the suggest/);
    });

    it('rejects equal warn and suggest', () => {
      const d = validDraft();
      (d.auto_compact as Draft).warn_threshold = 75;
      expect(validate(d)['auto_compact.warn_threshold']).toBeTruthy();
    });

    it('rejects suggest at or above force', () => {
      const d = validDraft();
      (d.auto_compact as Draft).threshold = 85;
      expect(validate(d)['auto_compact.threshold']).toMatch(/below the force/);
    });

    it.each([4, 100])('rejects %i as out of the 5-99 range', n => {
      const d = validDraft();
      (d.auto_compact as Draft).threshold = n;
      expect(validate(d)['auto_compact.threshold']).toMatch(/between 5 and 99/);
    });

    it('accepts the boundary values 5 and 99', () => {
      const d = validDraft();
      d.auto_compact = { warn_threshold: 5, threshold: 50, forced_threshold: 99 };
      expect(validate(d)).toEqual({});
    });
  });

  describe('heartbeat times', () => {
    it.each(['6:00', '06:00', '23:59', '0:00'])('accepts %s as a daily time', time => {
      const d = validDraft();
      (d.heartbeat as Draft).daily = time;
      expect(validate(d)['heartbeat.daily']).toBeUndefined();
    });

    it.each(['25:00', '6:0', '6:60', 'noon', '6.00'])('rejects %s as a daily time', time => {
      const d = validDraft();
      (d.heartbeat as Draft).daily = time;
      expect(validate(d)['heartbeat.daily']).toBeTruthy();
    });

    it('rejects a blank daily time — it would revert to the default on reload', () => {
      const d = validDraft();
      (d.heartbeat as Draft).daily = '';
      expect(validate(d)['heartbeat.daily']).toMatch(/Required/);
    });

    it('accepts a blank intraday list, which legitimately means none', () => {
      const d = validDraft();
      (d.heartbeat as Draft).intraday = '';
      expect(validate(d)['heartbeat.intraday']).toBeUndefined();
    });

    it('rejects an intraday list with one bad entry', () => {
      const d = validDraft();
      (d.heartbeat as Draft).intraday = '7:55,99:99';
      expect(validate(d)['heartbeat.intraday']).toBeTruthy();
    });

    it.each(['monday@6:00', 'sunday@23:30'])('accepts %s as a weekly schedule', v => {
      const d = validDraft();
      (d.heartbeat as Draft).weekly = v;
      expect(validate(d)['heartbeat.weekly']).toBeUndefined();
    });

    it.each(['funday@6:00', 'monday', 'monday@25:00'])('rejects %s as a weekly schedule', v => {
      const d = validDraft();
      (d.heartbeat as Draft).weekly = v;
      expect(validate(d)['heartbeat.weekly']).toBeTruthy();
    });

    it.each(['1@6:00', '31@23:00'])('accepts %s as a monthly schedule', v => {
      const d = validDraft();
      (d.heartbeat as Draft).monthly = v;
      expect(validate(d)['heartbeat.monthly']).toBeUndefined();
    });

    it.each(['32@6:00', '0@6:00', '1', 'x@6:00'])('rejects %s as a monthly schedule', v => {
      const d = validDraft();
      (d.heartbeat as Draft).monthly = v;
      expect(validate(d)['heartbeat.monthly']).toBeTruthy();
    });
  });

  describe('providers', () => {
    it('rejects a blank model — it would revert to the default on restart', () => {
      const d = validDraft();
      (getPath(d, 'providers.openai') as Draft).model = '  ';
      expect(validate(d)['providers.openai.model']).toMatch(/Required/);
    });

    it('rejects a context window below 1000', () => {
      const d = validDraft();
      (getPath(d, 'providers.openai') as Draft).model_context_window = 999;
      expect(validate(d)['providers.openai.model_context_window']).toBeTruthy();
    });

    it('accepts a context window of exactly 1000', () => {
      const d = validDraft();
      (getPath(d, 'providers.openai') as Draft).model_context_window = 1000;
      expect(validate(d)['providers.openai.model_context_window']).toBeUndefined();
    });
  });

  it('tolerates a draft missing whole sections', () => {
    expect(validate({})).toEqual({});
  });
});

describe('parseJsonObject', () => {
  it('accepts an object of objects', () => {
    const result = parseJsonObject('{"a":{"command":"node"}}');
    expect(result).toEqual({ ok: true, value: { a: { command: 'node' } } });
  });

  it('treats blank text as an empty object', () => {
    expect(parseJsonObject('   ')).toEqual({ ok: true, value: {} });
  });

  it('rejects malformed JSON', () => {
    expect(parseJsonObject('{"a":').ok).toBe(false);
  });

  it('rejects a top-level array', () => {
    const result = parseJsonObject('[]');
    expect(result.ok).toBe(false);
  });

  it('names the offending key when an entry is not an object', () => {
    const result = parseJsonObject('{"a":"nope"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('"a"');
  });
});

describe('linesToArray / arrayToLines', () => {
  it('round-trips an array', () => {
    const paths = ['C:\\git\\aaa', 'C:\\git\\bbb'];
    expect(linesToArray(arrayToLines(paths))).toEqual(paths);
  });

  it('renders the legacy comma-separated string form as lines', () => {
    expect(arrayToLines('a,b')).toBe('a\nb');
  });

  it('migrates the legacy string form to an array', () => {
    expect(linesToArray(arrayToLines('a,b'))).toEqual(['a', 'b']);
  });

  it('drops blank lines and trims', () => {
    expect(linesToArray('  a  \n\n b \n')).toEqual(['a', 'b']);
  });

  it('renders an empty or absent value as empty text', () => {
    expect(arrayToLines('')).toBe('');
    expect(arrayToLines(undefined)).toBe('');
  });
});

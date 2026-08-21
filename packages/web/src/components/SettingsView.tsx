import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';
import { useApi } from '../lib/api-context.js';
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
} from '../lib/settings-draft.js';

interface Props {
  rpc: JsonRpcClient | null;
  className?: string;
}

const PROVIDERS = ['anthropic', 'openai', 'openrouter', 'google', 'ollama', 'local'] as const;
const THEMES = ['curie', 'nord', 'tokyo-night', 'dracula', 'solarized', 'gruvbox', 'black', 'white', 'grey'] as const;
const MODES = ['plan', 'edit', 'auto', 'yolo'] as const;
const EFFORTS = ['low', 'medium', 'high', 'max', 'auto'] as const;
const ON_OFF = ['on', 'off'] as const;

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; msg: string };

export default function SettingsView({ rpc, className }: Props) {
  const { ws } = useApi();
  const [base, setBase] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [provider, setProvider] = useState<string>('anthropic');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  // Errors a control detects about its own raw input (unparseable JSON, a
  // cleared number box) — validate() only sees committed draft values, so
  // without this channel Save would stay enabled over invalid input.
  const [blockers, setBlockers] = useState<Record<string, string>>({});
  const savingRef = useRef(false);

  const setBlocker = useCallback((path: string, error: string | null) => {
    setBlockers(prev => {
      if (error === null) {
        if (!(path in prev)) return prev;
        return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== path));
      }
      if (prev[path] === error) return prev;
      return { ...prev, [path]: error };
    });
  }, []);

  const load = useCallback(() => {
    if (!rpc) return;
    rpc.configAll()
      .then(settings => {
        if (!settings || typeof settings !== 'object') throw new Error('Malformed settings payload');
        const tree = settings as Draft;
        setBase(tree);
        setDraft(structuredClone(tree));
        setLoadError(null);
        setChangedElsewhere(false);
        const current: unknown = tree.current_provider;
        if (typeof current === 'string' && current) setProvider(current);
      })
      .catch((err: unknown) => { setLoadError(err instanceof Error ? err.message : 'Failed to load settings'); });
  }, [rpc]);

  useEffect(() => { load(); }, [load]);

  const writes = useMemo(() => (base && draft ? diffPaths(base, draft) : []), [base, draft]);
  // validate() wins over a raw-input blocker on the same path — its cross-field
  // messages ("Warn must be below the suggest threshold") are more useful.
  const errors = useMemo(
    () => ({ ...blockers, ...(draft ? validate(draft) : {}) }),
    [draft, blockers],
  );
  const dirty = writes.length > 0;
  const canSave = dirty && Object.keys(errors).length === 0 && !savingRef.current;

  // Another client (TUI, Telegram, heartbeat) writes the same file. Refetch when
  // the user has nothing staged; otherwise flag it rather than clobbering their
  // in-progress edits.
  useEffect(() => {
    if (!ws) return;
    return ws.on('config-changed', () => {
      if (savingRef.current) return;
      if (dirty) setChangedElsewhere(true);
      else load();
    });
  }, [ws, dirty, load]);

  const upd = useCallback((path: string, value: unknown) => {
    setDraft(d => (d ? setPath(d, path, value) : d));
  }, []);

  const revert = useCallback(() => {
    setDraft(base ? structuredClone(base) : null);
    setStatus({ kind: 'idle' });
  }, [base]);

  const save = useCallback(async () => {
    if (!rpc || !canSave) return;
    savingRef.current = true;
    setStatus({ kind: 'saving' });
    try {
      // Sequential: config.set is read-modify-write on a clone server-side, and
      // ordering matters for the derived-model mirror.
      for (const write of orderWrites(writes)) {
        await rpc.configSet(write.path, write.value);
      }
      setStatus({ kind: 'saved', at: Date.now() });
      savingRef.current = false;
      load();
    } catch (err: unknown) {
      savingRef.current = false;
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : 'Save failed' });
    }
  }, [rpc, canSave, writes, load]);

  const toggleReveal = useCallback((path: string) => {
    setRevealed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const ctx: FieldCtx = { draft, errors, upd, revealed, toggleReveal, setBlocker };

  if (loadError) {
    return (
      <div className={`flex-1 overflow-y-auto p-7 scrollbar-thin ${className ?? ''}`}>
        <div className="flex flex-col items-center justify-center py-14 gap-3">
          <span className="text-[13px] text-red">Could not load settings</span>
          <span className="text-xs text-muted font-mono">{loadError}</span>
          <button onClick={() => { load(); }} className="mt-1 px-3 py-1.5 rounded text-xs text-muted hover:text-fg transition-colors"
            style={{ background: 'var(--s3)', border: '1px solid var(--b1)' }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className={`flex-1 overflow-y-auto p-7 scrollbar-thin ${className ?? ''}`}>
        <div className="flex items-center justify-center py-10 text-muted text-[13px]">Loading settings…</div>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto p-7 scrollbar-thin ${className ?? ''}`}>
      <div className="max-w-3xl mx-auto pb-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg tracking-tight">Settings</h2>
            <span className="text-[10px] text-muted font-mono">~/.curie-settings.json</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusLabel status={status} dirty={dirty} errorCount={Object.keys(errors).length} />
            <button
              onClick={revert}
              disabled={!dirty}
              className="py-2 px-3.5 rounded-xl text-[12px] font-semibold cursor-pointer transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--s3)', border: '1px solid var(--b1)', color: 'var(--muted)' }}
            >
              Revert
            </button>
            <button
              onClick={() => void save()}
              disabled={!canSave}
              className="btn-gold py-2 px-4 rounded-xl text-[12px] font-semibold cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status.kind === 'saving'
                ? 'Saving…'
                : dirty ? `Save ${String(writes.length)} change${writes.length === 1 ? '' : 's'}` : 'Save'}
            </button>
          </div>
        </div>

        {changedElsewhere && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg mb-4"
            style={{ background: 'color-mix(in srgb, var(--yellow) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--yellow) 35%, transparent)' }}>
            <span className="text-[12px]" style={{ color: 'var(--yellow)' }}>
              Settings changed elsewhere. Your edits are kept — reload to see the new values.
            </span>
            <button onClick={() => { load(); }} className="text-[11px] font-semibold shrink-0 cursor-pointer hover:underline" style={{ color: 'var(--yellow)' }}>
              Reload
            </button>
          </div>
        )}

        {status.kind === 'error' && (
          <div className="px-4 py-2.5 rounded-lg mb-4 text-[12px]"
            style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 35%, transparent)', color: 'var(--red)' }}>
            {status.msg}
          </div>
        )}

        <Section title="Agent">
          <Grid2>
            <Select ctx={ctx} path="mode" label="Approval mode" options={MODES} />
            <Select ctx={ctx} path="effort" label="Reasoning effort" options={EFFORTS} />
            <Select ctx={ctx} path="theme" label="Theme" options={THEMES} />
          </Grid2>
          <Grid2>
            <Bool ctx={ctx} path="statusline" label="Status line" />
            <Bool ctx={ctx} path="debug" label="Debug logging" />
          </Grid2>
        </Section>

        <Section title="Provider & Model" hint="The active provider supplies the model used for every turn.">
          <Select ctx={ctx} path="current_provider" label="Active provider" options={PROVIDERS} />

          <div className="flex flex-wrap gap-1.5 mt-4 mb-3">
            {PROVIDERS.map(name => {
              const active = provider === name;
              const configured = asText(getPath(draft, `providers.${name}.api_key`)) !== '';
              return (
                <button
                  key={name}
                  onClick={() => { setProvider(name); }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-mono cursor-pointer transition-all duration-100 flex items-center gap-1.5"
                  style={{
                    background: active ? 'color-mix(in srgb, var(--gold) 15%, transparent)' : 'var(--s2)',
                    border: `1px solid ${active ? 'var(--gold)' : 'var(--b1)'}`,
                    color: active ? 'var(--gold)' : 'var(--muted)',
                  }}
                >
                  {name}
                  <span className="w-[5px] h-[5px] rounded-full shrink-0"
                    style={{ background: configured ? 'var(--green)' : 'var(--muted2)' }} />
                </button>
              );
            })}
          </div>

          <Secret ctx={ctx} path={`providers.${provider}.api_key`} label="API key" />
          <Grid2>
            <Text ctx={ctx} path={`providers.${provider}.model`} label="Model" />
            <Text ctx={ctx} path={`providers.${provider}.url`} label="Base URL" />
          </Grid2>
          <Grid2>
            <Text ctx={ctx} path={`providers.${provider}.model_cost`} label="Pricing" placeholder="3;15"
              hint="Input;output USD per million tokens. Tiers: 3;15|272000<6;22.5" />
            <Num ctx={ctx} path={`providers.${provider}.model_context_window`} label="Context window" min={1000} />
          </Grid2>
          <Num ctx={ctx} path={`providers.${provider}.max_output_tokens`} label="Max output tokens" min={256} />
        </Section>

        <Section title="Limits" hint="Per turn caps the current message; per run caps the whole session.">
          <Grid2>
            <Num ctx={ctx} path="tools_per_call" label="Tool calls per turn" min={1} />
            <Num ctx={ctx} path="tools_per_run" label="Tool calls per run" min={1} />
            <Num ctx={ctx} path="websearch_per_call" label="Web searches per turn" min={0} />
            <Num ctx={ctx} path="websearch_per_run" label="Web searches per run" min={0} />
          </Grid2>
        </Section>

        <Section title="Auto-compaction" hint="Percentages of the context window. Warn < suggest < force.">
          <OnOff ctx={ctx} path="auto_compact.enabled" label="Enabled" />
          <Grid2>
            <Num ctx={ctx} path="auto_compact.warn_threshold" label="Warn at %" min={5} max={99} />
            <Num ctx={ctx} path="auto_compact.threshold" label="Suggest at %" min={5} max={99} />
            <Num ctx={ctx} path="auto_compact.forced_threshold" label="Force at %" min={5} max={99} />
            <Text ctx={ctx} path="auto_compact.model" label="Summariser model" placeholder="blank = active model" />
          </Grid2>
        </Section>

        <Section title="Safety">
          <Grid2>
            <OnOff ctx={ctx} path="safety.path_guard" label="Path guard" />
            <OnOff ctx={ctx} path="safety.command_guard" label="Command guard" />
            <OnOff ctx={ctx} path="safety.snapshots" label="Git snapshots" />
          </Grid2>
          <Lines ctx={ctx} path="safety.path_allowlist" label="Path allowlist"
            hint="One absolute path per line. Writes outside the project cwd and these paths are refused."
            placeholder={'C:\\git\\my-project'} />
        </Section>

        <Section title="Heartbeat" hint="Autonomous wake-ups. Turn the whole cycle off with Schedule rather than blanking times.">
          <Grid2>
            <OnOff ctx={ctx} path="heartbeat.schedule" label="Schedule" />
            <Select ctx={ctx} path="heartbeat.mode" label="Approval mode" options={MODES} />
          </Grid2>
          <Text ctx={ctx} path="heartbeat.intraday" label="Intraday" placeholder="7:55,11:55,15:55"
            hint="Comma-separated H:MM times. Blank for none." />
          <Grid2>
            <Text ctx={ctx} path="heartbeat.daily" label="Daily" placeholder="6:00" />
            <Text ctx={ctx} path="heartbeat.dreaming" label="Dreaming" placeholder="2:00" />
            <Text ctx={ctx} path="heartbeat.weekly" label="Weekly" placeholder="monday@6:00" />
            <Text ctx={ctx} path="heartbeat.monthly" label="Monthly" placeholder="1@6:00" />
          </Grid2>
        </Section>

        <Section title="Channels (Telegram)">
          <Secret ctx={ctx} path="channels.bot_token" label="Bot token" />
          <Grid2>
            <Text ctx={ctx} path="channels.user_id" label="User ID" />
            <Text ctx={ctx} path="channels.chat_id" label="Chat ID" />
          </Grid2>
          <Bool ctx={ctx} path="channels.allow_groups" label="Allow group chats" />
        </Section>

        <Section title="Integrations">
          <Secret ctx={ctx} path="brave_search_api_key" label="Brave Search API key" />
          <Grid2>
            <Text ctx={ctx} path="wiki.path" label="Wiki path" placeholder="blank = default" />
            <OnOff ctx={ctx} path="wiki.autoLint" label="Wiki auto-lint" />
            <OnOff ctx={ctx} path="pricing_tier_warn" label="Pricing tier warnings" />
          </Grid2>
          <Json ctx={ctx} path="mcp_servers" label="MCP servers" badge="RESTART"
            hint="An object keyed by server name. Changes apply after the daemon restarts." />
        </Section>

        <Section title="Advanced">
          <Lines ctx={ctx} path="system_prompt_files" label="System prompt files" badge="RESTART"
            hint="Identity files in ~/.curie-agent/ inlined into the system prompt, in order."
            placeholder={'AGENTS.md'} />
          <Field label="Web bind IP" hint="The address the daemon listens on. Edit ~/.curie-settings.json directly — a wrong value makes the daemon unreachable.">
            <div className="w-full px-3 py-2 rounded-lg text-[12.5px] font-mono text-muted"
              style={{ background: 'var(--s1)', border: '1px solid var(--b1)' }}>
              {asText(getPath(draft, 'web_ip')) || '127.0.0.1'}
            </div>
          </Field>
        </Section>
      </div>
    </div>
  );
}

function StatusLabel({ status, dirty, errorCount }: { status: Status; dirty: boolean; errorCount: number }) {
  if (errorCount > 0) {
    return <span className="text-[11px] font-mono" style={{ color: 'var(--red)' }}>
      {String(errorCount)} error{errorCount === 1 ? '' : 's'}
    </span>;
  }
  if (status.kind === 'saved' && !dirty) {
    return <span className="text-[11px] font-mono" style={{ color: 'var(--green)' }}>
      saved {new Date(status.at).toLocaleTimeString()}
    </span>;
  }
  if (dirty) return <span className="text-[11px] font-mono text-muted">unsaved</span>;
  return null;
}

/* ---------------------------------------------------------------- layout ---- */

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl mb-3 overflow-hidden" style={{ background: 'var(--s1)', border: '1px solid var(--b1)' }}>
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--b1)' }}>
        <div className="text-[12px] font-medium text-text2">{title}</div>
        {hint && <div className="text-[10.5px] text-muted mt-0.5">{hint}</div>}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

function Field({ label, hint, error, badge, children }: {
  label: string;
  hint?: string;
  error?: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="text-[10px] text-muted uppercase tracking-wider font-mono block">{label}</label>
        {badge && (
          <span className="text-[9px] font-mono px-1.5 py-px rounded uppercase tracking-wider"
            style={{ background: 'color-mix(in srgb, var(--yellow) 15%, transparent)', color: 'var(--yellow)' }}>
            {badge}
          </span>
        )}
      </div>
      {children}
      {error
        ? <div className="text-[10.5px] mt-1" style={{ color: 'var(--red)' }}>{error}</div>
        : hint ? <div className="text-[10.5px] text-muted mt-1">{hint}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- controls ---- */

interface FieldCtx {
  draft: Draft | null;
  errors: Record<string, string>;
  upd: (path: string, value: unknown) => void;
  revealed: Set<string>;
  toggleReveal: (path: string) => void;
  setBlocker: (path: string, error: string | null) => void;
}

interface ControlProps {
  ctx: FieldCtx;
  path: string;
  label: string;
  hint?: string;
  badge?: string;
  placeholder?: string;
}

const INPUT_CLASS = 'w-full px-3 py-2 rounded-lg text-[12.5px] text-fg outline-none transition-colors focus:ring-1 focus:ring-gold/30';
const INPUT_STYLE = { background: 'var(--s2)', border: '1px solid var(--b1)' } as const;

function errorStyle(error?: string) {
  return error ? { ...INPUT_STYLE, border: '1px solid var(--red)' } : INPUT_STYLE;
}

function Text({ ctx, path, label, hint, badge, placeholder }: ControlProps) {
  const error = ctx.errors[path];
  return (
    <Field label={label} hint={hint} error={error} badge={badge}>
      <input
        type="text"
        value={asText(getPath(ctx.draft, path))}
        onChange={e => { ctx.upd(path, e.target.value); }}
        placeholder={placeholder}
        className={INPUT_CLASS}
        style={errorStyle(error)}
      />
    </Field>
  );
}

function Num({ ctx, path, label, hint, min, max }: ControlProps & { min?: number; max?: number }) {
  const error = ctx.errors[path];
  const raw = getPath(ctx.draft, path);
  const { setBlocker } = ctx;

  // A cleared or out-of-range box must block Save. `min`/`max` attributes are
  // advisory — browsers happily submit a blank number input, and a blank value
  // would be written as '' and then silently revert to the packaged default.
  useEffect(() => {
    if (raw === undefined || raw === null || raw === '') {
      setBlocker(path, 'Required.');
    } else if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      setBlocker(path, 'Must be a number.');
    } else if (min !== undefined && raw < min) {
      setBlocker(path, `Must be at least ${String(min)}.`);
    } else if (max !== undefined && raw > max) {
      setBlocker(path, `Must be at most ${String(max)}.`);
    } else {
      setBlocker(path, null);
    }
  }, [raw, path, min, max, setBlocker]);

  // Clear the blocker when this control unmounts (e.g. the provider tab changes).
  useEffect(() => () => { setBlocker(path, null); }, [path, setBlocker]);

  return (
    <Field label={label} hint={hint} error={error}>
      <input
        type="number"
        min={min}
        max={max}
        value={typeof raw === 'number' ? String(raw) : ''}
        onChange={e => {
          const next = e.target.value;
          // Keep an empty box empty rather than snapping to 0 mid-typing.
          ctx.upd(path, next === '' ? '' : Number(next));
        }}
        className={INPUT_CLASS}
        style={errorStyle(error)}
      />
    </Field>
  );
}

function Select({ ctx, path, label, hint, options }: ControlProps & { options: readonly string[] }) {
  const error = ctx.errors[path];
  const value = asText(getPath(ctx.draft, path));
  return (
    <Field label={label} hint={hint} error={error}>
      <select
        value={value}
        onChange={e => { ctx.upd(path, e.target.value); }}
        className="w-full px-3 py-2 rounded-lg text-[12.5px] text-fg outline-none cursor-pointer"
        style={errorStyle(error)}
      >
        {!options.includes(value) && <option value={value}>{value || '—'}</option>}
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </Field>
  );
}

/** Real boolean settings — statusline, debug, channels.allow_groups. */
function Bool({ ctx, path, label, hint }: ControlProps) {
  const value = getPath(ctx.draft, path) === true;
  return (
    <Field label={label} hint={hint}>
      <Toggle on={value} onClick={() => { ctx.upd(path, !value); }} onLabel="on" offLabel="off" />
    </Field>
  );
}

/**
 * 'on' | 'off' STRING settings — the safety guards, auto_compact.enabled,
 * heartbeat.schedule, wiki.autoLint, pricing_tier_warn. Writing a real boolean
 * to these fails silently, since the readers compare against 'on'.
 */
function OnOff({ ctx, path, label, hint }: ControlProps) {
  const value = asText(getPath(ctx.draft, path)) === 'on';
  return (
    <Field label={label} hint={hint}>
      <Toggle on={value} onClick={() => { ctx.upd(path, value ? ON_OFF[1] : ON_OFF[0]); }} onLabel="on" offLabel="off" />
    </Field>
  );
}

function Toggle({ on, onClick, onLabel, offLabel }: { on: boolean; onClick: () => void; onLabel: string; offLabel: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] cursor-pointer transition-colors w-full"
      style={{ background: 'var(--s2)', border: '1px solid var(--b1)', color: on ? 'var(--green)' : 'var(--muted)' }}
    >
      <span className="w-8 h-4 rounded-full relative shrink-0 transition-colors"
        style={{ background: on ? 'var(--green)' : 'var(--b3)' }}>
        <span className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
          style={{ background: 'var(--s1)', left: on ? '18px' : '2px' }} />
      </span>
      <span className="font-mono text-[11px]">{on ? onLabel : offLabel}</span>
    </button>
  );
}

function Secret({ ctx, path, label, hint }: ControlProps) {
  const error = ctx.errors[path];
  const value = asText(getPath(ctx.draft, path));
  const shown = ctx.revealed.has(path);
  return (
    <Field label={label} hint={hint ?? (value ? undefined : 'Not set')} error={error}>
      <div className="flex gap-2">
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={e => { ctx.upd(path, e.target.value); }}
          autoComplete="off"
          spellCheck={false}
          placeholder="not set"
          className={`${INPUT_CLASS} font-mono`}
          style={errorStyle(error)}
        />
        <button
          onClick={() => { ctx.toggleReveal(path); }}
          title={shown ? 'Hide' : 'Reveal'}
          className="px-3 rounded-lg text-muted hover:text-fg transition-colors cursor-pointer shrink-0"
          style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
        >
          {shown ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </Field>
  );
}

/** One-per-line textarea backed by a string[] setting. */
function Lines({ ctx, path, label, hint, badge, placeholder }: ControlProps) {
  const error = ctx.errors[path];
  return (
    <Field label={label} hint={hint} error={error} badge={badge}>
      <textarea
        value={arrayToLines(getPath(ctx.draft, path))}
        onChange={e => { ctx.upd(path, linesToArray(e.target.value)); }}
        rows={3}
        placeholder={placeholder}
        className={`${INPUT_CLASS} font-mono resize-y scrollbar-thin`}
        style={errorStyle(error)}
        spellCheck={false}
      />
    </Field>
  );
}

/**
 * Free-form JSON object setting (mcp_servers). Keeps the raw text locally so a
 * half-typed edit is not thrown away, and only writes to the draft once it parses.
 */
function Json({ ctx, path, label, hint, badge }: ControlProps) {
  const committed = getPath(ctx.draft, path);
  const [text, setText] = useState(() => JSON.stringify(committed ?? {}, null, 2));
  const lastCommitted = useRef(committed);
  const { setBlocker } = ctx;
  const error = ctx.errors[path];

  // Re-sync when a reload replaces the underlying value, but never while the
  // user is mid-edit with unparseable text.
  useEffect(() => {
    if (committed !== lastCommitted.current) {
      lastCommitted.current = committed;
      setText(JSON.stringify(committed ?? {}, null, 2));
      setBlocker(path, null);
    }
  }, [committed, path, setBlocker]);

  useEffect(() => () => { setBlocker(path, null); }, [path, setBlocker]);

  return (
    <Field label={label} hint={hint} error={error} badge={badge}>
      <textarea
        value={text}
        onChange={e => {
          const next = e.target.value;
          setText(next);
          const result = parseJsonObject(next);
          if (result.ok) {
            setBlocker(path, null);
            lastCommitted.current = result.value;
            ctx.upd(path, result.value);
          } else {
            // Leave the last valid value in the draft but block Save, so a
            // half-typed edit can never be persisted.
            setBlocker(path, result.error);
          }
        }}
        rows={8}
        className={`${INPUT_CLASS} font-mono text-[11.5px] resize-y scrollbar-thin`}
        style={errorStyle(error)}
        spellCheck={false}
      />
    </Field>
  );
}

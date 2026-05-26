import { useState, useCallback } from 'react';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';

interface Props {
  rpc: JsonRpcClient | null;
  onComplete: () => void;
  className?: string;
}

type ProviderName = 'anthropic' | 'openai' | 'local' | 'openrouter' | 'ollama';

interface ProviderInfo {
  label: string;
  defaultModel: string;
  requiresKey: boolean;
}

const PROVIDERS: Record<ProviderName, ProviderInfo> = {
  anthropic: { label: 'Anthropic', defaultModel: 'claude-sonnet-4-6', requiresKey: true },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4o', requiresKey: true },
  local: { label: 'Local (OpenAI-compatible)', defaultModel: 'custom', requiresKey: false },
  openrouter: { label: 'OpenRouter', defaultModel: 'anthropic/claude-sonnet-4-6', requiresKey: true },
  ollama: { label: 'Ollama (Local)', defaultModel: 'custom', requiresKey: false },
};

type Step =
  | 'provider'
  | 'api_key'
  | 'model'
  | 'soul_name'
  | 'soul_vibe'
  | 'user_name'
  | 'user_tz'
  | 'user_lang'
  | 'agents'
  | 'memory'
  | 'tools'
  | 'confirm';

export default function SetupWizard({ rpc, onComplete, className }: Props) {
  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState<ProviderName | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [soulName, setSoulName] = useState('');
  const [soulVibe, setSoulVibe] = useState('');
  const [userName, setUserName] = useState('');
  const [userTimezone, setUserTimezone] = useState('');
  const [userLanguages, setUserLanguages] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNext = useCallback(() => {
    setError(null);
    switch (step) {
      case 'provider': {
        if (!provider) return;
        const info = PROVIDERS[provider];
        setModel(info.defaultModel);
        setStep((info.requiresKey ? 'api_key' : 'model') as Step);
        break;
      }
      case 'api_key':
        setStep('model' as Step);
        break;
      case 'model':
        setStep('soul_name' as Step);
        break;
      case 'soul_name':
        if (!soulName.trim()) return;
        setStep('soul_vibe' as Step);
        break;
      case 'soul_vibe':
        setStep('user_name' as Step);
        break;
      case 'user_name':
        if (!userName.trim()) return;
        setStep('user_tz' as Step);
        break;
      case 'user_tz':
        setStep('user_lang' as Step);
        break;
      case 'user_lang':
        setStep('agents' as Step);
        break;
      case 'agents':
        setStep('memory' as Step);
        break;
      case 'memory':
        setStep('tools' as Step);
        break;
      case 'tools':
        setStep('confirm' as Step);
        break;
      case 'confirm':
        break;
    }
  }, [step, provider, soulName, userName]);

  const handleSubmit = useCallback(async () => {
    if (!rpc || !provider) return;
    setSubmitting(true);
    setError(null);
    try {
      await rpc.identitySetup({
        provider,
        apiKey,
        model,
        soulName: soulName.trim() || 'Curie',
        soulVibe: soulVibe.trim() || 'AI coding assistant — sharp, resourceful, gets things done',
        userName: userName.trim() || 'User',
        userTimezone: userTimezone.trim() || 'UTC',
        userLanguages: userLanguages.trim() || 'TypeScript, Python',
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  }, [rpc, provider, apiKey, model, soulName, soulVibe, userName, userTimezone, userLanguages, onComplete]);

  const stepTitle = (): string => {
    switch (step) {
      case 'provider': return 'Choose your provider';
      case 'api_key': return 'API key';
      case 'model': return 'Select a model';
      case 'soul_name': return 'Name your assistant';
      case 'soul_vibe': return 'Define the vibe';
      case 'user_name': return 'Your name';
      case 'user_tz': return 'Timezone';
      case 'user_lang': return 'Programming languages';
      case 'agents': return 'Workspace configuration';
      case 'memory': return 'Memory';
      case 'tools': return 'Tools';
      case 'confirm': return 'Review & create';
    }
  };

  const progress = (): number => {
    const total = 12;
    const order: Step[] = ['provider', 'api_key', 'model', 'soul_name', 'soul_vibe', 'user_name', 'user_tz', 'user_lang', 'agents', 'memory', 'tools', 'confirm'];
    return (order.indexOf(step) + 1) / total;
  };

  const renderStep = () => {
    switch (step) {
      case 'provider':
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted mb-4">
              Which LLM provider do you want to use for your AI assistant?
            </p>
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(PROVIDERS).map(([key, info]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setProvider(key as ProviderName)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-100 ${
                    provider === key
                      ? 'border-blue-500 bg-blue-500/10 text-text'
                      : 'border-b2 bg-s2 text-text hover:border-b3 hover:bg-s2/80'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    provider === key ? 'border-blue-500' : 'border-b3'
                  }`}>
                    {provider === key && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-text">{info.label}</div>
                    <div className="text-[10.5px] text-muted">Model: {info.defaultModel}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 'api_key': {
        const info = PROVIDERS[provider!];
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Enter your {info.label} API key:
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2.5 bg-[#0d1117] border border-b2 rounded-xl text-xs text-text font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500/70 transition-colors"
              autoFocus
            />
            <p className="text-[10px] text-muted">Saved to ~/.curie-settings.json</p>
          </div>
        );
      }

      case 'model': {
        const info = PROVIDERS[provider!];
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Suggested model: <code className="text-text font-mono">{info.defaultModel}</code>
            </p>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Enter model name or accept the default"
              className="w-full px-3 py-2.5 bg-[#0d1117] border border-b2 rounded-xl text-xs text-text font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500/70 transition-colors"
              autoFocus
            />
          </div>
        );
      }

      case 'soul_name':
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">What should your AI assistant&apos;s name be?</p>
            <input
              type="text"
              value={soulName}
              onChange={(e) => setSoulName(e.target.value)}
              placeholder="Curie"
              className="w-full px-3 py-2.5 bg-[#0d1117] border border-b2 rounded-xl text-xs text-text placeholder-slate-600 focus:outline-none focus:border-blue-500/70 transition-colors"
              autoFocus
            />
          </div>
        );

      case 'soul_vibe':
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">Describe your assistant&apos;s vibe/personality (1 sentence).</p>
            <input
              type="text"
              value={soulVibe}
              onChange={(e) => setSoulVibe(e.target.value)}
              placeholder="AI coding assistant — sharp, resourceful, gets things done"
              className="w-full px-3 py-2.5 bg-[#0d1117] border border-b2 rounded-xl text-xs text-text placeholder-slate-600 focus:outline-none focus:border-blue-500/70 transition-colors"
              autoFocus
            />
          </div>
        );

      case 'user_name':
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">What is your name?</p>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Paweł"
              className="w-full px-3 py-2.5 bg-[#0d1117] border border-b2 rounded-xl text-xs text-text placeholder-slate-600 focus:outline-none focus:border-blue-500/70 transition-colors"
              autoFocus
            />
          </div>
        );

      case 'user_tz':
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">Your timezone?</p>
            <input
              type="text"
              value={userTimezone}
              onChange={(e) => setUserTimezone(e.target.value)}
              placeholder="Europe/Warsaw"
              className="w-full px-3 py-2.5 bg-[#0d1117] border border-b2 rounded-xl text-xs text-text font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500/70 transition-colors"
              autoFocus
            />
          </div>
        );

      case 'user_lang':
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">Your primary programming languages?</p>
            <input
              type="text"
              value={userLanguages}
              onChange={(e) => setUserLanguages(e.target.value)}
              placeholder="TypeScript, Python"
              className="w-full px-3 py-2.5 bg-[#0d1117] border border-b2 rounded-xl text-xs text-text placeholder-slate-600 focus:outline-none focus:border-blue-500/70 transition-colors"
              autoFocus
            />
          </div>
        );

      case 'agents':
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Next: I&apos;ll create your workspace configuration files.
            </p>
            <div className="p-3 bg-s2 border border-b1 rounded-xl text-[10.5px] text-text leading-relaxed">
              <p className="font-medium mb-1">AGENTS.md will include:</p>
              <ul className="list-disc list-inside space-y-0.5 text-muted">
                <li>Session startup instructions</li>
                <li>Memory system (daily notes + long-term)</li>
                <li>Coding agent capabilities</li>
                <li>Red lines and safety boundaries</li>
                <li>Heartbeat configuration</li>
              </ul>
            </div>
          </div>
        );

      case 'memory':
        return (
          <div className="space-y-3">
            <div className="p-3 bg-s2 border border-b1 rounded-xl text-xs text-text leading-relaxed">
              <p>Auto-creating MEMORY.md with initialization entry...</p>
            </div>
          </div>
        );

      case 'tools':
        return (
          <div className="space-y-3">
            <div className="p-3 bg-s2 border border-b1 rounded-xl text-xs text-text leading-relaxed">
              <p>Auto-creating TOOLS.md and HEARTBEAT.md...</p>
            </div>
          </div>
        );

      case 'confirm':
        return (
          <div className="space-y-4">
            <p className="text-xs text-muted">Review your configuration before creating files:</p>
            <div className="space-y-2">
              <ConfigRow label="Provider" value={PROVIDERS[provider!].label} />
              <ConfigRow label="Model" value={model} />
              <ConfigRow label="API Key" value={apiKey ? '[set]' : '(not set)'} />
              <ConfigRow label="Assistant Name" value={soulName.trim() || 'Curie'} />
              <ConfigRow label="Vibe" value={soulVibe.trim() || 'AI coding assistant'} />
              <ConfigRow label="Your Name" value={userName.trim() || 'User'} />
              <ConfigRow label="Timezone" value={userTimezone.trim() || 'UTC'} />
              <ConfigRow label="Languages" value={userLanguages.trim() || 'TypeScript, Python'} />
            </div>
            <div className="p-3 bg-s2 border border-b1 rounded-xl text-[10.5px] text-muted leading-relaxed">
              Identity files to be created:
              <ul className="list-disc list-inside mt-1">
                <li>~/.curie-agent/SOUL.md</li>
                <li>~/.curie-agent/USER.md</li>
                <li>~/.curie-agent/AGENTS.md</li>
                <li>~/.curie-agent/MEMORY.md</li>
                <li>~/.curie-agent/TOOLS.md</li>
                <li>~/.curie-agent/HEARTBEAT.md</li>
              </ul>
            </div>
          </div>
        );
    }
  };

  return (
    <div className={`flex-1 overflow-y-auto p-7 scrollbar-thin flex flex-col ${className || ''}`}>
      <div className="max-w-lg mx-auto w-full">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-base font-semibold text-fg tracking-tight mb-1">Setup Wizard</h2>
          <p className="text-[11px] text-muted">Configure your AI assistant — takes about 2 minutes</p>
        </div>

        {/* Progress bar */}
        <div className="mb-5">
          <div className="h-1 bg-b2 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${progress() * 100}%` }}
            />
          </div>
        </div>

        {/* Step title */}
        <h3 className="text-sm font-medium text-text mb-4">{stepTitle()}</h3>

        {/* Step content */}
        <div className="mb-6">
          {renderStep()}
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-start gap-2.5 mb-4">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3">
          {step !== 'provider' && step !== 'confirm' ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                switch (step) {
                  case 'api_key': setStep('provider' as Step); break;
                  case 'model': setStep((PROVIDERS[provider!].requiresKey ? 'api_key' : 'provider') as Step); break;
                  case 'soul_name': setStep('provider' as Step); break;
                  case 'soul_vibe': setStep('soul_name' as Step); break;
                  case 'user_name': setStep('soul_vibe' as Step); break;
                  case 'user_tz': setStep('user_name' as Step); break;
                  case 'user_lang': setStep('user_tz' as Step); break;
                  case 'agents': setStep('user_lang' as Step); break;
                  case 'memory': setStep('agents' as Step); break;
                  case 'tools': setStep('memory' as Step); break;
                }
              }}
              className="flex items-center gap-1 bg-transparent border border-b2 rounded px-3 py-2 text-muted text-xs hover:border-b3 hover:text-fg transition-colors duration-100"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>
          ) : (
            <div />
          )}

          {step === 'confirm' ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs px-5 py-2 rounded-xl shadow-lg shadow-blue-500/10 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] transition-all duration-150"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Creating...
                </>
              ) : (
                'Create Setup'
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              disabled={
                (step === 'provider' && !provider) ||
                (step === 'soul_name' && !soulName.trim()) ||
                (step === 'user_name' && !userName.trim())
              }
              className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs px-5 py-2 rounded-xl shadow-lg shadow-blue-500/10 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] transition-all duration-150"
            >
              Next
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-b1/50">
      <span className="text-[10.5px] text-muted">{label}</span>
      <span className="text-[10.5px] text-text font-mono">{value}</span>
    </div>
  );
}

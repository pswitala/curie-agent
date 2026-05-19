import React, { useState } from 'react';

interface Props {
  onAuthorize: (token: string) => void;
}

export default function AuthorizationScreen({ onAuthorize }: Props) {
  const [inputToken, setInputToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputToken.trim()) return;

    setVerifying(true);
    setError(null);

    try {
      // Validate by querying the authenticated health endpoint
      const res = await fetch(`/health?token=${encodeURIComponent(inputToken.trim())}`);
      if (res.ok) {
        onAuthorize(inputToken.trim());
      } else {
        setError('Invalid Access Token. Please verify and try again.');
      }
    } catch (err) {
      setError('Cannot connect to Curie Daemon. Make sure the daemon is running.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-[#0d1117] p-4 text-slate-100 font-sans select-none relative overflow-hidden">
      {/* Dynamic atmospheric radial background lights */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-[#1e293b] opacity-40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-[#1e1e38] opacity-35 blur-[120px] pointer-events-none" />

      {/* Auth Card Container */}
      <div className="w-full max-w-[440px] bg-[#161b22]/90 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-7 flex flex-col items-center animate-scaleIn relative z-10">
        
        {/* Glow accent bar at the top */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500/20 via-blue-500 to-indigo-500/20 rounded-t-2xl" />

        {/* Logo and branding */}
        <div className="flex flex-col items-center gap-3 mb-6 mt-2">
          <div className="relative group">
            <div className="absolute inset-0 rounded-xl bg-blue-500/25 blur-md group-hover:blur-lg transition-all duration-300 animate-pulse" />
            <img
              src="/icons/logo-512.png"
              alt="Curie Logo"
              className="w-14 h-14 object-contain rounded-xl relative z-10 border border-slate-800 shadow-inner transform group-hover:scale-105 transition-transform duration-300"
            />
          </div>
          <div className="text-center mt-1">
            <span className="text-xl font-bold bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
              curie-agent
            </span>
            <span className="text-[10px] text-slate-500 font-mono block mt-0.5">v0.2.4</span>
          </div>
        </div>

        {/* Explanation / Welcome Text */}
        <div className="text-center mb-6">
          <h2 className="text-sm font-semibold text-slate-200 mb-2">Authorize this device</h2>
          <p className="text-[12.5px] text-slate-400 leading-relaxed px-2">
            Curie requires a secure daemon connection. Enter your access token below to authorize this device and start planning.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block ml-1">
              Daemon Access Token
            </label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-blue-500 transition-colors duration-200">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
              </div>
              <input
                type="password"
                required
                placeholder="Paste your daemon.token..."
                value={inputToken}
                onChange={(e) => setInputToken(e.target.value)}
                disabled={verifying}
                className="w-full pl-10 pr-4 py-2.5 bg-[#0d1117] border border-slate-800 rounded-xl text-[13px] text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 transition-all duration-200"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-start gap-2.5 animate-fadeIn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={verifying || !inputToken.trim()}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-blue-500/10 hover:shadow-blue-500/20 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-2"
          >
            {verifying ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Verifying Credentials...
              </>
            ) : (
              <>
                <span>Authorize & Connect</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </form>

        {/* Footer info/guide */}
        <div className="w-full mt-6 pt-5 border-t border-slate-800/80 text-[11.5px] text-slate-500 space-y-2 leading-relaxed">
          <div className="font-semibold text-slate-400">Where is my token?</div>
          <p>
            When starting the daemon, look for the console output in your terminal. It displays the dashboard link containing the secure token.
          </p>
          <p>
            You can also find the raw token inside the file <code className="font-mono bg-[#0d1117] border border-slate-800/50 px-1 py-0.5 rounded text-[10.5px] text-slate-400">~/.curie-agent/daemon.token</code> on your host machine.
          </p>
        </div>
      </div>
    </div>
  );
}

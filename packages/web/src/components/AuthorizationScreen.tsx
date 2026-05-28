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
      const res = await fetch('/health', {
        headers: { 'Authorization': `Bearer ${inputToken.trim()}` },
      });
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
    <div className="flex min-h-screen w-screen items-center justify-center p-4 font-sans select-none relative overflow-hidden" style={{ background: '#0e0b08', color: 'var(--cream, #f5e6d0)' }}>
      {/* Dynamic atmospheric radial background lights — warm tones */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full opacity-30 blur-[120px] pointer-events-none" style={{ background: '#2d1f0e' }} />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full opacity-25 blur-[120px] pointer-events-none" style={{ background: '#1e1408' }} />
      {/* Coffee bean accent glow */}
      <div className="absolute top-[40%] left-[50%] w-[40%] h-[40%] rounded-full opacity-15 blur-[100px] pointer-events-none" style={{ background: '#d4a54a', transform: 'translate(-50%, -50%)' }} />

      {/* Auth Card Container */}
      <div className="w-full max-w-[440px] rounded-2xl shadow-2xl p-7 flex flex-col items-center animate-scaleIn relative z-10" style={{
        background: 'linear-gradient(135deg, rgba(34, 28, 22, 0.95), rgba(20, 16, 12, 0.98))',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(86, 72, 58, 0.5)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(245,230,208,0.04)',
      }}>
        
        {/* Gold accent bar at the top */}
        <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, #d4a54a, transparent)' }} />

        {/* Logo and branding */}
        <div className="flex flex-col items-center gap-3 mb-6 mt-2">
          <div className="relative group">
            <div className="absolute inset-0 rounded-xl blur-md group-hover:blur-lg transition-all duration-300 animate-gold-pulse" style={{ background: 'rgba(212, 165, 74, 0.2)' }} />
            <img
              src="/icons/logo-512.png"
              alt="Curie Logo"
              className="w-14 h-14 object-contain rounded-xl relative z-10 transform group-hover:scale-105 transition-transform duration-300"
              style={{ border: '1px solid rgba(86, 72, 58, 0.6)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}
            />
          </div>
          <div className="text-center mt-1">
            <span className="text-xl font-display font-bold gold-shimmer block">
              curie-agent
            </span>
            <span className="text-[10px] font-mono block mt-0.5" style={{ color: '#d4a54a', opacity: 0.6 }}>v0.2.4</span>
          </div>
        </div>

        {/* Explanation / Welcome Text */}
        <div className="text-center mb-6">
          <h2 className="text-sm font-semibold mb-2" style={{ color: '#f5e6d0' }}>Authorize this device</h2>
          <p className="text-[12.5px] leading-relaxed px-2" style={{ color: '#8b7355' }}>
            Curie requires a secure daemon connection. Enter your access token below to authorize this device and start planning.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider block ml-1" style={{ color: '#d4a54a', opacity: 0.7 }}>
              Daemon Access Token
            </label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none transition-colors duration-200" style={{ color: '#8b7355' }}>
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
                className="w-full pl-10 pr-4 py-2.5 rounded-xl text-[13px] font-mono focus:outline-none transition-all duration-200"
                style={{
                  background: 'rgba(14, 11, 8, 0.8)',
                  border: '1px solid rgba(86, 72, 58, 0.4)',
                  color: '#f5e6d0',
                }}
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl text-xs flex items-start gap-2.5 animate-fadeIn" style={{
              background: 'color-mix(in srgb, var(--red) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--red) 20%, transparent)',
              color: 'var(--red)',
            }}>
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
            className="btn-gold w-full py-2.5 px-4 rounded-xl font-semibold text-xs active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-2"
          >
            {verifying ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full animate-spin" style={{
                  background: 'conic-gradient(from 0deg, transparent, #1a1410)',
                  mask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 0)',
                  WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 0)',
                }} />
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
        <div className="w-full mt-6 pt-5 space-y-2 leading-relaxed" style={{ borderTop: '1px solid rgba(86, 72, 58, 0.3)', fontSize: '11.5px', color: '#8b7355' }}>
          <div className="font-semibold" style={{ color: '#bfae94' }}>Where is my token?</div>
          <p>
            When starting the daemon, look for the console output in your terminal. It displays the dashboard link containing the secure token.
          </p>
          <p>
            You can also find the raw token inside the file <code className="font-mono px-1 py-0.5 rounded text-[10.5px]" style={{ background: 'rgba(14, 11, 8, 0.6)', border: '1px solid rgba(86, 72, 58, 0.3)', color: '#d4c4a8' }}>~/.curie-agent/daemon.token</code> on your host machine.
          </p>
        </div>
      </div>
    </div>
  );
}

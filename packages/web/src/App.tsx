import { useState, useEffect, useCallback } from 'react';
import { ApiProvider, useApi } from './lib/api-context.js';
import ChatArea from './components/ChatArea.js';
import ChannelsView from './components/ChannelsView.js';
import StatsView from './components/StatsView.js';
import ProjectsView from './components/ProjectsView.js';
import SubagentsView from './components/SubagentsView.js';
import CommandPalette from './components/CommandPalette.js';
import SetupWizard from './components/SetupWizard.js';
import UpdateNotification from './UpdateNotification.js';
import VersionPoller from './VersionPoller.js';
import { useWebSessions } from './hooks/useWebSessions.js';
import { useSession } from './hooks/useSession.js';
import { useConfig } from './hooks/useConfig.js';
import AuthorizationScreen from './components/AuthorizationScreen.js';

type View = 'assistant' | 'channels' | 'stats' | 'projects' | 'agents' | 'settings';


const MODES = ['plan', 'edit', 'auto', 'yolo'] as const;

const NAV_ITEMS: { view: View; label: string; icon: string }[] = [
  { view: 'assistant', label: 'Assistant', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  { view: 'channels', label: 'Channels', icon: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.86 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z' },
  { view: 'stats', label: 'Stats', icon: 'M18 20V10M12 20V4M6 20v-6' },
  { view: 'projects', label: 'Projects', icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' },
  { view: 'agents', label: 'Agents', icon: 'M12 8c0 2.21-1.79 4-4 4s-4-1.79-4-4 1.79-4 4-4 4 1.79 4 4zm-6 12v-2a6 6 0 0 1 12 0v2' },
  { view: 'settings', label: 'Settings', icon: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' },
];

function AppContent() {
  const { rpc, connected, token, setToken } = useApi();
  const { get, set } = useConfig();
  const [activeView, setActiveView] = useState<View>('assistant');
  const activeMode = (get('mode') as string) || 'auto';
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdResult, setCmdResult] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showManualInstall, setShowManualInstall] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [showSessionList, setShowSessionList] = useState(false);

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const checkStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true;
    setIsStandalone(!!checkStandalone);
  }, []);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('beforeinstallprompt', handleBeforeInstall as any);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall as any);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`PWA install prompt choice: ${outcome}`);
      setDeferredPrompt(null);
    } else {
      setShowManualInstall(true);
    }
  };

  const { sessions, refetch } = useWebSessions();
  const { events, addLiveEvent } = useSession(activeSessionId);

  const theme = (get('theme') as string) || 'curie';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Check if the daemon is initialized (has a provider configured)
  useEffect(() => {
    if (!connected || !rpc) return;
    rpc.configGet('current_provider')
      .then((val) => {
        if (!val) setShowSetupWizard(true);
      })
      .catch(() => { });
  }, [connected, rpc]);

  const handleNewChat = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const handleCreateSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    refetch();
  }, [refetch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleCmdPick = useCallback((cmd: string) => {
    setCmdResult(cmd);
    setCmdOpen(false);
  }, []);

  const handleClearCmdResult = useCallback(() => {
    setCmdResult('');
  }, []);

  const renderNavIcon = (item: { view: View; icon: string }, size = 18) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={item.icon} />
    </svg>
  );

  if (!token) {
    return <AuthorizationScreen onAuthorize={setToken} />;
  }

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-bg coffee-pattern">
      {/* Offline Mode Indicator */}
      {!isOnline && (
        <div className="px-4 py-2 text-center text-xs font-semibold flex items-center justify-center gap-2 select-none shrink-0 z-50 animate-fadeIn" style={{ background: 'color-mix(in srgb, var(--yellow) 10%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--yellow) 20%, transparent)', color: 'var(--yellow)' }}>
          <svg className="animate-pulse shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Offline Mode — Curie is running on cached local client
        </div>
      )}

      {/* PWA Update Notification */}
      <UpdateNotification />

      {/* Background version polling — detects server restarts even when SW cache is stale */}
      <VersionPoller />

      <main className="flex flex-1 flex-col overflow-hidden bg-bg">
          {/* Topbar — premium wood strip */}
          <div className="topbar-wood flex h-12 items-center gap-3 px-4 shrink-0">
            {/* Left: session button + nav icons */}
            <div className="flex items-center gap-1.5">
              {/* Session button (always visible) */}
              <button
                className={`relative flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150`}
                style={{
                  color: showSessionList ? 'var(--fg)' : 'var(--muted)',
                  background: showSessionList ? 'var(--s3)' : 'transparent',
                  border: showSessionList ? '1px solid var(--b1)' : '1px solid transparent',
                }}
                onClick={() => setShowSessionList(true)}
                title="Sessions"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
                {sessions.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center" style={{ background: 'var(--gold)', color: '#1a1410' }}>
                    {sessions.length > 99 ? '99+' : sessions.length}
                  </span>
                )}
              </button>
              <div className="w-px h-5 bg-b1 mx-0.5" />
              {/* Nav icons — one per view (tooltip on hover) */}
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.view}
                  className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 cursor-pointer"
                  style={{
                    color: activeView === item.view ? 'var(--gold)' : 'var(--muted)',
                    background: activeView === item.view ? 'var(--s3)' : 'transparent',
                    border: activeView === item.view ? '1px solid var(--b1)' : '1px solid transparent',
                  }}
                  onClick={() => setActiveView(item.view)}
                  title={item.label}
                >
                  {renderNavIcon(item, 18)}
                </button>
              ))}
            </div>

            <div className="flex-1" />

            {/* Mode pill — hidden on very small screens */}
            {window.innerWidth >= 640 && (
              <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--b2)', background: 'var(--s1)' }}>
                {MODES.map((m) => (
                  <button
                    key={m}
                    className="px-2.5 py-1 text-xs cursor-pointer transition-all duration-150 font-mono select-none"
                    style={{
                      color: activeMode === m ? 'var(--gold)' : 'var(--muted)',
                      background: activeMode === m ? 'var(--s3)' : 'transparent',
                      borderRight: '1px solid var(--b1)',
                    }}
                    onClick={() => set('mode', m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            {/* PWA Install Button */}
            {(deferredPrompt || (isMobile && !isStandalone)) && (
              <button
                onClick={handleInstallClick}
                className="flex items-center justify-center rounded-lg transition-all duration-150 px-2.5 py-1 gap-1.5 text-xs font-semibold cursor-pointer shrink-0"
                style={{
                  background: 'color-mix(in srgb, var(--green) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--green) 30%, transparent)',
                  color: 'var(--green)',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {!isMobile && (
                <>
                  Install
                </>
              )}
              </button>
            )}

            {/* Commands button — icon only on mobile */}
            <button
              className="flex items-center justify-center rounded-lg transition-all duration-150 px-2.5 py-1 gap-1.5 text-xs font-semibold cursor-pointer shrink-0"
              style={{
                background: 'transparent',
                border: '1px solid var(--b2)',
                color: 'var(--muted)',
              }}
              onClick={() => setCmdOpen(true)}
              title="Open Commands"
            >
              <svg width={isMobile ? "13" : "13"} height={isMobile ? "13" : "13"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {!isMobile && (
                <>
                  Ctrl+k
                </>
              )}
            </button>
          </div>

          {/* Views */}
          <div className="relative flex-1 min-h-0">
            {showSetupWizard && rpc ? (
              <SetupWizard rpc={rpc} onComplete={() => setShowSetupWizard(false)} className="absolute inset-0" />
            ) : activeView === 'assistant' && (
              <ChatArea
                cmdResult={cmdResult}
                onClearCmdResult={handleClearCmdResult}
                rpc={rpc}
                className="absolute inset-0"
                activeSessionId={activeSessionId}
                onCreateSession={handleCreateSession}
                events={events}
                addLiveEvent={addLiveEvent}
              />
            )}
            {activeView === 'channels' && <ChannelsView rpc={rpc} className="absolute inset-0" />}
            {activeView === 'stats' && <StatsView rpc={rpc} className="absolute inset-0" />}
            {activeView === 'projects' && <ProjectsView rpc={rpc} className="absolute inset-0" />}
            {activeView === 'agents' && <SubagentsView rpc={rpc} className="absolute inset-0" />}
            {activeView === 'settings' && <div className="absolute inset-0 flex items-center justify-center text-muted text-xs">Settings view — coming soon</div>}
          </div>
        </main>

      {/* Command Palette */}
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onPick={handleCmdPick}
      />

      {/* Mobile Session List Bottom Sheet */}
      {showSessionList && (
        <div
          className="fixed inset-0 z-[998] flex items-end animate-fadeIn"
          style={{ background: 'rgba(10, 8, 5, 0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowSessionList(false)}
        >
          <div
            className="w-full max-h-[70vh] rounded-t-2xl overflow-hidden animate-slideUp select-none flex flex-col wood-grain"
            style={{ background: 'var(--s1)', borderTop: '1px solid var(--b1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-8 h-1 rounded-full" style={{ background: 'var(--gold)', opacity: 0.3 }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3 shrink-0" style={{ borderBottom: '1px solid var(--b1)' }}>
              <span className="text-[13px] font-display font-semibold" style={{ color: 'var(--cream)' }}>Sessions</span>
              <button
                onClick={() => setShowSessionList(false)}
                className="text-muted hover:text-fg transition-colors duration-100 p-1"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* New Chat button */}
            <div className="px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--b1)' }}>
              <button
                onClick={() => {
                  handleNewChat();
                  setShowSessionList(false);
                }}
                className="w-full flex items-center gap-2.5 py-2 px-3 rounded-xl transition-all duration-150 active:scale-[0.98] cursor-pointer"
                style={{
                  background: 'color-mix(in srgb, var(--gold) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--gold) 20%, transparent)',
                  color: 'var(--gold)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span className="text-[12.5px] font-semibold">New Chat</span>
              </button>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin">
              {sessions
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((s) => (
                  <button
                    key={s.id}
                    className="w-full text-left py-3 px-3 rounded-xl mb-1 transition-all duration-150 active:scale-[0.98] min-h-[52px] cursor-pointer"
                    style={{
                      background: s.id === activeSessionId ? 'linear-gradient(135deg, var(--s3) 0%, var(--s2) 100%)' : 'transparent',
                      border: s.id === activeSessionId ? '1px solid var(--b2)' : '1px solid transparent',
                    }}
                    onClick={() => {
                      handleSelectSession(s.id);
                      setShowSessionList(false);
                    }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{
                        background: s.id === activeSessionId ? 'var(--gold)' : 'transparent',
                        boxShadow: s.id === activeSessionId ? '0 0 4px var(--gold)' : 'none',
                      }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-medium text-fg truncate">
                          {s.name || s.provider}
                        </div>
                        <div className="text-[11px] text-muted">
                          {s.provider} &middot; {(() => {
                            const ms = Date.now() - s.updatedAt;
                            if (ms < 60_000) return 'just now';
                            if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
                            if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
                            return `${Math.floor(ms / 86400_000)}d ago`;
                          })()}
                        </div>
                      </div>
                      {s.type && s.type !== 'webui' && (
                        <span className="text-[9px] font-mono text-muted bg-s2 px-1.5 py-0.5 rounded shrink-0">
                          {s.type}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              {sessions.length === 0 && (
                <div className="text-center py-8 text-xs text-muted">No sessions yet</div>
              )}
            </div>

            {/* Active session stats footer */}
            {activeSessionId && (
              <div className="border-t border-b1 px-4 py-3 shrink-0">
                {(() => {
                  const usageEvents = events.filter((e) => e.type === 'usage') as any[];
                  const totalTokens = usageEvents.reduce((acc, curr) =>
                    acc + (curr.inputTokens || 0) + (curr.outputTokens || 0), 0
                  );
                  const latestUsage = usageEvents[usageEvents.length - 1];
                  const contextTokens = latestUsage ? (latestUsage.inputTokens || 0) : 0;

                  function formatTokenCount(n: number): string {
                    if (n < 1000) return String(n);
                    return `${(n / 1000).toFixed(1)}k`;
                  }

                  return (
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <div className="text-[9px] text-muted2 uppercase tracking-wider font-mono">Tokens</div>
                        <div className="text-[12px] text-fg font-mono font-semibold">{formatTokenCount(totalTokens)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-muted2 uppercase tracking-wider font-mono">Context</div>
                        <div className="text-[12px] text-fg font-mono font-semibold">{formatTokenCount(contextTokens)}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-muted2 uppercase tracking-wider font-mono">Cost</div>
                        <div className="text-[12px] text-green font-mono font-semibold">${(usageEvents.reduce((acc, curr) => {
                          const pricing: Record<string, { in: number; out: number }> = {
                            'opus': { in: 15, out: 75 },
                            'sonnet': { in: 3, out: 15 },
                            'haiku': { in: 0.8, out: 4 },
                            'gpt-4o': { in: 2.5, out: 10 },
                            'gpt-4': { in: 5, out: 15 },
                            'qwen': { in: 0.112, out: 0.224 },
                          };
                          const m = (get('model') as string) || 'sonnet';
                          const key = Object.keys(pricing).find(k => m.toLowerCase().includes(k)) || 'sonnet';
                          const p = pricing[key]!;
                          return acc + ((curr.inputTokens || 0) * p.in + (curr.outputTokens || 0) * p.out) / 1_000_000;
                        }, 0)).toFixed(4)}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual PWA Install Instructions Modal */}
      {showManualInstall && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fadeIn" style={{ background: 'rgba(10, 8, 5, 0.7)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-[340px] p-5 rounded-2xl shadow-2xl animate-scaleIn select-none" style={{ background: 'linear-gradient(135deg, var(--s2), var(--s1))', border: '1px solid var(--b2)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            {/* Header */}
            <div className="flex items-center justify-between pb-3 mb-4" style={{ borderBottom: '1px solid var(--b1)' }}>
              <span className="font-bold text-[13.5px] font-display" style={{ color: 'var(--cream)' }}>Install Curie Agent</span>
              <button
                onClick={() => setShowManualInstall(false)}
                className="text-muted hover:text-fg transition-colors duration-100 cursor-pointer"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Instruction Steps */}
            <div className="space-y-3.5 text-xs text-text leading-relaxed">
              {isIOS ? (
                <>
                  <p className="text-[12px] text-muted mb-1 px-0.5">
                    Follow these simple steps to add Curie to your home screen:
                  </p>
                  <div className="flex gap-3 items-start p-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--s1) 50%, transparent)', border: '1px solid var(--b1)' }}>
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ background: 'color-mix(in srgb, var(--gold) 10%, transparent)', color: 'var(--gold)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
                      </svg>
                    </div>
                    <div>
                      <span className="font-semibold text-fg block mb-0.5">1. Tap the Share Button</span>
                      <span className="text-[11px] text-muted">Tap the Share icon in Safari's bottom toolbar.</span>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start p-3 rounded-xl" style={{ background: 'color-mix(in srgb, var(--s1) 50%, transparent)', border: '1px solid var(--b1)' }}>
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 font-bold font-mono text-[16px] select-none" style={{ background: 'color-mix(in srgb, var(--gold) 10%, transparent)', color: 'var(--gold)' }}>
                      +
                    </div>
                    <div>
                      <span className="font-semibold text-fg block mb-0.5">2. Add to Home Screen</span>
                      <span className="text-[11px] text-muted">Scroll down and select <strong>Add to Home Screen</strong>.</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[12px] text-muted mb-1 px-0.5">
                    Follow these simple steps to add Curie to your home screen:
                  </p>
                  <div className="flex gap-3 items-start bg-s1/50 border border-b1 p-3 rounded-xl">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="1" />
                        <circle cx="12" cy="5" r="1" />
                        <circle cx="12" cy="19" r="1" />
                      </svg>
                    </div>
                    <div>
                      <span className="font-semibold text-fg block mb-0.5">1. Open Browser Menu</span>
                      <span className="text-[11px] text-muted">Tap the menu icon (three dots) in the top-right corner.</span>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start bg-s1/50 border border-b1 p-3 rounded-xl">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </div>
                    <div>
                      <span className="font-semibold text-fg block mb-0.5">2. Select Add / Install</span>
                      <span className="text-[11px] text-muted">Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Action */}
            <button
              onClick={() => setShowManualInstall(false)}
              className="btn-gold w-full mt-5 py-2.5 px-4 rounded-xl font-semibold text-xs active:scale-[0.98] transition-all duration-150 cursor-pointer flex items-center justify-center"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ApiProvider>
      <AppContent />
    </ApiProvider>
  );
}

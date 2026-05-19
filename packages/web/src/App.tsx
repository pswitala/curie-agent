import { useState, useEffect, useCallback } from 'react';
import { ApiProvider, useApi } from './lib/api-context.js';
import Sidebar from './components/Sidebar.js';
import ChatView from './components/ChatView.js';
import ChannelsView from './components/ChannelsView.js';
import StatsView from './components/StatsView.js';
import ProjectsView from './components/ProjectsView.js';
import AgentsView from './components/AgentsView.js';
import CommandPalette from './components/CommandPalette.js';
import SetupWizard from './components/SetupWizard.js';
import { useWebSessions } from './hooks/useWebSessions.js';
import { useSession } from './hooks/useSession.js';
import { useConfig } from './hooks/useConfig.js';
import AuthorizationScreen from './components/AuthorizationScreen.js';

type View = 'assistant' | 'channels' | 'stats' | 'projects' | 'agents' | 'settings';

const TITLES: Record<View, string> = {
  assistant: 'Assistant',
  channels: 'Channels',
  stats: 'Stats',
  projects: 'Projects',
  agents: 'Agents',
  settings: 'Settings',
};

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

  const theme = (get('theme') as string) || 'nord';

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
      .catch(() => {});
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
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-bg">
      {/* Offline Mode Indicator */}
      {!isOnline && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-500 px-4 py-2 text-center text-xs font-semibold flex items-center justify-center gap-2 select-none shrink-0 z-50 animate-fadeIn">
          <svg className="animate-pulse shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Offline Mode — Curie is running on cached local client
        </div>
      )}

      <div className="flex flex-1 w-full overflow-hidden">
        {/* Sidebar — hidden on mobile */}
        {!isMobile && (
          <Sidebar
            activeView={activeView}
            onNavigate={setActiveView}
            connected={connected}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onNewChat={handleNewChat}
            onSelectSession={handleSelectSession}
            events={events}
          />
        )}

        <main className="flex flex-1 flex-col overflow-hidden bg-bg">
          {/* Topbar */}
          <div className="flex h-12 items-center gap-2 px-3 shrink-0">
            {/* Mobile nav icons */}
            {isMobile && (
              <div className="flex items-center gap-0.5">
                {NAV_ITEMS.map((item) => (
                  <button
                    key={item.view}
                    className={`flex items-center justify-center w-10 h-10 rounded-[6px] transition-all duration-100 ${activeView === item.view
                      ? 'text-fg bg-s3'
                      : 'text-muted hover:text-text hover:bg-s2'
                      }`}
                    onClick={() => setActiveView(item.view)}
                    title={item.label}
                  >
                    {renderNavIcon(item, 21)}
                  </button>
                ))}
              </div>
            )}

            {/* Title — only on desktop */}
            {!isMobile && (
              <span className="text-[13.5px] font-medium text-fg">{TITLES[activeView]}</span>
            )}

            <div className="flex-1" />

            {/* Mode pill — hidden on very small screens */}
            {window.innerWidth >= 640 && (
              <div className="flex border border-b2 rounded-[6px] overflow-hidden">
                {MODES.map((m) => (
                  <button
                    key={m}
                    className={`px-2.5 py-1 text-xs cursor-pointer transition-all duration-100 font-mono select-none ${activeMode === m ? 'text-fg bg-s3' : 'text-muted hover:text-text hover:bg-s2'
                      }`}
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
                className="flex items-center justify-center bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 rounded-[6px] transition-all duration-100 px-2.5 py-1 gap-1.5 text-xs font-semibold cursor-pointer shrink-0"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Install App
              </button>
            )}

            {/* Commands button — icon only on mobile */}
            <button
              className={`flex items-center justify-center bg-transparent border border-b2 rounded-[6px] text-muted hover:border-b3 hover:text-text transition-all duration-100 ${
                isMobile ? 'w-10 h-10' : 'px-2.5 py-1 gap-1.5 text-xs'
              }`}
              onClick={() => setCmdOpen(true)}
              title="Open Commands"
            >
              <svg width={isMobile ? "21" : "12"} height={isMobile ? "21" : "12"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {!isMobile && (
                <>
                  Commands
                  <span className="bg-s3 rounded-[3px] px-1.5 py-0.5 text-[10px] text-muted font-mono">K</span>
                </>
              )}
            </button>
          </div>

        {/* Views */}
        <div className="relative flex-1 min-h-0">
          {showSetupWizard && rpc ? (
            <SetupWizard rpc={rpc} onComplete={() => setShowSetupWizard(false)} className="absolute inset-0" />
          ) : activeView === 'assistant' && (
            <ChatView
              cmdResult={cmdResult}
              onClearCmdResult={handleClearCmdResult}
              rpc={rpc}
              className="absolute inset-0"
              activeSessionId={activeSessionId}
              onNewChat={handleNewChat}
              onCreateSession={handleCreateSession}
              events={events}
              addLiveEvent={addLiveEvent}
            />
          )}
          {activeView === 'channels' && <ChannelsView rpc={rpc} className="absolute inset-0" />}
          {activeView === 'stats' && <StatsView rpc={rpc} className="absolute inset-0" />}
          {activeView === 'projects' && <ProjectsView rpc={rpc} className="absolute inset-0" />}
          {activeView === 'agents' && <AgentsView rpc={rpc} className="absolute inset-0" />}
          {activeView === 'settings' && <div className="absolute inset-0 flex items-center justify-center text-muted text-xs">Settings view — coming soon</div>}
        </div>
      </main>
      </div>

      {/* Command Palette */}
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onPick={handleCmdPick}
      />

      {/* Manual PWA Install Instructions Modal */}
      {showManualInstall && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="w-full max-w-[340px] p-5 rounded-2xl border border-b2 bg-s2/95 backdrop-blur-md shadow-2xl animate-scaleIn select-none">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-b1 mb-4">
              <span className="font-bold text-fg text-[13.5px]">Install Curie Agent</span>
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
                  <div className="flex gap-3 items-start bg-s1/50 border border-b1 p-3 rounded-xl">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
                      </svg>
                    </div>
                    <div>
                      <span className="font-semibold text-fg block mb-0.5">1. Tap the Share Button</span>
                      <span className="text-[11px] text-muted">Tap the Share icon in Safari's bottom toolbar.</span>
                    </div>
                  </div>

                  <div className="flex gap-3 items-start bg-s1/50 border border-b1 p-3 rounded-xl">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 shrink-0 font-bold font-mono text-[16px] select-none">
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
              className="w-full mt-5 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-500/10 active:scale-[0.98] transition-all duration-150 cursor-pointer flex items-center justify-center"
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

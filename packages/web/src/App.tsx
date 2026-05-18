import { useState, useEffect, useCallback } from 'react';
import { ApiProvider, useApi } from './lib/api-context.js';
import Sidebar from './components/Sidebar.js';
import ChatView from './components/ChatView.js';
import ChannelsView from './components/ChannelsView.js';
import StatsView from './components/StatsView.js';
import ProjectsView from './components/ProjectsView.js';
import AgentsView from './components/AgentsView.js';
import CommandPalette from './components/CommandPalette.js';
import { useWebSessions } from './hooks/useWebSessions.js';
import { useSession } from './hooks/useSession.js';
import { useConfig } from './hooks/useConfig.js';

type View = 'assistant' | 'channels' | 'stats' | 'projects' | 'agents';

const TITLES: Record<View, string> = {
  assistant: 'Assistant',
  channels: 'Channels',
  stats: 'Stats',
  projects: 'Projects',
  agents: 'Agents',
};

const MODES = ['plan', 'edit', 'auto', 'yolo'] as const;

const NAV_ITEMS: { view: View; label: string; icon: string }[] = [
  { view: 'assistant', label: 'Assistant', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  { view: 'channels', label: 'Channels', icon: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.86 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z' },
  { view: 'stats', label: 'Stats', icon: 'M18 20V10M12 20V4M6 20v-6' },
  { view: 'projects', label: 'Projects', icon: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' },
  { view: 'agents', label: 'Agents', icon: 'M12 8c0 2.21-1.79 4-4 4s-4-1.79-4-4 1.79-4 4-4 4 1.79 4 4zm-6 12v-2a6 6 0 0 1 12 0v2' },
];

function AppContent() {
  const { rpc, connected } = useApi();
  const { get, set } = useConfig();
  const [activeView, setActiveView] = useState<View>('assistant');
  const activeMode = (get('mode') as string) || 'auto';
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdResult, setCmdResult] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

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

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-bg text-text font-sans text-[13.5px]">
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
          {activeView === 'assistant' && (
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
        </div>
      </main>

      {/* Command Palette */}
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onPick={handleCmdPick}
      />
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

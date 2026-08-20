import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, Static, useInput, usePaste, useApp, useStdout } from 'ink';
import { TabBar, TAB_IDS, type TabId } from './tab-bar.js';
import { Footer } from './footer.js';
import { EffortPicker, EFFORT_LEVELS, type EffortLevel } from './effort-picker.js';
import { ModePicker, MODE_LEVELS, type ModeLevel } from './mode-picker.js';
import { ApprovalPicker } from './approval-picker.js';
import { parseSlashCommand } from './slash-commands.js';
import { ProjectsTab } from './projects-tab.js';
import type { ProjectEntry } from './projects-tab.js';
import { StatsTab } from './stats-tab.js';
import { AgentsTab, type AgentEntry } from './agents-tab.js';
import { ChannelsTab, type ChannelTabEntry } from './channels-tab.js';
import { WikiTab, type WikiPageEntry } from './wiki-tab.js';
import type { Event } from '../../core/src/event-bus.js';
import type { ThemeColors } from '../../render/src/themes.js';
import { Markdown } from '@curie-agent/render';
import { ContextReport, type ContextReportData } from './context-report.js';

export interface SlashCommandInput {
  command: string;
  args: string;
}

/**
 * Apply Backspace or Delete to the input buffer.
 *
 * Extracted as a pure function so the edge cases are testable. The one that bit
 * us: Backspace at column 0 used to compute `text.slice(0, -1) + text.slice(0)`,
 * which dropped the last character and then re-appended the whole string,
 * duplicating the input instead of doing nothing.
 */
export function applyDeletion(
  text: string,
  cursor: number,
  kind: 'backspace' | 'delete',
): { text: string; cursor: number } {
  const c = Math.max(0, Math.min(cursor, text.length));
  if (kind === 'backspace') {
    if (c === 0) return { text, cursor: 0 };
    return { text: text.slice(0, c - 1) + text.slice(c), cursor: c - 1 };
  }
  if (c >= text.length) return { text, cursor: c };
  return { text: text.slice(0, c) + text.slice(c + 1), cursor: c };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'tool-group' | 'system' | 'decision' | 'heartbeat' | 'task' | 'debug' | 'thinking' | 'context-report';
  content: string;
  title?: string;
  /** Structured payload for role 'context-report'. */
  contextReport?: ContextReportData;
}

export const COLD_START_BANNER = [
  '████ █  █ ████ ████ █ ████     █   ████ ████ ██ █ █████',
  '█    █  █ █ █  █ █  █ ██      ███  █ ▀█ █▀▀  ████   █  ',
  '████ ████ █  █ █  █ █ ████   █   █ ████ ████ █ ██   █  '
].join('\n');

interface ChatSurfaceProps {
  messages: ChatMessage[];
  model: string;
  provider: string;
  approvalMode: string;
  effort?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  contextWindowSize?: number;
  contextFillPct?: number;
  contextUsedTokens?: number;
  project?: string;
  duration?: string;
  costUsd?: number;
  activeTab?: TabId;
  status?: string;
  contextMode?: string;
  agent?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onInterrupt?: () => void;
  onSlashCommand?: (input: SlashCommandInput) => void;
  onBashCommand?: (command: string) => void;
  onEffortChange?: (effort: EffortLevel) => void;
  onModeChange?: (mode: ModeLevel) => void;
  theme?: ThemeColors;
  events?: Event[];
  projects?: ProjectEntry[];
  agents?: Map<string, AgentEntry>;
  pendingApproval?: {
    toolName: string;
    input: Record<string, unknown>;
    reason: string;
  } | null;
  onApprovalDecision?: (decision: 'allow' | 'deny') => void;
  onSelectProject?: (project: ProjectEntry) => void;
  channels?: ChannelTabEntry[];
  onChannelSelect?: (channelId: string) => void;
  wikiPages?: WikiPageEntry[];
  wikiPath?: string;
  // User input history — stable refs passed separately to prevent Ink remounts.
// If we pass these as a single object literal, Ink sees a new ref each render
// and remounts ChatSurface, destroying the useInput handler.
  historyArray?: string[];
  historyIndexRef?: { current: number };
  setHistoryIndexFn?: (idx: number) => void;
 }

// Fixed row counts for chrome layout.
const INPUT_BASE_ROWS = 1;

export function ChatSurface({
  messages,
  model,
  approvalMode,
  effort,
  inputTokens = 0,
  outputTokens = 0,
  cacheReadTokens,
  contextWindowSize = 200_000,
  contextFillPct = 0,
  contextUsedTokens,
  project = 'homepage-refactor-0422',
  duration = '00:00:00',
  costUsd = 0,
  activeTab = 'assistant',
  status = 'idle',
  contextMode = 'CodeContext Zen',
  agent,
  onSubmit,
  onCancel,
  onInterrupt,
  onSlashCommand,
  onBashCommand,
  onEffortChange,
  onModeChange,
  theme,
  projects,
  agents,
  pendingApproval,
  onApprovalDecision,
  onSelectProject,
  channels,
  onChannelSelect,
  wikiPages,
  wikiPath,
  historyArray,
  historyIndexRef,
  setHistoryIndexFn,
 }: ChatSurfaceProps) {
  const [inputText, setInputText] = useState('');
  const [currentTab, setCurrentTab] = useState<TabId>(activeTab);
  React.useEffect(() => { setCurrentTab(activeTab); }, [activeTab]);
 // -1 = not browsing (showing live draft); otherwise index
  // into history from the end (0 = most recent).
  // historyIndex — read directly from ref so closure stays fresh between keypresses
  // without needing re-renders (setHistoryIndexFn doesn't trigger re-renders).
  const getHistoryIndex = () => (historyIndexRef != null ? historyIndexRef.current : -1);
  const draftRef = React.useRef('');
  // Cursor position for left/right arrow navigation in the text input.
  const [cursorPos, setCursorPos] = useState(0);
  const [exitHint, setExitHint] = useState<string | null>(null);
  const exitArmedRef = React.useRef<{ key: 'c' | 'd'; expiresAt: number } | null>(null);
  const [approvalSelection, setApprovalSelection] = useState<'allow' | 'deny'>('allow');
  useEffect(() => {
    if (pendingApproval) setApprovalSelection('allow');
  }, [pendingApproval]);
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);
  const [effortIndex, setEffortIndex] = useState(0);
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [modeIndex, setModeIndex] = useState(0);
  // Thinking toggle: Set of message indices that are expanded (collapsed by default).
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set());
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [size, setSize] = useState({
    rows: stdout?.rows ?? 30,
    cols: stdout?.columns ?? 100,
  });

  useEffect(() => {
    if (!stdout) return;
    const onResize = () =>
      setSize({ rows: stdout.rows ?? 30, cols: stdout.columns ?? 100 });
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  const inputLineCount = inputText.split('\n').length;
  const shellHintRows = inputText.startsWith('!') ? 1 : 0;
  const exitHintRows = exitHint ? 1 : 0;
  const inputRows =
    Math.max(INPUT_BASE_ROWS, inputLineCount) + shellHintRows + exitHintRows;

  const displayMessages = messages;

  useInput((char, key) => {
    // Approval modal has the highest priority — blocks everything else.
    if (pendingApproval) {
      if (char === 'y' || char === 'Y') { onApprovalDecision?.('allow'); return; }
      if (char === 'n' || char === 'N') { onApprovalDecision?.('deny'); return; }
      if (key.escape) { onApprovalDecision?.('deny'); return; }
      if (key.tab || key.leftArrow || key.rightArrow) {
        setApprovalSelection(s => s === 'allow' ? 'deny' : 'allow');
        return;
      }
      if (key.return) { onApprovalDecision?.(approvalSelection); return; }
      return;
    }

    // While the effort picker is open, it captures all input.
    if (effortPickerOpen) {
      if (key.escape) {
        setEffortPickerOpen(false);
        return;
      }
      if (key.tab) {
        const dir = key.shift ? -1 : 1;
        setEffortIndex(i => (i + dir + EFFORT_LEVELS.length) % EFFORT_LEVELS.length);
        return;
      }
      if (key.upArrow) {
        setEffortIndex(i => (i - 1 + EFFORT_LEVELS.length) % EFFORT_LEVELS.length);
        return;
      }
      if (key.downArrow) {
        setEffortIndex(i => (i + 1) % EFFORT_LEVELS.length);
        return;
      }
      if (key.return) {
        const chosen = EFFORT_LEVELS[effortIndex]!;
        onEffortChange?.(chosen);
        setEffortPickerOpen(false);
        return;
      }
      // Ctrl+E toggles the picker closed as well
      if (key.ctrl && char === 'e') {
        setEffortPickerOpen(false);
        return;
      }
      return; // swallow everything else
    }

    // While the mode picker is open, it captures all input.
    if (modePickerOpen) {
      // Ctrl+F closes the picker
      if (key.ctrl && char === 'f') {
        setModePickerOpen(false);
        return;
      }
      if (key.escape) {
        setModePickerOpen(false);
        return;
      }
      if (key.tab) {
        const dir = key.shift ? -1 : 1;
        setModeIndex(i => (i + dir + MODE_LEVELS.length) % MODE_LEVELS.length);
        return;
      }
      if (key.upArrow) {
        setModeIndex(i => (i - 1 + MODE_LEVELS.length) % MODE_LEVELS.length);
        return;
      }
      if (key.downArrow) {
        setModeIndex(i => (i + 1) % MODE_LEVELS.length);
        return;
      }
      if (key.return) {
        const chosen = MODE_LEVELS[modeIndex]!;
        onModeChange?.(chosen);
        setModePickerOpen(false);
        return;
      }
      return;
    }

    // Ctrl+E opens the effort picker.
    if (key.ctrl && char === 'e') {
      const current = EFFORT_LEVELS.indexOf(effort as EffortLevel);
      setEffortIndex(current >= 0 ? current : 0);
      setEffortPickerOpen(true);
      return;
    }

    // Ctrl+F opens the approval mode picker.
    // (Ctrl+M = carriage return byte 0x0D — indistinguishable from Enter)
    if (key.ctrl && char === 'f') {
      const idx = MODE_LEVELS.indexOf(approvalMode as ModeLevel);
      setModeIndex(idx >= 0 ? idx : 0);
      setModePickerOpen(true);
      return;
    }

    if (key.escape) {
      // ESC aborts the in-flight agent turn / shell command but does not
      // quit the app. Use /exit, Ctrl+C×2, or Ctrl+D×2 to exit.
      onInterrupt?.();
      return;
    }

    // Tab cycles tabs, but not while composing a slash command — Tab there
    // should stay available for command completion.
    if (key.tab && !inputText.startsWith('/')) {
      const idx = TAB_IDS.indexOf(currentTab);
      const delta = key.shift ? -1 : 1;
      const next = TAB_IDS[(idx + delta + TAB_IDS.length) % TAB_IDS.length]!;
      setCurrentTab(next);
      return;
    }

    if (currentTab === 'channels' && channels?.length && key.return) {
      // Enter selects the first channel (ChannelsTab manages its own selection)
      const first = channels[0];
      if (first) onChannelSelect?.(first.id);
      return;
    }

    // Ctrl+D twice in quick succession exits. First press arms the sequence
    // and shows a hint; a second Ctrl+D within 1500ms triggers the exit.
    if (key.ctrl && char === 'd') {
      const now = Date.now();
      const armed = exitArmedRef.current;
      if (armed && armed.key === 'd' && now < armed.expiresAt) {
        exit();
        onCancel();
        return;
      }
      exitArmedRef.current = { key: 'd', expiresAt: now + 1500 };
      setExitHint('Press Ctrl+D again to exit');
      setTimeout(() => {
        if (exitArmedRef.current && Date.now() >= exitArmedRef.current.expiresAt) {
          exitArmedRef.current = null;
          setExitHint(null);
        }
      }, 1600);
      return;
    }
    if (key.upArrow) {
      // History navigation (only on assistant tab).
      // Index: 0=oldest, length-1=newest. Up walks toward older (decrement).
      if (currentTab !== 'assistant') return;
      const src = historyArray ?? [];
      if (src.length === 0) return;
      const cur = getHistoryIndex();
      if (cur < 0) {
        // First press: save draft, jump to most recent entry.
        draftRef.current = inputText;
        const idx = src.length - 1;
        setInputText(src[idx] ?? '');
        setCursorPos((src[idx]?.length) ?? 0);
        if (setHistoryIndexFn) setHistoryIndexFn(idx);
      } else if (cur > 0) {
        // Subsequent presses: walk toward older entries.
        const prev = cur - 1;
        setInputText(src[prev] ?? '');
        setCursorPos((src[prev]?.length) ?? 0);
        if (setHistoryIndexFn) setHistoryIndexFn(prev);
      }
      return;
    }
    if (key.downArrow) {
      if (currentTab !== 'assistant') return;
      const cur = getHistoryIndex();
      if (cur < 0) return;
      const src = historyArray ?? [];
      if (cur >= src.length - 1) {
        // Past most recent: restore draft.
        setInputText(draftRef.current);
        setCursorPos(draftRef.current.length);
        if (setHistoryIndexFn) setHistoryIndexFn(-1);
      } else {
        const next = cur + 1;
        setInputText(src[next] ?? '');
        setCursorPos((src[next]?.length) ?? 0);
        if (setHistoryIndexFn) setHistoryIndexFn(next);
      }
      return;
    }
    // Left/right arrow — cursor movement (only in assistant tab text input).
    if (key.leftArrow && currentTab === 'assistant') {
      setCursorPos(Math.max(0, cursorPos - 1));
      return;
    }
    if (key.rightArrow && currentTab === 'assistant') {
      setCursorPos(Math.min(inputText.length, cursorPos + 1));
      return;
    }

    // ctrl+o toggles the last thinking message expand/collapse.
    if (char === 'o' && key.ctrl && currentTab === 'assistant' && !inputText) {
      setExpandedThinking((prev) => {
        const next = new Set(prev);
        const lastThinking = displayMessages.map((m, i) => m.role === 'thinking' ? i : -1).filter(i => i >= 0).pop();
        if (lastThinking !== undefined && lastThinking >= 0) {
          if (next.has(lastThinking)) next.delete(lastThinking);
          else next.add(lastThinking);
        }
        return next;
      });
      return;
    }

    if (key.return) {
      // Shift+Enter, Alt+Enter, or Ctrl+Enter inserts a newline.
      // Requires Kitty keyboard protocol enabled (kittyKeyboard: 'auto' in render options).
      if (key.shift || key.meta || key.ctrl) {
        const c = cursorPos;
        setInputText(prev => prev.slice(0, c) + '\n' + prev.slice(c));
        setCursorPos(c + 1);
        return;
      }
      const text = inputText.trim();
      if (text) {
        setInputText('');
        setCursorPos(0);
        // Record in history, deduping consecutive repeats.
        if (historyArray) {
          if (historyArray[historyArray.length - 1] !== text) {
            historyArray.push(text);
          }
          if (setHistoryIndexFn) setHistoryIndexFn(-1);
        }
        draftRef.current = '';
        if (text.startsWith('!') && onBashCommand) {
          const cmd = text.slice(1).trim();
          if (cmd) onBashCommand(cmd);
          return;
        }
        const parsed = parseSlashCommand(text);
        if (parsed && onSlashCommand) {
          onSlashCommand(parsed);
        } else {
          onSubmit(text);
        }
      }
      return;
    }

    if (key.ctrl && char === 'c') {
      const now = Date.now();
      const armed = exitArmedRef.current;
      if (armed && armed.key === 'c' && now < armed.expiresAt) {
        exit();
        // Trigger the app's onCancel so the host (CLI) can run any cleanup
        // (e.g. restoring the terminal and printing the resume hint) even if
        // Ink would otherwise keep the event loop alive.
        onCancel();
        return;
      }
      exitArmedRef.current = { key: 'c', expiresAt: now + 1500 };
      setExitHint('Press Ctrl+C again to exit');
      setTimeout(() => {
        if (exitArmedRef.current && Date.now() >= exitArmedRef.current.expiresAt) {
          exitArmedRef.current = null;
          setExitHint(null);
        }
      }, 1600);
      return;
    }

    if (key.backspace || key.delete) {
      if (getHistoryIndex() >= 0 && setHistoryIndexFn) {
        setHistoryIndexFn(-1);
      }
      const c = cursorPos;
      setInputText(prev => applyDeletion(prev, c, key.backspace ? 'backspace' : 'delete').text);
      setCursorPos(applyDeletion(inputText, c, key.backspace ? 'backspace' : 'delete').cursor);
      return;
    }

    if (char && !key.ctrl && !key.meta) {
      if (getHistoryIndex() >= 0 && setHistoryIndexFn) {
        setHistoryIndexFn(-1);
      }
      const c = cursorPos;
      setInputText(prev => prev.slice(0, c) + char + prev.slice(c));
      setCursorPos(c + char.length);
      return;
    }
  });

  // Bracketed paste handler: receives pasted text as a single complete string.
  // Gated by the same modal state conditions as useInput.
  const pasteIsActive = !pendingApproval && !effortPickerOpen && !modePickerOpen;
  usePaste(
    (text) => {
      if (!text) return;
      const c = cursorPos;
      setInputText((prev) => prev.slice(0, c) + text + prev.slice(c));
      setCursorPos(c + text.length);
      if (getHistoryIndex() >= 0 && setHistoryIndexFn) {
        setHistoryIndexFn(-1);
      }
    },
    { isActive: pasteIsActive },
  );

  const muted = theme?.muted || '#565f89';
  const primary = theme?.primary || '#7aa2f7';
  const warning = theme?.warning || '#e0af68';
  const success = theme?.success || '#9ece6a';
  const fg = theme?.foreground || '#a9b1d6';
  const bg = theme?.background || '#1a1b26';
  const totalTokens = inputTokens + outputTokens;

  // Settled messages go into <Static> — printed once, never redrawn.
  // Only the last message stays live so the status indicator / duration ticks
  // don't scroll the terminal back down when the user has scrolled up to read history.
  const staticMessages = displayMessages.length > 0 ? displayMessages.slice(0, -1) : [];
  const liveMessages = displayMessages.length > 0 ? displayMessages.slice(-1) : [];

  const renderMessage = (msg: ChatMessage, key: number) => {
    if (msg.role === 'user') {
      const rowWidth = Math.max(1, size.cols - 3);
      const gap = ' ';
      const innerWidth = Math.max(1, rowWidth - gap.length);
      const filler = gap + ' '.repeat(innerWidth);
      const userBg = theme?.userBackground ?? bg;
      const userFg = theme?.userForeground ?? fg;
      return (
        <Box
          key={String(key)}
          flexDirection="column"
          borderStyle="single"
          borderColor={primary}
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          marginTop={1}
          marginBottom={1}
        >
          <Text backgroundColor={userBg}>{filler}</Text>
          {msg.content.split('\n').map((line, li) => {
            const pad = Math.max(0, innerWidth - line.length);
            return (
              <Text key={li} backgroundColor={userBg} color={userFg}>
                {gap + line + ' '.repeat(pad)}
              </Text>
            );
          })}
          <Text backgroundColor={userBg}>{filler}</Text>
        </Box>
      );
    }
    if (msg.role === 'decision') {
      return (
        <Box
          key={String(key)}
          flexDirection="column"
          borderStyle="single"
          borderColor={warning}
          paddingX={1}
          marginY={1}
        >
          {msg.title && (
            <Text color={warning} bold>{msg.title}</Text>
          )}
          <Text color={warning}>{msg.content}</Text>
        </Box>
      );
    }
    if (msg.role === 'tool-group') {
      const tools = msg.content.split(' · ').map(s => s.trim()).filter(Boolean);
      const lines = tools.map((t) => {
        const colonIdx = t.indexOf(':');
        if (colonIdx > 0) {
          return `   ⎿  ${t.slice(0, colonIdx)}: ${t.slice(colonIdx + 1)}`;
        }
        return `   ⎿  ${t}`;
      });
      return (
        <Box key={String(key)} flexDirection="column">
          {lines.map((line, ti) => (
            <Text key={ti} color={muted}>{line}</Text>
          ))}
        </Box>
      );
    }
    if (msg.role === 'tool') {
      return (
        <Box key={String(key)} flexDirection="column" marginTop={1} marginBottom={1}>
          <Box>
            <Text color={success}>{'[✔] '}</Text>
            <Text color={fg}>{msg.content}</Text>
          </Box>
        </Box>
      );
    }
    if (msg.role === 'heartbeat') {
      const lines = msg.content.split('\n');
      return (
        <>
          <Box key={String(key) + '-title'} flexDirection="column" borderStyle="single" borderColor={warning} borderTop={false} borderRight={false} borderBottom={false} marginTop={1}>
            <Text color={success} bold>{' HEARTBEAT: ' + (msg.title ?? '')}</Text>
          </Box>
          {lines.map((line, li) => (
            <Box key={String(key) + '-' + li} flexDirection="column" borderStyle="single" borderColor={warning} borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
              <Text color={fg}>{line}</Text>
            </Box>
          ))}
          <Box key={String(key) + '-sep'} flexDirection="column" marginTop={1}>
            <Text> </Text>
          </Box>
        </>
      );
    }
    if (msg.role === 'task') {
      const lines = msg.content.split('\n');
      return (
        <>
          <Box key={String(key) + '-title'} flexDirection="column" borderStyle="single" borderColor={primary} borderTop={false} borderRight={false} borderBottom={false} marginTop={1}>
            <Text color={primary} bold>{' TASK: ' + (msg.title ?? '')}</Text>
          </Box>
          {lines.map((line, li) => (
            <Box key={String(key) + '-' + li} flexDirection="column" borderStyle="single" borderColor={primary} borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
              <Text color={fg}>{line}</Text>
            </Box>
          ))}
          <Box key={String(key) + '-sep'} flexDirection="column" marginTop={1}>
            <Text> </Text>
          </Box>
        </>
      );
    }
    if (msg.role === 'thinking') {
      const isExpanded = expandedThinking.has(key);
      const lines = msg.content.split('\n');
      const totalChars = msg.content.length;
      return (
        <Box key={String(key)} flexDirection="column" marginTop={1} marginBottom={1}>
          <Text color={fg}>
            {isExpanded ? '▾' : '▸'} Thinking ({totalChars} chars) — ctrl+o to {isExpanded ? 'collapse' : 'expand'}
          </Text>
          {isExpanded && lines.map((line, li) => (
            <Text key={li} color={fg}>{'    ' + line}</Text>
          ))}
        </Box>
      );
    }
      if (msg.role === 'debug') {
      const lines = msg.content.split('\n');
      return (
        <>
          <Box key={String(key) + '-title'} flexDirection="column" borderStyle="single" borderColor={muted} borderTop={false} borderRight={false} borderBottom={false} marginTop={1}>
            <Text color={muted} bold>{' DEBUG: ' + (msg.title ?? '')}</Text>
          </Box>
          {lines.map((line, li) => (
            <Box key={String(key) + '-' + li} flexDirection="column" borderStyle="single" borderColor={muted} borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
              <Text color={muted}>{line}</Text>
            </Box>
          ))}
          <Box key={String(key) + '-sep'} flexDirection="column" marginTop={1}>
            <Text> </Text>
          </Box>
        </>
      );
    }
    if (msg.role === 'context-report') {
      // Rendered from data, not markup — the same event the web dashboard draws
      // with its own component.
      return msg.contextReport
        ? <ContextReport key={String(key)} data={msg.contextReport} theme={theme} />
        : null;
    }
    if (msg.role === 'system') {
      const isReminder = msg.content.startsWith('Curie reminder:');
      if (isReminder) {
        return (
          <Box key={String(key)} flexDirection="column" borderStyle="single" borderColor={warning} borderTop={false} borderRight={false} borderBottom={false} marginLeft={1} marginTop={1} marginBottom={1} paddingX={1}>
            <Text color={muted}>{msg.content}</Text>
          </Box>
        );
      }
      return (
        <Box key={String(key)}>
          <Text color={muted}>{msg.content}</Text>
        </Box>
      );
    }
    return (
      <Box key={String(key)} flexDirection="column" marginLeft={1}>
        <Markdown value={msg.content} foreground={fg} />
      </Box>
    );
  };

  return (
    <Box flexDirection="column" width="100%">
      <TabBar active={currentTab} theme={theme} />
      <Box
        flexDirection="column"
        paddingX={1}
      >
        {currentTab === 'projects' ? (
          <ProjectsTab projects={projects ?? []} theme={theme} isActive={currentTab === 'projects'} onSelectProject={onSelectProject} />
        ) : currentTab === 'stats' ? (
          <StatsTab theme={theme} isActive={currentTab === 'stats'} model={model} inputTokens={inputTokens} outputTokens={outputTokens} cacheReadTokens={cacheReadTokens} contextWindowSize={contextWindowSize} contextUsedTokens={contextUsedTokens} />
        ) : currentTab === 'channels' ? (
          <ChannelsTab channels={channels ?? []} theme={theme} isActive={currentTab === 'channels'} onSelectChannel={onChannelSelect} />
        ) : currentTab === 'agents' ? (
          <AgentsTab agents={agents ?? new Map()} isActive={currentTab === 'agents'} theme={theme} />
        ) : currentTab === 'wiki' ? (
          <WikiTab pages={wikiPages} wikiPath={wikiPath} theme={theme} isActive={currentTab === 'wiki'} />
        ) : (
        <>
        {pendingApproval && (
          <ApprovalPicker
            toolName={pendingApproval.toolName}
            input={pendingApproval.input}
            reason={pendingApproval.reason}
            selected={approvalSelection}
            theme={theme}
          />
        )}
        {!pendingApproval && effortPickerOpen && (
          <EffortPicker selectedIndex={effortIndex} theme={theme} />
        )}
        {!pendingApproval && modePickerOpen && (
          <ModePicker selectedIndex={modeIndex} theme={theme} />
        )}
        {!pendingApproval && !effortPickerOpen && !modePickerOpen && (
          <>
            <Static items={staticMessages}>
              {(msg, idx) => renderMessage(msg, idx)}
            </Static>
            {liveMessages.map((msg, idx) => renderMessage(msg, staticMessages.length + idx))}
          </>
        )}
         </>
        )}
      </Box>

      <Box flexDirection="column" paddingX={1} marginTop={1}>
        {exitHint && (
          <Box>
            <Text color={warning}>{exitHint}</Text>
          </Box>
        )}
        {inputText.startsWith('!') && (
          <Box>
            <Text color={warning}>(shell mode — Enter to run, Shift/Ctrl+Enter for newline)</Text>
          </Box>
        )}
        {(() => {
          const lines = inputText.split('\n');
          const isShell = inputText.startsWith('!');
          const promptColor = isShell ? warning : primary;
          const promptGlyph = isShell ? '$' : '>';
          const prefix = `curie-agent${promptGlyph} `;
          return lines.map((line, li) => {
            const isFirst = li === 0;
            const isLast = li === lines.length - 1;
            const charsBefore = inputText.split('\n').slice(0, li).join('\n').length;
            const cursorOnThisLine = isLast ? cursorPos - charsBefore : 0;
            return (
              <Box key={li}>
                <Text color={promptColor}>
                  {isFirst ? `curie-agent${promptGlyph} ` : '             '}
                </Text>
                {isLast ? (
                  <>
                    <Text color={fg}>{line.slice(0, cursorOnThisLine)}</Text>
                    <Text color={fg} inverse bold>{line[cursorOnThisLine] ?? ' '}</Text>
                    {cursorOnThisLine < line.length - 1 && (
                      <Text color={fg}>{line.slice(cursorOnThisLine + 1)}</Text>
                    )}
                  </>
                ) : (
                  <Text color={fg}>{line}</Text>
                )}
              </Box>
            );
          });
        })()}
      </Box>

      <Footer
        status={status}
        mode={approvalMode}
        effort={effort}
        model={model}
        project={project}
        duration={duration}
        totalTokens={totalTokens}
        costUsd={costUsd}
        activeTab={currentTab}
        theme={theme}
        contextFillPct={contextFillPct}
        contextWindowSize={contextWindowSize}
        contextUsedTokens={contextUsedTokens}
        inputTokens={inputTokens}
        outputTokens={outputTokens}
      />
    </Box>
  );
}

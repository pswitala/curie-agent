# curie-agent

> An open-source, multi-provider AI personal agent.

<h4 align="center">
  <a href="https://github.com/pswitala/curie-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs" alt="Node.js >= 20"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript Strict"></a>
</h4>

---

curie-agent unifies the best ideas from **Claude Code**, **OpenAI Codex CLI**, **openclaw**, and **Karpathy's LLM-wiki** pattern — into a single open-source agent driven by a beautiful terminal UI and an integrated web dashboard.

## Four pillars

| Pillar | Description |
| --- | --- |
| **Everyday Assistant** | Multi-channel gateway (Slack, Telegram, Discord...), voice, cron, webhooks |
| **Coding Agent** | Turn loop, tools, hooks, subagents, MCP, skills, plan mode, approval tiers |
| **Compounding Wiki** | (On the way) Markdown-on-disk knowledge graph with Ingest / Query / Lint workflows |
| **Multi-Session Orchestrator** | (On the way) tmux-like cockpit running N agent sessions in parallel panes |

## Features

- **Multi-provider** — Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama
- **Multi-platform** — CLI TUI with 6 tabs, React web dashboard
- **Safe by default** — Codex-style approval tiers (`plan`, `edit`, `auto`, `yolo`) with path guard, command guard, and git snapshots
- **Thinking streaming** — Real-time thinking-delta events with `Ctrl+O` toggle in TUI
- **Extensible** — MCP client, skills runtime, hooks, subagents, slash commands
- **Memory** — Persistent markdown memory files (wiki engine with SQLite + vector search on the way)
- **Pricing awareness** — Tiered pricing, context fill tracking, cost estimation
- **Open-source** — Apache-2.0, local-first, no cloud SaaS

## CLI

```
curie-agent                              # Start daemon + open web dashboard
curie-agent tui                          # Interactive TUI in current directory
curie-agent "<prompt>"                   # One-shot prompt
curie-agent -p "<prompt>"                # Headless mode, stdout answer
curie-agent -p "<prompt>" --output-format=stream-json  # Streamed JSON events
curie-agent resume [<id>]                # Resume a session
curie-agent continue                     # Resume most recent session
curie-agent daemon start|stop|token      # HTTP daemon management
curie-agent web open|url                 # Open or print dashboard URL
curie-agent wiki init|ingest|query|lint|graph  # Wiki engine
```

### Slash commands

| Command | Description |
|---------|-------------|
| `/status` | Show version, model, provider, mode, tokens, tool limits |
| `/help` | List all available commands |
| `/model <model>` | Switch AI model (aliases: opus, sonnet, haiku, gpt4o, gpt4turbo, o3-mini, o1) |
| `/provider <name>` | Switch provider (anthropic, openai, google, local, ollama, openrouter) |
| `/mode <plan\|edit\|auto\|yolo>` | Set approval mode (legacy values mapped internally) |
| `/theme <name>` | Change color theme |
| `/effort <level>` | Set reasoning effort (low, medium, high, max, auto) |
| `/tools [n] [ws]` | View/set tool call limits per turn |
| `/websearch [count]` | View/set web search limit per turn |
| `/context` | Visual grid showing context window fill level |
| `/context compact` | Compact conversation (summarize) |
| `/context auto` | Auto-compaction config (on/off, threshold %) |
| `/stats` | Switch to Stats tab (daily usage, sessions, streaks) |
| `/debug [on\|off]` | Toggle debug logging |
| `/statusline [on\|off]` | Toggle status line visibility |
| `/agent [--mode m] [--effort e] <prompt>` | Launch external AI agent (spawns claude CLI subprocess) |
| `/remind "<msg at time>"` | Create a reminder |
| `/cron <list\|delete\|clear>` | Manage reminders |
| `/channels <list\|set-bot-token\|...>` | Manage Telegram channel config |
| `/mcp <list\|add\|remove\|reload>` | Manage MCP server connections |
| `/heartbeat <status\|enable\|...>` | Manage heartbeat cycle |
| `/memory [status\|add]` | View memory or capture a note |
| `/todo <action>` | Manage tasks: list, add, complete, cancel, start, remove |
| `/model pricing` | Tiered pricing configuration |
| `/task <create|list|delete>` | Task scheduling |
| `/skill [name]` | List or show available skills |
| `/wiki [page\|search\|lint\|graph]` | Knowledge base management |
| `/system` | Show OS, platform, Node version, PathGuard status (web dashboard) |
| `/init` | Run interactive setup wizard |
| `/snapshots` | List git snapshots |
| `/revert [index]` | Revert to git snapshot |
| `/exit` | Exit curie-agent |

## Quick start

```bash
npx @curie-agent/cli
```

Or install globally:

```bash
npm install -g @curie-agent/cli
curie-agent
```

Run `/init` for interactive provider setup, or set env vars: `MODEL_URL` or `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`.

## Monorepo

curie-agent is built as a **pnpm + Turborepo** monorepo.

| Package | Description |
|---------|-------------|
| `@curie-agent/core` | Event bus, session store, permission engine, turn loop, SettingsManager, CronManager, HeartbeatExecutor/Delivery, TelegramGateway, ChannelRegistry/Router, TaskManager (unified-task with human/agent/notify modes), safety guards, TokenMonitor, SubagentExecutor |
| `@curie-agent/wiki` | Wiki engine: WikiManager (paths, index, log, graph, search, lint), Wiki tool (11 ops), WIKI.md + skill templates, WikiConfig settings |
| `@curie-agent/protocol` | Shared zod schemas for events, JSON-RPC methods, tool definitions |
| `@curie-agent/providers` | Provider interface with Anthropic, OpenAI, Google Gemini, Ollama, OpenRouter adapters |
| `@curie-agent/render` | Rich-style TUI primitives (Panel, Table, Markdown, SyntaxBlock, Progress, Traceback, 8 themes) |
| `@curie-agent/tools` | Read, Edit, Write, Glob, Grep, Bash, Reminder, WebSearch, WebFetch, scheduledTaskTool, todoTool, Skill, spawn_agent |
| `@curie-agent/mcp` | MCP client (stdio transport, tool discovery); server deferred to Phase 3 |
| `@curie-agent/wiki` | Wiki engine: WikiManager (paths, index, log, graph, search, lint), WIKI.md template + skill, WikiConfig settings |
| `@curie-agent/tui` | Ink TUI components: ChatSurface, StatusLine, TabBar (6 tabs), Mascot, 30 slash commands, init wizard, thinking streaming (Ctrl+O) |
| `@curie-agent/cli` | CLI entrypoint (`curie-agent` binary), daemon+web default launch, `curie-agent tui` subcommand, headless mode, multi-provider, session management |
| `@curie-agent/daemon` | JSON-RPC server (30+ RPC methods: session CRUD, config, tools, approvals, cron, heartbeat, MCP, identity, subagents), WebSocket handler, bearer-token auth, channel management |
| `@curie-agent/web` | React + Vite + Tailwind dashboard: ChatView, SubagentsView, AgentsView, ChannelsView, StatsView, ProjectsView, SetupWizard, JSON-RPC + WebSocket client |

```bash
cd app
pnpm install
pnpm turbo build
```

## Architecture

```
  TUI (Ink) — 6 tabs, 30 slash commands, thinking streaming
      |
  Agent Core — turn loop, permission engine, safety guards, SubagentExecutor
      |
  Providers (Anthropic · OpenAI · Gemini · Ollama · OpenRouter)
      |
  Tools (Read · Edit · Write · Glob · Grep · Bash · WebSearch · WebFetch · scheduledTaskTool · todoTool · Skill · spawn_agent)

  @curie-agent/daemon — JSON-RPC + WebSocket server for multi-session orchestration
  @curie-agent/web   — React dashboard consuming the daemon API

  Launch modes: `curie-agent` → daemon + web dashboard  |  `curie-agent tui` → direct TUI (no daemon)
```

*Orchestra features (pane grid, broadcast, diff view, YAML playbooks) are planned for Phase 5.*

## What's implemented

**Phase 0** — Monorepo bootstrap, shared tsconfig, CI, changesets, Zod-typed protocol, Rich-parity render primitives, 8 themes.

**Phase 1** — Provider layer (Anthropic streaming), built-in tools (Read, Edit, Write, Glob, Grep, Bash), permission engine with approval prompts, Ink TUI with status line + scrollback, theming, mascot banner, CLI entrypoint, session save/resume, headless mode, session management.

**Phase 1.a** — 26 slash commands, TUI with 5 tabs (assistant, channels, stats, projects, agents), /init interactive setup wizard (later extended to 30 slash commands + wiki tab), effort/mode/approval pickers, MCP client (stdio), Telegram Gateway, Channel Registry/Router, CronManager, HeartbeatExecutor/Delivery, SettingsManager (persisted to `~/.curie-settings.json`), thinking streaming (Ctrl+O toggle), pricing tiering (`/model pricing`, cumulative cost tracking), `/task` command (TaskManager), unified task system (human/agent/notify modes with backward-compatible CronManager migration).

**Phase 2** — OpenAI, Google Gemini, Ollama, OpenRouter provider adapters. Safety: path guard, command guard, git snapshots, approval tiers enforcement. TokenMonitor (context fill %, pricing tier alerts), tiered pricing format with cost estimation.

**Phase 3** — Skills runtime: Claude-Code-compatible `~/.curie-agent/skills/<name>/SKILL.md` discovery, frontmatter parsing, system prompt injection, `Skill` tool, `/skill` slash command. Subagents: SubagentExecutor (in-process TurnLoop instances), spawn_agent tool, daemon RPC methods (spawn/list/cancel/stats/send), agent-* WebSocket events, TUI AgentsTab, Web SubagentsView, /agent slash command handler.

**Phase 4 (daemon + web)** — Daemon: JSON-RPC server with 35+ methods, WebSocket event forwarding, bearer-token auth, channel management, static file serving. Web dashboard: React + Vite + Tailwind with chat, subagent management, stats, channels, projects, wiki (WikiView + WikiGraphView), kanban, command palette, PWA support. CLI defaults to daemon+web launch, with `curie-agent tui` for TUI mode.

**Phase 4 (wiki engine)** — `@curie-agent/wiki` package: WikiManager (paths, index, log, graph, search, deterministic lint), `Wiki` tool (11 ops), `WIKI.md` + skill templates, WikiConfig settings, protocol `wiki.ingest/lint/graph` + WikiEvent, CLI verbs `wiki init/ingest/query/lint/graph`, `/wiki` TUI slash command, wiki tab in TUI.

## What's next

1. **Hooks** — pre/post ToolUse, UserPrompt, Stop, Compact, SessionStart, ChannelMessage (unblocks Plugin API)
2. **Plugin API** — npm packages exporting `curie-agent-plugin` entrypoint (tools, providers, hooks, TUI panels)
3. **Subagent sandboxing** — `.curie-agent/agents/*.md` file format + git worktree isolation
4. **Orchestra** — blessed pane grid, broadcast mode, queue/scheduler, YAML playbook runner (Phase 5)
5. **Web E2E tests** — Playwright tests for critical paths (chat session, setup wizard, stats view)

## Tech stack

- **Runtime**: Node.js ≥ 20, TypeScript (strict)
- **Monorepo**: pnpm + Turborepo
- **TUI**: Ink (React for CLIs)
- **Storage**: better-sqlite3 + sqlite-vec (planned)
- **Schema/IPC**: zod + JSON-RPC 2.0
- **Tests**: vitest (38 test files across 11 packages)

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.

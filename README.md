# curie-agent

> An open-source, multi-provider AI personal agent.

<h4 align="center">
  <a href="https://github.com/pswitala/curie-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs" alt="Node.js >= 20"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript Strict"></a>
</h4>

---

curie-agent unifies the best ideas from **Claude Code**, **OpenAI Codex CLI**, **openclaw**, and **Karpathy's LLM-wiki** pattern — into a single open-source agent driven by a beautiful webui and terminal.

## Four pillars

| Pillar | Description |
| --- | --- |
| **Everyday Assistant** | Multi-channel gateway (Slack, Telegram, Discord...), voice, cron, webhooks |
| **Coding Agent** | Turn loop, tools, hooks, subagents, MCP, skills, plan mode, approval tiers |
| **Compounding Wiki** | Markdown-on-disk knowledge graph with Ingest / Query / Lint workflows |
| **Multi-Session Orchestrator** | (On the way) tmux-like cockpit running N agent sessions in parallel panes |

## Features

- **Multi-provider** — Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama
- **Multi-platform** — CLI TUI with 6 tabs, React web dashboard
- **Safe by default** — Codex-style approval tiers (`plan`, `edit`, `auto`, `yolo`) with path guard, command guard, harm-check tool digest, and git snapshots
- **Thinking streaming** — Real-time thinking-delta events with `Ctrl+O` toggle in TUI
- **Context management** — Automatic and manual compaction with configurable warn / auto / forced thresholds
- **Durable scheduling** — One task store for todos, reminders, and autonomous agent tasks. Nothing is ever auto-deleted, writes are atomic, and every writer shares one instance
- **Inline charts** — `Chart` tool renders line, area, bar, stacked-bar, and scatter plots in the web chat pane
- **Extensible** — MCP client, skills runtime, subagents, slash commands
- **Memory** — Persistent markdown memory files (wiki engine with SQLite + vector search on the way)
- **Pricing awareness** — Tiered pricing, context fill tracking, cost estimation
- **Open-source** — Apache-2.0, local-first, no cloud SaaS

## CLI

```
curie-agent                              # Start daemon + open web dashboard (default)
curie-agent tui                          # Interactive TUI (thin JSON-RPC client)
curie-agent daemon start|stop|token      # HTTP daemon management (port 3457)
curie-agent web open|url                 # Open or print dashboard URL
curie-agent wiki init|ingest|query|lint|graph  # Wiki engine
curie-agent sessions list|show|rm        # Session management
curie-agent --version | --help
```

`curie-agent tui` additionally accepts `--model <name>`, `--approval-mode <mode>`, and `--cwd <path>`.

> **Note:** headless mode (`-p`) and `resume` / `continue` are not wired up yet — see [What's next](#whats-next).

### Slash commands

30 commands, defined in `@curie-agent/protocol` (`slash-commands.ts`) — a single registry that both the CLI and the daemon import, so `/help` can never drift from what is actually implemented.

| Command | Description |
|---------|-------------|
| `/status` | Show version, model, and account info |
| `/help` | Show all available commands |
| `/system` | Show OS, platform, Node version, and PathGuard status |
| `/init` | Run the setup wizard |
| `/exit` | Exit curie-agent |
| `/provider <anthropic\|openai\|google\|local\|ollama\|openrouter>` | Switch AI provider |
| `/model <model\|pricing in;out\|window tokens>` | Switch AI model, set pricing or context window |
| `/effort <low\|medium\|high\|max\|auto>` | Set reasoning effort level |
| `/mode <plan\|edit\|auto\|yolo>` | Set approval mode |
| `/theme <name>` | Change color theme |
| `/debug [on\|off]` | Toggle debug logging |
| `/statusline [on\|off]` | Toggle status line display |
| `/memory [status\|add]` | View memory file sizes or capture a memory |
| `/todo <list\|add\|complete\|cancel\|start\|remove>` | Manage tasks in `tasks.json` (accepts 8-char ID prefixes) |
| `/stats` | Daily usage, sessions, streaks |
| `/context [auto\|messages\|compact [detailed\|brief]]` | Context window grid, compaction, auto-compaction config |
| `/wiki [list\|search <query>\|lint\|status]` | Open the wiki tab or run a wiki operation |
| `/remind <message at time>` | Create a reminder (natural-language time parsing) |
| `/cron <list\|delete <id>\|clear>` | Manage reminders |
| `/task <create\|list\|delete>` | Schedule an autonomous agent task |
| `/heartbeat <status\|enable\|disable\|intraday\|daily\|weekly\|monthly\|dreaming\|now>` | Manage heartbeat cycle |
| `/agent <prompt>` | Spawn an in-process subagent (streams to the Agents tab) |
| `/tools [tools_per_call [websearch_per_call]]` | View/set tool call limits per turn |
| `/websearch [count]` | View/set web search+fetch limit per turn |
| `/mcp <list\|reload>` | Manage MCP server connections |
| `/skill [name]` | List or show available skills |
| `/channels <list\|switch\|set-bot-token\|set-user-id\|set-chat-id\|disconnect>` | Manage Telegram channel config |
| `/cd <path>` | Change working directory with safety checks |
| `/snapshots` | List recent git snapshots for recovery |
| `/revert [index]` | Revert to a git snapshot |

## Tasks and scheduling

Todos, reminders, and autonomous agent tasks are one model — `UnifiedTask` in
`~/.curie-agent/tasks.json` (or `<cwd>/tasks.json` for project scope), discriminated by `mode`:

| `mode` | What it is | Who runs it | Created by |
|--------|-----------|-------------|-----------|
| `human` | A todo-list item | You | `/todo add`, the `Todo` tool, the web Kanban board |
| `notify` | A reminder notification | Scheduler → event + Telegram | `/remind`, the `CreateReminder` tool |
| `agent` | An instruction the LLM executes unattended | Scheduler → subagent | `/task create`, the `CreateScheduledTask` tool |
| `agent` + `frequency` | A recurring heartbeat | Scheduler → `HeartbeatExecutor` | `/heartbeat` |

A 60-second checker in the daemon fires anything `pending` whose `scheduled_at` has passed.
Agent tasks run in their own session with their own turn loop, then report the outcome back over
Telegram and as a `cron-task-fired` event. Recurring schedules use `intraday` (`7:55,9:55,…`),
`daily` (`7:15`), `weekly` (`friday@21:00`), `monthly` (`1@6:50`), and `dreaming` (`23:01`) forms.

Design guarantees, all covered by tests in `packages/core/src/task-manager.test.ts`:

- **Nothing is deleted automatically.** Only `/todo remove`, `/cron delete`, and `/cron clear` drop a task.
- **One writer per process.** `getTaskManager()` returns a shared instance per store path; every
  mutation reloads the file if another process touched it, then writes via temp-file + rename.
- **No past-dated reminders.** The time parser rolls a time that has already passed forward, and
  returns an error rather than guessing when it can't read the input.
- **Legacy stores are repaired, not reinterpreted.** `repairTaskShapes()` renames known legacy
  modes and backfills missing fields on startup; anything it doesn't recognise is reported and
  left alone.

## Quick start

```bash
npx @curie-agent/cli
```

Or install globally:

```bash
npm install -g @curie-agent/cli
curie-agent
```

Run `/init` for interactive provider setup, or set env vars: `MODEL_URL` / `MODEL_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_URL`, `OPENAI_API_KEY`, `OPENAI_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_URL`. To enable `WebSearch`, set `brave_search_api_key` in settings (no env var equivalent).

Settings live in `~/.curie-settings.json`; identity files, skills, and the wiki live under `~/.curie-agent/`.

## Monorepo

curie-agent is built as a **pnpm + Turborepo** monorepo of 11 packages.

| Package | Description |
|---------|-------------|
| `@curie-agent/core` | Event bus, session store, permission engine, turn loop, SettingsManager, HeartbeatExecutor/Delivery, TelegramGateway, ChannelRegistry/Router, TaskManager (unified-task store with human/agent/notify modes, process-shared via `getTaskManager()`, atomic writes, no auto-deletion), safety guards, TokenMonitor, SubagentExecutor, context-window management, identity templates |
| `@curie-agent/wiki` | Wiki engine: WikiManager (paths, index, log, graph, search, lint), Wiki tool (11 ops), WIKI.md + skill templates, WikiConfig settings |
| `@curie-agent/protocol` | Shared zod schemas for events, JSON-RPC methods, tool definitions |
| `@curie-agent/providers` | Provider interface with Anthropic, OpenAI, Google Gemini, Ollama, OpenRouter adapters |
| `@curie-agent/render` | Rich-style TUI primitives (Panel, Table, Markdown, SyntaxBlock, Progress, Traceback, 8 themes) |
| `@curie-agent/tools` | 15 statically registered tools: Read, Edit, Write, Glob, Grep, Bash, CreateReminder, CreateScheduledTask, WebSearch, WebFetch, Skill, Todo, Wiki, Chart, SendMessage — plus `spawn_agent`, wired in by the daemon via `createSpawnAgentTool` (it needs the SubagentExecutor) |
| `@curie-agent/mcp` | MCP client (stdio, SSE, and streamable-HTTP transports, tool discovery); server mode not yet implemented |
| `@curie-agent/tui` | Ink TUI components: ChatSurface, StatusLine, TabBar (6 tabs), Mascot, slash-command parser (registry lives in `protocol`), init wizard, thinking streaming (Ctrl+O) |
| `@curie-agent/cli` | CLI entrypoint (`curie-agent` binary), daemon+web default launch, `curie-agent tui` subcommand, wiki/session/daemon verbs, multi-provider setup |
| `@curie-agent/daemon` | JSON-RPC server (41 methods: session CRUD, config, tools, approvals, cron, heartbeat, MCP, identity, subagents, wiki, todo, orchestra stubs), WebSocket handler, bearer-token auth, channel management, automatic compaction |
| `@curie-agent/web` | React + Vite + Tailwind dashboard: ChatView, SubagentsView, AgentsView, ChannelsView, StatsView, ProjectsView, WikiView, WikiGraphView, KanbanView, SetupWizard, CommandPalette, chart components, JSON-RPC + WebSocket client, PWA support |

```bash
cd app
pnpm install
pnpm turbo build
```

## Architecture

```
  Web (React dashboard) / TUI (Ink, 6 tabs, 30 slash commands, thinking streaming)
  ↓
  Daemon (JSON-RPC + WebSocket, 41 methods, bearer-token auth, port 3457)
  │ └─ Scheduler (60s tick) → reminders · agent tasks · heartbeats
  ↓
  Agent Core — turn loop, permission engine, safety guards, TaskManager,
               SubagentExecutor (spawn_agent)
  ↓
  Providers (Anthropic · OpenAI · Gemini · Ollama · OpenRouter)
  ↓
  Tools (Read · Edit · Write · Glob · Grep · Bash · WebSearch · WebFetch · CreateReminder
         · CreateScheduledTask · Skill · Todo · Wiki · Chart · SendMessage · spawn_agent)
```

*Orchestra features (pane grid, broadcast, diff view, YAML playbooks) are stubs returning `not-implemented`; planned for Phase 5.*

## What's implemented

**Phase 0** — Monorepo bootstrap, shared tsconfig, CI, changesets, Zod-typed protocol, Rich-parity render primitives, 8 themes.

**Phase 1** — Provider layer (Anthropic streaming), built-in tools (Read, Edit, Write, Glob, Grep, Bash), permission engine with approval prompts, Ink TUI with status line + scrollback, theming, mascot banner, CLI entrypoint, session save/resume, session management.

**Phase 1.a** — 30 slash commands, TUI with 6 tabs (assistant, channels, stats, projects, agents, wiki), `/init` interactive setup wizard, effort/mode/approval pickers, MCP client (stdio / SSE / streamable-HTTP), Telegram Gateway, Channel Registry/Router, HeartbeatExecutor/Delivery, SettingsManager (persisted to `~/.curie-settings.json`, with legacy flat→nested migration), thinking streaming (Ctrl+O toggle), pricing tiering (`/model pricing`, cumulative cost tracking), `/task` command, unified task system (human/agent/notify modes, migrated from the earlier separate `todo.json` + `cron.json` stores).

**Scheduling hardening** — The task store is now single-writer per process (`getTaskManager()`) with reload-before-mutate and atomic temp-file + rename writes, so the daemon, tools, and RPC handlers can no longer overwrite each other's changes. Automatic pruning is gone: an open todo is never deleted by age. `repairTaskShapes()` migrates legacy `mode:'auto'` tasks and lifts scheduled tasks out of statuses the scheduler could never see. Agent tasks now settle on `completed`/`failed` and report their result to Telegram instead of finishing silently. See `plans/fancy-watching-plum.md` for the full audit and rationale.

**Phase 2** — OpenAI, Google Gemini, Ollama, OpenRouter provider adapters (with OpenRouter sticky `provider_order` routing and per-provider `max_output_tokens`). Safety: path guard, command guard, harm-check tool digest, git snapshots, approval tiers enforcement. TokenMonitor (context fill %, pricing tier alerts), tiered pricing format with cost estimation.

**Phase 3** — Skills runtime: Claude-Code-compatible `~/.curie-agent/skills/<name>/SKILL.md` discovery, frontmatter parsing, system prompt injection, `Skill` tool, `/skill` slash command. Subagents: SubagentExecutor (in-process TurnLoop instances), `spawn_agent` tool, daemon RPC methods (spawn/list/cancel/stats/send), `agent-*` WebSocket events, TUI AgentsTab, Web SubagentsView, `/agent` slash command handler.

**Phase 4 (daemon + web)** — Daemon: JSON-RPC server with 41 methods, WebSocket event forwarding, bearer-token auth, channel management, static file serving, automatic context compaction with configurable thresholds. Web dashboard: React + Vite + Tailwind with chat, inline charts, subagent management, stats, channels, projects, wiki (WikiView + WikiGraphView), kanban, command palette, PWA support with version-update notifications. CLI defaults to daemon+web launch, with `curie-agent tui` for TUI mode.

**Phase 4 (wiki engine)** — `@curie-agent/wiki` package: WikiManager (paths, index, log, graph, search, deterministic lint), `Wiki` tool (11 ops), `WIKI.md` + skill templates, WikiConfig settings, protocol `wiki.ingest/lint/graph` + WikiEvent, CLI verbs `wiki init/ingest/query/lint/graph`, `/wiki` TUI slash command, wiki tab in TUI.

## What's next

1. **Headless mode** — `-p`, `--output-format=stream-json`, and `resume` / `continue` are parsed by the CLI but not dispatched; they currently fall through to the default daemon+browser launch. Needs wiring in `main()` (`packages/cli/src/cli.tsx`), including equals-form flag parsing.
2. **Hooks** — pre/post ToolUse, UserPrompt, Stop, Compact, SessionStart, ChannelMessage (unblocks Plugin API)
3. **Plugin API** — npm packages exporting `curie-agent-plugin` entrypoint (tools, providers, hooks, TUI panels)
4. **MCP server mode** — expose curie-agent as an MCP server so other agents can call curie-agent tools, wiki, and sessions
5. **Subagent sandboxing** — `.curie-agent/agents/*.md` file format + git worktree isolation
6. **Orchestra** — blessed pane grid, broadcast mode, queue/scheduler, YAML playbook runner (Phase 5)
7. **Wiki storage** — swap markdown-only indexing for better-sqlite3 + sqlite-vec vector search

## Tech stack

- **Runtime**: Node.js ≥ 20, TypeScript (strict)
- **Monorepo**: pnpm + Turborepo
- **TUI**: Ink (React for CLIs)
- **Web**: React 19 + Vite + Tailwind
- **Storage**: markdown-on-disk + JSONL sessions today; better-sqlite3 + sqlite-vec planned (not yet a dependency)
- **Schema/IPC**: zod + JSON-RPC 2.0 + WebSocket
- **Tests**: vitest (61 test files, 1011 tests across 11 packages)

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.

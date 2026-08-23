# @curie-agent/mcp

## 0.4.3

### Patch Changes

- Version bump for the 0.4.3 release. No functional changes in this package.

## 0.4.2

### Patch Changes

- Fix slash commands, their output, and MCP connection status.

  **Slash commands now have a single source of truth.** The command registry moved to
  `@curie-agent/protocol`, with each entry declaring `handler: 'client' | 'daemon'`.
  Previously three separate implementations had drifted apart, and the most complete
  one (in `@curie-agent/tui`) was never called at runtime.
  - Daemon slash-command output was silently discarded in the terminal UI. The
    `assistant-delta` gate required a `session-start` event that the slash path never
    emits, so `/todo`, `/task`, `/cd` and `/agent` produced no visible output at all.
  - 12 registered commands reported "Unknown command" in the TUI and now work:
    `/context`, `/memory`, `/mcp`, `/skill`, `/tools`, `/websearch`, `/provider`,
    `/snapshots`, `/revert`, `/statusline`, `/stats`, `/channels`.
  - `/remind` always printed "Reminder feature coming soon" because a duplicate
    `case` shadowed the real handler.
  - `/model pricing` and `/model window` now work in the TUI; the previous local-only
    handler silently swallowed subcommands.
  - `/help` is generated from the shared registry, so it can no longer drift.
  - `/status` reported a hardcoded version `0.2.4`; it now reads the real version.
  - `/debug` persisted the setting without updating the UI, so output verbosity never
    actually changed. Bare `/debug` now toggles.
  - `/mcp` reported every configured server as disconnected with no tools, even while
    those tools worked. `DaemonApp.mcpStatus` was declared but never populated; it is
    now filled from the live MCP clients. Servers with no recorded status render as
    unknown rather than falsely reporting a failure.
  - Backspace at column 0 duplicated the input buffer (`abc` became `ababc`).
  - The `TabBar` component was exported but never rendered; it is now visible, and
    Tab no longer switches tabs while a slash command is being typed.

- Updated dependencies []:
  - @curie-agent/core@0.4.2
  - @curie-agent/tools@0.4.2

## 0.3.9

### Patch Changes

- Shrink the LLM harm-check prompt: send a tool-input digest instead of the raw payload.

  `TurnLoop.evaluateHarm()` inlined `JSON.stringify(input)` into every harm-check request, so a
  `Write` shipped the entire file body, `Edit` shipped both patch strings, and `Bash` shipped the
  whole script to the provider on every tool call in `auto` mode.

  New `summarizeToolInput()` (`@curie-agent/core/safety/tool-digest.js`) renders the tool call
  compactly instead: high-signal fields (`command`, `file_path`, `path`, `url`, `pattern`, `glob`,
  `prompt`) are preserved, bulk fields are reduced to a head sample plus a `…[N chars total]`
  marker, and the whole digest is capped. Large `Write`/`Edit` harm-checks drop by roughly 50x in
  input tokens.

  Safety is unchanged: the path guard still runs inside each tool's `execute()` and the command
  guard still runs in `PermissionEngine`, both against the full, untruncated input. The harm-check
  system prompt now tells the evaluator that long values are abbreviated so it does not fail closed
  on missing detail.

- Updated dependencies []:
  - @curie-agent/core@0.3.9
  - @curie-agent/tools@0.3.9

## 0.3.8

### Patch Changes

- Patch release 0.3.8.

- Updated dependencies []:
  - @curie-agent/core@0.3.8
  - @curie-agent/tools@0.3.8

## 0.3.7

### Patch Changes

- Patch release 0.3.7.

- Updated dependencies []:
  - @curie-agent/core@0.3.7
  - @curie-agent/tools@0.3.7

## 0.3.6

### Patch Changes

- Preload identity context (`SOUL.md`, `USER.md`, `MEMORY.md`) into the cached system prompt alongside `AGENTS.md`, configurable via a new `system_prompt_files` setting, to avoid the latency of the agent reading these files itself via tools on every session start.

- Updated dependencies []:
  - @curie-agent/core@0.3.6
  - @curie-agent/tools@0.3.6

## 0.3.5

### Patch Changes

- Fix prompt-cache invalidation caused by a per-turn timestamp injected at the front of the system prompt. Add explicit Anthropic cache breakpoints (system, tools, sliding message-history breakpoint), cache-token read-back across the OpenAI, Google, and OpenRouter adapters, and surface cache-hit stats in the TUI Stats tab and daemon totals.

- Updated dependencies []:
  - @curie-agent/core@0.3.5
  - @curie-agent/tools@0.3.5

## 0.3.4

### Patch Changes

- Add OpenRouter sticky-session routing (`session_id`) and prompt-cache support (`cache_control`, cache usage reporting) to reduce token costs on multi-turn conversations.

- Updated dependencies []:
  - @curie-agent/core@0.3.4
  - @curie-agent/tools@0.3.4

## 0.2.5

### Patch Changes

- Collapsible agent actions wrapper for web dashboard — groups thinking, tool calls, and approvals into a single collapsible block per turn

- Updated dependencies []:
  - @curie-agent/core@0.2.5
  - @curie-agent/tools@0.2.5

## 0.2.1

### Patch Changes

- Patch release to 0.2.1

- Updated dependencies []:
  - @curie-agent/core@0.2.1
  - @curie-agent/tools@0.2.1

## 0.2.0

### Minor Changes

- Feature release: v0.2.0

### Patch Changes

- Updated dependencies []:
  - @curie-agent/core@0.2.0
  - @curie-agent/tools@0.2.0

## 0.2.4

### Patch Changes

- Version bump to 0.2.4

- Updated dependencies []:
  - @curie-agent/core@0.2.4
  - @curie-agent/tools@0.2.4

## 0.2.3

### Patch Changes

- Fix workspace:\* dependency references for npm installs

- Updated dependencies []:
  - @curie-agent/core@0.2.3
  - @curie-agent/tools@0.2.3

## 0.2.2

### Patch Changes

- Routine patch release

- Updated dependencies []:
  - @curie-agent/core@0.2.2
  - @curie-agent/tools@0.2.2

## 0.2.1

### Patch Changes

- chore: release v0.2.1

- Updated dependencies []:
  - @curie-agent/core@0.2.1
  - @curie-agent/tools@0.2.1

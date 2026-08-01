# @curie-agent/cli

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
  - @curie-agent/protocol@0.3.9
  - @curie-agent/providers@0.3.9
  - @curie-agent/render@0.3.9
  - @curie-agent/core@0.3.9
  - @curie-agent/tools@0.3.9
  - @curie-agent/wiki@0.3.9
  - @curie-agent/mcp@0.3.9
  - @curie-agent/tui@0.3.9
  - @curie-agent/daemon@0.3.9

## 0.3.8

### Patch Changes

- Patch release 0.3.8.

- Updated dependencies []:
  - @curie-agent/core@0.3.8
  - @curie-agent/daemon@0.3.8
  - @curie-agent/mcp@0.3.8
  - @curie-agent/protocol@0.3.8
  - @curie-agent/providers@0.3.8
  - @curie-agent/render@0.3.8
  - @curie-agent/tools@0.3.8
  - @curie-agent/tui@0.3.8
  - @curie-agent/wiki@0.3.8

## 0.3.7

### Patch Changes

- Patch release 0.3.7.

- Updated dependencies []:
  - @curie-agent/core@0.3.7
  - @curie-agent/daemon@0.3.7
  - @curie-agent/mcp@0.3.7
  - @curie-agent/protocol@0.3.7
  - @curie-agent/providers@0.3.7
  - @curie-agent/render@0.3.7
  - @curie-agent/tools@0.3.7
  - @curie-agent/tui@0.3.7
  - @curie-agent/wiki@0.3.7

## 0.3.6

### Patch Changes

- Preload identity context (`SOUL.md`, `USER.md`, `MEMORY.md`) into the cached system prompt alongside `AGENTS.md`, configurable via a new `system_prompt_files` setting, to avoid the latency of the agent reading these files itself via tools on every session start.

- Updated dependencies []:
  - @curie-agent/core@0.3.6
  - @curie-agent/daemon@0.3.6
  - @curie-agent/mcp@0.3.6
  - @curie-agent/protocol@0.3.6
  - @curie-agent/providers@0.3.6
  - @curie-agent/render@0.3.6
  - @curie-agent/tools@0.3.6
  - @curie-agent/tui@0.3.6
  - @curie-agent/wiki@0.3.6

## 0.3.5

### Patch Changes

- Fix prompt-cache invalidation caused by a per-turn timestamp injected at the front of the system prompt. Add explicit Anthropic cache breakpoints (system, tools, sliding message-history breakpoint), cache-token read-back across the OpenAI, Google, and OpenRouter adapters, and surface cache-hit stats in the TUI Stats tab and daemon totals.

- Updated dependencies []:
  - @curie-agent/core@0.3.5
  - @curie-agent/daemon@0.3.5
  - @curie-agent/mcp@0.3.5
  - @curie-agent/protocol@0.3.5
  - @curie-agent/providers@0.3.5
  - @curie-agent/render@0.3.5
  - @curie-agent/tools@0.3.5
  - @curie-agent/tui@0.3.5
  - @curie-agent/wiki@0.3.5

## 0.3.4

### Patch Changes

- Add OpenRouter sticky-session routing (`session_id`) and prompt-cache support (`cache_control`, cache usage reporting) to reduce token costs on multi-turn conversations.

- Updated dependencies []:
  - @curie-agent/core@0.3.4
  - @curie-agent/daemon@0.3.4
  - @curie-agent/mcp@0.3.4
  - @curie-agent/protocol@0.3.4
  - @curie-agent/providers@0.3.4
  - @curie-agent/render@0.3.4
  - @curie-agent/tools@0.3.4
  - @curie-agent/tui@0.3.4
  - @curie-agent/wiki@0.3.4

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @curie-agent/daemon@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @curie-agent/daemon@0.3.1

## 0.2.5

### Patch Changes

- Collapsible agent actions wrapper for web dashboard — groups thinking, tool calls, and approvals into a single collapsible block per turn

- Updated dependencies []:
  - @curie-agent/core@0.2.5
  - @curie-agent/protocol@0.2.5
  - @curie-agent/providers@0.2.5
  - @curie-agent/tools@0.2.5
  - @curie-agent/mcp@0.2.5
  - @curie-agent/render@0.2.5
  - @curie-agent/tui@0.2.5
  - @curie-agent/daemon@0.2.5

## 0.2.1

### Patch Changes

- Patch release to 0.2.1

- Updated dependencies []:
  - @curie-agent/core@0.2.1
  - @curie-agent/mcp@0.2.1
  - @curie-agent/protocol@0.2.1
  - @curie-agent/providers@0.2.1
  - @curie-agent/render@0.2.1
  - @curie-agent/tools@0.2.1
  - @curie-agent/tui@0.2.1

## 0.2.0

### Minor Changes

- Feature release: v0.2.0

### Patch Changes

- Updated dependencies []:
  - @curie-agent/core@0.2.0
  - @curie-agent/mcp@0.2.0
  - @curie-agent/protocol@0.2.0
  - @curie-agent/providers@0.2.0
  - @curie-agent/render@0.2.0
  - @curie-agent/tools@0.2.0
  - @curie-agent/tui@0.2.0

## 0.2.4

### Patch Changes

- Version bump to 0.2.4

- Updated dependencies []:
  - @curie-agent/core@0.2.4
  - @curie-agent/mcp@0.2.4
  - @curie-agent/protocol@0.2.4
  - @curie-agent/providers@0.2.4
  - @curie-agent/render@0.2.4
  - @curie-agent/tools@0.2.4
  - @curie-agent/tui@0.2.4

## 0.2.3

### Patch Changes

- Fix workspace:\* dependency references for npm installs

- Updated dependencies []:
  - @curie-agent/core@0.2.3
  - @curie-agent/mcp@0.2.3
  - @curie-agent/protocol@0.2.3
  - @curie-agent/providers@0.2.3
  - @curie-agent/render@0.2.3
  - @curie-agent/tools@0.2.3
  - @curie-agent/tui@0.2.3

## 0.2.2

### Patch Changes

- Routine patch release

- Updated dependencies []:
  - @curie-agent/core@0.2.2
  - @curie-agent/mcp@0.2.2
  - @curie-agent/protocol@0.2.2
  - @curie-agent/providers@0.2.2
  - @curie-agent/render@0.2.2
  - @curie-agent/tools@0.2.2
  - @curie-agent/tui@0.2.2

## 0.2.1

### Patch Changes

- chore: release v0.2.1

- Updated dependencies []:
  - @curie-agent/protocol@0.2.1
  - @curie-agent/core@0.2.1
  - @curie-agent/render@0.2.1
  - @curie-agent/tools@0.2.1
  - @curie-agent/mcp@0.2.1
  - @curie-agent/providers@0.2.1
  - @curie-agent/tui@0.2.1

## 0.5.1

### Patch Changes

- Include templates/ directory in published package so MD files are available after npm install

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @curie-agent/core@0.2.0
  - @curie-agent/protocol@0.2.0
  - @curie-agent/providers@0.2.0
  - @curie-agent/render@0.2.0
  - @curie-agent/tools@0.2.0
  - @curie-agent/tui@0.1.1

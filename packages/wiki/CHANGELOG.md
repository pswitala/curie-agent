# @curie-agent/wiki

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

## 0.3.8

### Patch Changes

- Patch release 0.3.8.

- Updated dependencies []:
  - @curie-agent/core@0.3.8

## 0.3.7

### Patch Changes

- Patch release 0.3.7.

- Updated dependencies []:
  - @curie-agent/core@0.3.7

## 0.3.6

### Patch Changes

- Preload identity context (`SOUL.md`, `USER.md`, `MEMORY.md`) into the cached system prompt alongside `AGENTS.md`, configurable via a new `system_prompt_files` setting, to avoid the latency of the agent reading these files itself via tools on every session start.

- Updated dependencies []:
  - @curie-agent/core@0.3.6

## 0.3.5

### Patch Changes

- Fix prompt-cache invalidation caused by a per-turn timestamp injected at the front of the system prompt. Add explicit Anthropic cache breakpoints (system, tools, sliding message-history breakpoint), cache-token read-back across the OpenAI, Google, and OpenRouter adapters, and surface cache-hit stats in the TUI Stats tab and daemon totals.

- Updated dependencies []:
  - @curie-agent/core@0.3.5

## 0.3.4

### Patch Changes

- Add OpenRouter sticky-session routing (`session_id`) and prompt-cache support (`cache_control`, cache usage reporting) to reduce token costs on multi-turn conversations.

- Updated dependencies []:
  - @curie-agent/core@0.3.4

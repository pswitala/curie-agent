# @curie-agent/wiki

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

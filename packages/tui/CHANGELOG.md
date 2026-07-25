# @curie-agent/tui

## 0.3.7

### Patch Changes

- Patch release 0.3.7.

- Updated dependencies []:
  - @curie-agent/core@0.3.7
  - @curie-agent/protocol@0.3.7
  - @curie-agent/render@0.3.7

## 0.3.6

### Patch Changes

- Preload identity context (`SOUL.md`, `USER.md`, `MEMORY.md`) into the cached system prompt alongside `AGENTS.md`, configurable via a new `system_prompt_files` setting, to avoid the latency of the agent reading these files itself via tools on every session start.

- Updated dependencies []:
  - @curie-agent/core@0.3.6
  - @curie-agent/protocol@0.3.6
  - @curie-agent/render@0.3.6

## 0.3.5

### Patch Changes

- Fix prompt-cache invalidation caused by a per-turn timestamp injected at the front of the system prompt. Add explicit Anthropic cache breakpoints (system, tools, sliding message-history breakpoint), cache-token read-back across the OpenAI, Google, and OpenRouter adapters, and surface cache-hit stats in the TUI Stats tab and daemon totals.

- Updated dependencies []:
  - @curie-agent/core@0.3.5
  - @curie-agent/protocol@0.3.5
  - @curie-agent/render@0.3.5

## 0.3.4

### Patch Changes

- Add OpenRouter sticky-session routing (`session_id`) and prompt-cache support (`cache_control`, cache usage reporting) to reduce token costs on multi-turn conversations.

- Updated dependencies []:
  - @curie-agent/core@0.3.4
  - @curie-agent/protocol@0.3.4
  - @curie-agent/render@0.3.4

## 0.2.5

### Patch Changes

- Collapsible agent actions wrapper for web dashboard — groups thinking, tool calls, and approvals into a single collapsible block per turn

- Updated dependencies []:
  - @curie-agent/core@0.2.5
  - @curie-agent/protocol@0.2.5
  - @curie-agent/render@0.2.5

## 0.2.1

### Patch Changes

- Patch release to 0.2.1

- Updated dependencies []:
  - @curie-agent/core@0.2.1
  - @curie-agent/protocol@0.2.1
  - @curie-agent/render@0.2.1

## 0.2.0

### Minor Changes

- Feature release: v0.2.0

### Patch Changes

- Updated dependencies []:
  - @curie-agent/core@0.2.0
  - @curie-agent/protocol@0.2.0
  - @curie-agent/render@0.2.0

## 0.2.4

### Patch Changes

- Version bump to 0.2.4

- Updated dependencies []:
  - @curie-agent/core@0.2.4
  - @curie-agent/protocol@0.2.4
  - @curie-agent/render@0.2.4

## 0.2.3

### Patch Changes

- Fix workspace:\* dependency references for npm installs

- Updated dependencies []:
  - @curie-agent/core@0.2.3
  - @curie-agent/protocol@0.2.3
  - @curie-agent/render@0.2.3

## 0.2.2

### Patch Changes

- Routine patch release

- Updated dependencies []:
  - @curie-agent/core@0.2.2
  - @curie-agent/protocol@0.2.2
  - @curie-agent/render@0.2.2

## 0.2.1

### Patch Changes

- chore: release v0.2.1

- Updated dependencies []:
  - @curie-agent/protocol@0.2.1
  - @curie-agent/core@0.2.1
  - @curie-agent/render@0.2.1

## 0.4.3

### Patch Changes

- Fix assistant messages displaying visible gray background slab on non-black themes by removing explicit backgroundColor

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @curie-agent/core@0.2.0
  - @curie-agent/protocol@0.2.0
  - @curie-agent/render@0.2.0

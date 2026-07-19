# @curie-agent/daemon

## 0.3.4

### Patch Changes

- Add OpenRouter sticky-session routing (`session_id`) and prompt-cache support (`cache_control`, cache usage reporting) to reduce token costs on multi-turn conversations.

- Updated dependencies []:
  - @curie-agent/core@0.3.4
  - @curie-agent/protocol@0.3.4
  - @curie-agent/providers@0.3.4
  - @curie-agent/tools@0.3.4
  - @curie-agent/wiki@0.3.4

## 0.3.2

### Patch Changes

- Bundle web UI dist into daemon package so it's available after npm install

## 0.3.1

### Patch Changes

- Fix ENOENT crash on first run: create ~/.curie-agent/ directory before writing daemon.token

## 0.2.5

### Patch Changes

- Collapsible agent actions wrapper for web dashboard — groups thinking, tool calls, and approvals into a single collapsible block per turn

- Updated dependencies []:
  - @curie-agent/core@0.2.5
  - @curie-agent/protocol@0.2.5
  - @curie-agent/providers@0.2.5
  - @curie-agent/tools@0.2.5

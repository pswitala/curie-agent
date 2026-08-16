/**
 * Slash-command parsing for the TUI input box.
 *
 * The command *registry* lives in `@curie-agent/protocol` so the daemon can
 * share it; this module only parses raw input and re-exports the registry for
 * convenience. Execution happens in one of two places, per each entry's
 * `handler` field: the daemon's `executeSlashCommand` (most commands) or the
 * CLI's `onSlashCommand` (commands needing terminal/React state).
 *
 * This file previously carried a second, complete command engine that nothing
 * ever called. It was deleted rather than repaired.
 */

export {
  SLASH_COMMANDS,
  SLASH_COMMAND_CATEGORIES,
  findSlashCommand,
  allSlashCommandNames,
  renderSlashCommandHelp,
} from '@curie-agent/protocol';
export type { SlashCommandDef, SlashCommandHandler } from '@curie-agent/protocol';

/**
 * Split `/name rest of args` into its parts.
 *
 * Returns null when the input is not a slash command. The command name is
 * lowercased; args keep their original casing (paths and prompts are
 * case-sensitive). A bare `/` yields an empty command name, which callers
 * should treat as unknown.
 */
export function parseSlashCommand(input: string): { command: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: '' };
  }
  return {
    command: trimmed.slice(1, spaceIdx).toLowerCase(),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}

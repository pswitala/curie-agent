import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSlashCommand, SLASH_COMMANDS, findSlashCommand, allSlashCommandNames, renderSlashCommandHelp } from './slash-commands.js';

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(here, '..', '..');

describe('parseSlashCommand', () => {
  it('parses a command with no args', () => {
    expect(parseSlashCommand('/help')).toEqual({ command: 'help', args: '' });
  });

  it('parses a command with args', () => {
    expect(parseSlashCommand('/model claude-opus-5')).toEqual({ command: 'model', args: 'claude-opus-5' });
  });

  it('lowercases the command but preserves arg casing', () => {
    expect(parseSlashCommand('/MODEL Claude-Opus-5')).toEqual({ command: 'model', args: 'Claude-Opus-5' });
  });

  it('trims surrounding whitespace from args', () => {
    expect(parseSlashCommand('/remind  water the plants at 5pm ')).toEqual({
      command: 'remind',
      args: 'water the plants at 5pm',
    });
  });

  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseSlashCommand('   hello')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand('!ls')).toBeNull();
  });

  it('returns an empty command name for a bare slash', () => {
    // Callers must treat this as unknown rather than dispatching it.
    expect(parseSlashCommand('/')).toEqual({ command: '', args: '' });
    expect(findSlashCommand('')).toBeUndefined();
  });
});

describe('findSlashCommand', () => {
  it('resolves by name, case-insensitively', () => {
    expect(findSlashCommand('Status')?.name).toBe('status');
  });

  it('resolves aliases to their canonical entry', () => {
    expect(findSlashCommand('quit')?.name).toBe('exit');
  });

  it('returns undefined for unknown commands', () => {
    expect(findSlashCommand('definitely-not-a-command')).toBeUndefined();
  });
});

describe('SLASH_COMMANDS registry', () => {
  it('has no duplicate names or aliases', () => {
    const names = allSlashCommandNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every command a handler, usage, and description', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(['client', 'daemon']).toContain(cmd.handler);
      expect(cmd.usage.startsWith(`/${cmd.name}`)).toBe(true);
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(cmd.category.length).toBeGreaterThan(0);
    }
  });

  it('renders help covering every command', () => {
    const help = renderSlashCommandHelp();
    for (const cmd of SLASH_COMMANDS) {
      expect(help).toContain(`/${cmd.name}`);
    }
  });
});

/**
 * The bug that motivated the shared registry: commands were listed in one place
 * and implemented in another, so /wiki, /stats and 11 others reported "Unknown
 * command" despite being registered. These tests assert the two stay in sync.
 */
describe('registry to implementation', () => {
  const daemonSource = readFileSync(join(packagesDir, 'daemon', 'src', 'jsonrpc-handler.ts'), 'utf-8');
  const cliSource = readFileSync(join(packagesDir, 'cli', 'src', 'cli.tsx'), 'utf-8');

  it('every daemon-handled command has a case in executeSlashCommand', () => {
    const missing = SLASH_COMMANDS
      .filter(c => c.handler === 'daemon')
      .filter(c => !daemonSource.includes(`case '${c.name}':`))
      .map(c => c.name);
    expect(missing).toEqual([]);
  });

  it('every client-handled command has a case in onSlashCommand', () => {
    const missing = SLASH_COMMANDS
      .filter(c => c.handler === 'client')
      .filter(c => !cliSource.includes(`case '${c.name}':`))
      .map(c => c.name);
    expect(missing).toEqual([]);
  });

  it('no longer hardcodes a stale version in the daemon', () => {
    expect(daemonSource).not.toContain("version: '0.2.4'");
    expect(daemonSource).not.toContain('0.2.4');
  });

  it('has no duplicate case labels in the CLI dispatch switch', () => {
    // A duplicated `case 'remind'` previously made the second one dead code,
    // so /remind always printed a "coming soon" stub.
    const labels = [...cliSource.matchAll(/^ {8}case '([a-z-]+)': \{/gm)].map(m => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('routes daemon commands through sessionSend rather than a local stub', () => {
    expect(cliSource).toContain("if (def.handler === 'daemon')");
    expect(cliSource).not.toContain('Reminder feature coming soon');
  });

  it('populates daemon mcpStatus after connecting MCP servers', () => {
    // mcpStatus was declared and never assigned, so /mcp reported every server
    // as disconnected with no tools even while its tools were working.
    expect(cliSource).toContain('daemon.app.mcpStatus = mcpStatus');
    expect(cliSource).toContain('connected: client?.isConnected');
  });

  it('distinguishes unrecorded MCP status from a failed connection', () => {
    expect(daemonSource).toContain('no connection status recorded');
  });
});

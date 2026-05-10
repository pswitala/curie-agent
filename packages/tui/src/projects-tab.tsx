import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ThemeColors } from '../../render/src/themes.js';

export interface ProjectEntry {
  label: string;
  rawDir: string;
  source: 'claude-code';
  projectPath: string;
}

interface ProjectsTabProps {
  projects: ProjectEntry[];
  theme?: ThemeColors;
  isActive: boolean;
  onSelectProject?: (project: ProjectEntry) => void;
}

export function ProjectsTab({ projects, theme, isActive, onSelectProject }: ProjectsTabProps) {
  const primary = theme?.primary || '#7aa2f7';
  const fg = theme?.foreground || '#a9b1d6';
  const muted = theme?.muted || '#565f89';
  const warning = theme?.warning || '#e0af68';
  const border = theme?.border || '#414868';

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [claudeMdContent, setClaudeMdContent] = useState<string | null>(null);
  const [claudeMdError, setClaudeMdError] = useState<string | null>(null);

  const claudeProjects = projects.filter(p => p.source === 'claude-code');

  useInput((char, key) => {
    if (!isActive) return;

    if (claudeMdContent !== null || claudeMdError !== null) {
      if (key.escape) {
        setClaudeMdContent(null);
        setClaudeMdError(null);
        return;
      }
      if (key.return) {
        const project = claudeProjects[selectedIndex];
        if (project && onSelectProject) onSelectProject(project);
        setClaudeMdContent(null);
        setClaudeMdError(null);
        return;
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(claudeProjects.length - 1, i + 1));
      return;
    }
    if (key.return && claudeProjects.length > 0) {
      const project = claudeProjects[selectedIndex];
      if (!project) return;
      const claudeMdPath = join(project.projectPath, 'CLAUDE.md');
      if (!existsSync(claudeMdPath)) {
        setClaudeMdError(`No CLAUDE.md found in ${project.projectPath}`);
        return;
      }
      try {
        const raw = readFileSync(claudeMdPath, 'utf8');
        const lines = raw.split('\n').slice(0, 50).join('\n');
        setClaudeMdContent(lines);
        setClaudeMdError(null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setClaudeMdError(`Error reading CLAUDE.md: ${msg}`);
      }
      return;
    }
  });

  // CLAUDE.md detail view
  if (claudeMdContent !== null || claudeMdError !== null) {
    const project = claudeProjects[selectedIndex];
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Box marginBottom={1}>
          <Text color={primary} bold>{project?.label ?? ''}</Text>
          <Text color={muted}> — CLAUDE.md (first 50 lines) — Enter: set active · Esc: back</Text>
        </Box>
        {claudeMdError ? (
          <Text color={warning}>{claudeMdError}</Text>
        ) : (
          <Text color={fg}>{claudeMdContent}</Text>
        )}
      </Box>
    );
  }

  // Project list view
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={primary} bold>{'** Claude Code **'}</Text>
      </Box>
      {claudeProjects.length === 0 ? (
        <Text color={muted}>No projects found in ~/.claude/projects</Text>
      ) : (
        claudeProjects.map((p, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={p.rawDir}>
              {isSelected ? (
                <>
                  <Text color={primary} bold>{'> '}</Text>
                  <Text color={primary} bold backgroundColor={border}>{`${i + 1}. ${p.label}`}</Text>
                </>
              ) : (
                <>
                  <Text color={muted}>{'  '}</Text>
                  <Text color={muted}>{`${i + 1}. `}</Text>
                  <Text color={fg}>{p.label}</Text>
                </>
              )}
            </Box>
          );
        })
      )}
      <Box marginTop={1}>
        <Text color={muted}>↑↓ navigate · Enter open CLAUDE.md</Text>
      </Box>
    </Box>
  );
}

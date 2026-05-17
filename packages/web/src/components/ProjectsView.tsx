import { useState, useEffect, useMemo } from 'react';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';

interface Props {
  rpc: JsonRpcClient | null;
  className?: string;
}

export default function ProjectsView({ rpc, className }: Props) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rpc) return;
    setLoading(true);
    rpc.sessionList()
      .then((list: any) => {
        if (Array.isArray(list)) setSessions(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rpc]);

  // Group sessions by CWD to find active projects
  const projects = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of sessions) {
      const existing = map.get(s.cwd) || [];
      existing.push(s);
      map.set(s.cwd, existing);
    }
    return Array.from(map.entries())
      .map(([cwd, sess]) => ({
        cwd,
        sessions: sess.length,
        providers: [...new Set(sess.map((s: any) => s.provider))],
        models: [...new Set(sess.map((s: any) => s.model))],
        lastActive: Math.max(...sess.map((s: any) => s.updatedAt)),
      }))
      .sort((a, b) => b.lastActive - a.lastActive);
  }, [sessions]);

  return (
    <div className={`flex-1 overflow-y-auto p-7 scrollbar-thin ${className || ''}`}>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-fg tracking-tight">Projects</h2>
        <span className="text-xs text-muted font-mono">{projects.length} projects</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted">Loading...</div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted">
          <div className="text-sm">No projects yet</div>
          <div className="text-xs text-muted2 mt-1">Sessions will appear here once you run them</div>
        </div>
      ) : (
        projects.map((project) => (
          <ProjectRow key={project.cwd} project={project} />
        ))
      )}
    </div>
  );
}

function ProjectRow({ project }: { project: { cwd: string; sessions: number; providers: string[]; models: string[]; lastActive: number } }) {
  const name = project.cwd.split('/').pop() || project.cwd;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 hover:bg-s2 cursor-pointer transition-colors duration-100">
      <div className="w-[6px] h-[6px] rounded-full bg-green shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-fg">{name}</div>
        <div className="text-xs text-muted font-mono">{project.cwd}</div>
      </div>
      <div className="flex gap-3">
        <span className="text-xs text-muted">{project.sessions} session{project.sessions !== 1 ? 's' : ''}</span>
        <span className="text-xs text-muted">{project.providers.join(', ')}</span>
      </div>
      <span className="text-[10px] font-medium rounded-full px-2 py-0.5 font-mono bg-green/10 text-green">active</span>
    </div>
  );
}

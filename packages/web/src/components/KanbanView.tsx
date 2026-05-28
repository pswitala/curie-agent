import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../lib/api-context.js';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskData {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  mode: 'human' | 'agent' | 'notify';
  result?: string;
  metadata?: Record<string, unknown>;
  scheduled_at?: number;
  scope: 'personal' | 'project';
  order: number;
  created_at: string;
  completed_at?: string;
  last_run?: number;
}

type KanbanColumnId = 'backlog' | 'todo' | 'in_progress' | 'done';

interface ColumnConfig {
  id: KanbanColumnId;
  label: string;
  statuses: string[];
  defaultStatus: string;
}

const COLUMNS: ColumnConfig[] = [
  { id: 'backlog', label: 'Backlog', statuses: ['backlog'], defaultStatus: 'backlog' },
  { id: 'todo', label: 'To Do', statuses: ['todo', 'pending'], defaultStatus: 'todo' },
  { id: 'in_progress', label: 'In Progress', statuses: ['in_progress', 'executing'], defaultStatus: 'in_progress' },
  { id: 'done', label: 'Done', statuses: ['done', 'completed'], defaultStatus: 'done' },
];

const COLUMN_MAP = new Map<KanbanColumnId, ColumnConfig>(COLUMNS.map(c => [c.id, c]));

function getColumnForStatus(status: string): KanbanColumnId | null {
  for (const col of COLUMNS) {
    if (col.statuses.includes(status)) return col.id;
  }
  return null;
}

// Build a flat map: taskId -> columnId
function buildTaskToColumn(tasks: TaskData[]): Map<string, KanbanColumnId> {
  const m = new Map<string, KanbanColumnId>();
  for (const t of tasks) {
    const col = getColumnForStatus(t.status);
    if (col) m.set(t.id, col);
  }
  return m;
}

const ARCHIVE_STATUSES = ['canceled', 'failed'];

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high: 'var(--yellow)',
  medium: 'var(--muted)',
  low: 'var(--green)',
};

const MODE_LABELS: Record<string, string> = { human: 'H', agent: 'A', notify: 'N' };

// ---------------------------------------------------------------------------
// Task Card Content — shared between SortableTaskCard and DragOverlay
// ---------------------------------------------------------------------------

function TaskCardContent({ task }: { task: TaskData }) {
  const priorityColor = PRIORITY_COLORS[task.priority] || 'var(--muted)';
  const scheduledDate = task.scheduled_at
    ? new Date(task.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="glass-card rounded-xl p-3 mb-2 w-[256px] select-none">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-muted2">
            <circle cx="3" cy="2" r="1" />
            <circle cx="9" cy="2" r="1" />
            <circle cx="3" cy="6" r="1" />
            <circle cx="9" cy="6" r="1" />
            <circle cx="3" cy="10" r="1" />
            <circle cx="9" cy="10" r="1" />
          </svg>
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: priorityColor }} />
        </div>
      </div>

      <div className="text-[12.5px] font-medium text-fg mb-1.5 leading-snug line-clamp-3">
        {task.title}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded leading-none" style={{ color: 'var(--muted)' }}>
          [{MODE_LABELS[task.mode] || '?'}]
        </span>

        {task.scope === 'project' && (
          <span className="text-[9px] font-mono px-1 py-0.5 rounded leading-none" style={{ color: 'var(--muted)' }}>
            proj
          </span>
        )}

        {scheduledDate && (
          <span className="text-[9px] text-muted2">
            {scheduledDate}
          </span>
        )}

        {task.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="leather-tag text-[9px] px-1.5 py-0.5 rounded-full text-muted">
            {tag}
          </span>
        ))}
        {task.tags.length > 3 && (
          <span className="text-[9px] text-muted2">+{task.tags.length - 3}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable Task Card — wraps content with useSortable
// ---------------------------------------------------------------------------

function SortableTaskCard({
  task,
  onEdit,
  onRemove,
}: {
  task: TaskData;
  onEdit: (task: TaskData) => void;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({
    id: task.id,
    animateLayoutChanges: () => false,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
      onClick={() => onEdit(task)}
    >
      <div className="flex items-center justify-between mb-2">
        <div />

        <button
          onClick={(e) => { e.stopPropagation(); onRemove(task.id); }}
          className="text-muted2 hover:text-red transition-colors p-0.5 rounded cursor-pointer"
          title="Delete task"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div
        className="text-[12.5px] font-medium text-fg mb-1.5 leading-snug line-clamp-3 glass-card rounded-xl p-3 mb-2"
      >
        {task.title}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap px-3 pb-2">
        <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded leading-none" style={{ color: 'var(--muted)' }}>
          [{MODE_LABELS[task.mode] || '?'}]
        </span>

        {task.scope === 'project' && (
          <span className="text-[9px] font-mono px-1 py-0.5 rounded leading-none" style={{ color: 'var(--muted)' }}>
            proj
          </span>
        )}

        {task.scheduled_at && (
          <span className="text-[9px] text-muted2">
            {new Date(task.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}

        {task.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="leather-tag text-[9px] px-1.5 py-0.5 rounded-full text-muted">
            {tag}
          </span>
        ))}
        {task.tags.length > 3 && (
          <span className="text-[9px] text-muted2">+{task.tags.length - 3}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kanban Column — uses useDroppable so the whole column is always a drop target
// ---------------------------------------------------------------------------

function KanbanColumn({
  column,
  tasks,
  isDragging,
  onEdit,
  onRemove,
  className = '',
}: {
  column: ColumnConfig;
  tasks: TaskData[];
  isDragging: boolean;
  onEdit: (task: TaskData) => void;
  onRemove: (id: string) => void;
  className?: string;
}) {
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: column.id });

  const renderTaskCard = function (task: TaskData) {
    return (
      <SortableTaskCard
        key={task.id}
        task={task}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    );
  };

  return (
    <div className={`flex flex-col h-full min-w-[260px] sm:flex-1 ${className}`}>
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold font-display" style={{ color: 'var(--gold)' }}>
            {column.label}
          </span>
          <span className="text-[10px] font-mono text-muted bg-s3 px-1.5 py-0.5 rounded">
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Droppable cards container — scroll normally, visible during drag */}
      <div
        ref={setDroppableRef}
        className="flex-1 px-2 pb-2 min-h-0 relative transition-colors duration-150 rounded-xl kanban-column-scroll"
        style={{
          overflowY: isDragging ? 'visible' : 'auto',
          background: isOver ? 'color-mix(in srgb, var(--gold) 8%, transparent)' : 'transparent',
        }}
      >
        {tasks.map(renderTaskCard)}

        {tasks.length === 0 && (
          <div className="text-center py-8 text-[11px] text-muted2 min-h-[120px] flex items-center justify-center">
            No tasks
          </div>
        )}
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Modal
// ---------------------------------------------------------------------------

function EditModal({
  task,
  onSave,
  onClose,
}: {
  task: TaskData | null;
  onSave: (updates: Partial<TaskData>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>(task?.priority ?? 'medium');
  const [mode, setMode] = useState<'human' | 'agent' | 'notify'>(task?.mode ?? 'human');
  const [scope, setScope] = useState<'personal' | 'project'>(task?.scope ?? 'personal');
  const [status, setStatus] = useState(task?.status ?? 'backlog');
  const [scheduledAt, setScheduledAt] = useState(() => {
    if (task?.scheduled_at) {
      const d = new Date(task.scheduled_at);
      return d.toISOString().slice(0, 16);
    }
    return '';
  });
  const [tagsStr, setTagsStr] = useState(task?.tags.join(', ') ?? '');

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim(),
      priority,
      mode,
      scope,
      status,
      tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
      scheduled_at: scheduledAt ? new Date(scheduledAt).getTime() : undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 animate-fadeIn"
      style={{ background: 'rgba(10, 8, 5, 0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl shadow-2xl animate-scaleIn select-none glass-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 mb-4" style={{ borderBottom: '1px solid var(--b1)' }}>
          <span className="font-bold text-[13.5px] font-display" style={{ color: 'var(--cream)' }}>{task ? 'Edit Task' : 'New Task'}</span>
          <button onClick={onClose} className="text-muted hover:text-fg transition-colors cursor-pointer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider font-mono mb-1 block">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[12.5px] text-fg outline-none transition-colors focus:ring-1 focus:ring-gold/30"
              style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
              autoFocus
            />
          </div>

          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider font-mono mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg text-[12.5px] text-fg outline-none resize-none transition-colors focus:ring-1 focus:ring-gold/30 scrollbar-thin"
              style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider font-mono mb-1 block">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high' | 'critical')}
                className="w-full px-3 py-2 rounded-lg text-[12.5px] text-fg outline-none cursor-pointer"
                style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider font-mono mb-1 block">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'human' | 'agent' | 'notify')}
                className="w-full px-3 py-2 rounded-lg text-[12.5px] text-fg outline-none cursor-pointer"
                style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
              >
                <option value="human">Human</option>
                <option value="agent">Agent</option>
                <option value="notify">Notify</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider font-mono mb-1 block">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'personal' | 'project')}
                className="w-full px-3 py-2 rounded-lg text-[12.5px] text-fg outline-none cursor-pointer"
                style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
              >
                <option value="personal">Personal</option>
                <option value="project">Project</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider font-mono mb-1 block">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-[12.5px] text-fg outline-none cursor-pointer"
                style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
              >
                <option value="backlog">Backlog</option>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider font-mono mb-1 block">Scheduled (optional)</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[12.5px] text-fg outline-none cursor-pointer"
              style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
            />
          </div>

          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider font-mono mb-1 block">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="bug, feature, urgent"
              className="w-full px-3 py-2 rounded-lg text-[12.5px] text-fg outline-none transition-colors focus:ring-1 focus:ring-gold/30"
              style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
            />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl text-[12px] font-semibold cursor-pointer transition-all duration-150 active:scale-[0.98]"
            style={{ background: 'var(--s3)', border: '1px solid var(--b1)', color: 'var(--muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="flex-1 btn-gold py-2.5 px-4 rounded-xl text-[12px] font-semibold cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {task ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main KanbanView
// ---------------------------------------------------------------------------

interface Props {
  rpc: JsonRpcClient | null;
  className?: string;
}

export default function KanbanView({ rpc, className }: Props) {
  const { ws } = useApi();
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTask, setEditTask] = useState<TaskData | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [filterMode, setFilterMode] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterScope, setFilterScope] = useState<string>('all');
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!rpc) return;
    try {
      const params: Record<string, string> = {};
      if (filterMode !== 'all') params.mode = filterMode;
      if (filterPriority !== 'all') params.priority = filterPriority;
      if (filterScope !== 'all') params.scope = filterScope;
      const result = await rpc.todoList(Object.keys(params).length ? params : undefined);
      setTasks(Array.isArray(result) ? (result as TaskData[]) : []);
    } catch (err) {
      console.error('[Kanban] Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [rpc, filterMode, filterPriority, filterScope]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (!ws) return;
    const handler = () => fetchTasks();
    const unsub1 = ws.on('todo-changed', handler);
    const unsub2 = ws.on('cron-task-fired', handler);
    return () => {
      unsub1();
      unsub2();
    };
  }, [ws, fetchTasks]);

  // Close filter dropdown on click outside
  useEffect(() => {
    if (!filterDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-filter-dropdown]')) {
        setFilterDropdownOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [filterDropdownOpen]);

  const columnTasks = useMemo(() => {
    const grouped: Record<KanbanColumnId, TaskData[]> = {
      backlog: [], todo: [], in_progress: [], done: [],
    };
    for (const task of tasks) {
      if (task.mode === 'notify') continue;
      const col = getColumnForStatus(task.status);
      if (col && grouped[col]) {
        grouped[col].push(task);
      }
    }
    Object.values(grouped).forEach(list => list.sort((a, b) => a.order - b.order));
    return grouped;
  }, [tasks]);

  const archiveTasks = useMemo(
    () => tasks.filter(t => ARCHIVE_STATUSES.includes(t.status)),
    [tasks]
  );

  const taskToColumn = useMemo(() => buildTaskToColumn(tasks), [tasks]);

  // Per-column task ID lists — each column gets its own SortableContext
  const columnTaskIds = useMemo(() => {
    const ids: Record<KanbanColumnId, string[]> = {
      backlog: [], todo: [], in_progress: [], done: [],
    };
    for (const task of tasks) {
      if (task.mode === 'notify') continue;
      const col = getColumnForStatus(task.status);
      if (col && !ARCHIVE_STATUSES.includes(task.status)) {
        ids[col].push(task.id);
      }
    }
    return ids;
  }, [tasks]);

 
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setIsDragging(true);
    setActiveTaskId(String(event.active.id));
  }, []);

  const handleDragCancel = useCallback(() => {
    setIsDragging(false);
    setActiveTaskId(null);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !rpc) {
      setIsDragging(false);
      setActiveTaskId(null);
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeTask = tasks.find(t => t.id === activeId);
    if (!activeTask) {
      setIsDragging(false);
      setActiveTaskId(null);
      return;
    }

    const fromCol = taskToColumn.get(activeId);
    if (!fromCol) {
      setIsDragging(false);
      setActiveTaskId(null);
      return;
    }

    // Determine target column and new status
    let toStatus = activeTask.status;
    const droppedOnColumn = COLUMN_MAP.get(overId as KanbanColumnId);

    if (droppedOnColumn) {
      toStatus = droppedOnColumn.defaultStatus;
    } else {
      const overTask = tasks.find(t => t.id === overId);
      if (overTask) {
        const toCol = getColumnForStatus(overTask.status);
        if (toCol) {
          toStatus = COLUMN_MAP.get(toCol)!.defaultStatus;
        }
      }
    }

    const fromStatus = activeTask.status;
    const changed = fromStatus !== toStatus;

    // --- Optimistic update: move card in local state IMMEDIATELY ---
    // This way, when the overlay disappears, the card is already rendered
    // in the target column — no time spent at source position.
    if (changed) {
      const prevStatus = activeTask.status;
      setTasks(prev => prev.map(t => t.id === activeId ? { ...t, status: toStatus } : t));

      try {
        await rpc.todoUpdate({ id: activeId, status: toStatus });
      } catch {
        // Rollback on failure
        setTasks(prev => prev.map(t => t.id === activeId ? { ...t, status: prevStatus } : t));
      }
    } else {
      // Within-column reorder — just re-trigger sync
      try {
        await rpc.todoUpdate({ id: activeId });
      } catch { /* ignore */ }
    }

    // Clear overlay and drag state together so card only appears in final position
    setActiveTaskId(null);
    setIsDragging(false);
  }, [rpc, tasks, taskToColumn]);

  const handleCreateFromModal = useCallback(async (params: Partial<TaskData>) => {
    if (!rpc) return;
    await rpc.todoCreate({
      title: (params.title ?? '').trim(),
      description: params.description,
      priority: params.priority ?? 'medium',
      mode: params.mode ?? 'human',
      scope: params.scope ?? 'personal',
      status: params.status ?? 'backlog',
      tags: params.tags,
      scheduled_at: params.scheduled_at,
    });
    setShowCreateModal(false);
  }, [rpc]);

  const handleEditSave = useCallback(async (updates: Partial<TaskData>) => {
    if (!rpc || !editTask) return;
    await rpc.todoUpdate({ id: editTask.id, ...updates });
    setEditTask(null);
  }, [rpc, editTask]);

  const handleRemove = useCallback(async (id: string) => {
    if (!rpc) return;
    await rpc.todoRemove(id);
  }, [rpc]);

  if (loading) {
    return (
      <div className={className || ''}>
        <div className="flex items-center justify-center h-full text-muted text-xs">
          Loading tasks...
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className || ''}`}>
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--b1)' }}>
        <h2 className="text-[13px] font-semibold font-display" style={{ color: 'var(--cream)' }}>
          Tasks
        </h2>

        {/* Filter icon + dropdown */}
        <div className="relative" data-filter-dropdown>
          <button
            ref={filterBtnRef}
            onClick={() => {
              if (!filterDropdownOpen && filterBtnRef.current) {
                const rect = filterBtnRef.current.getBoundingClientRect();
                const width = 200;
                let left = rect.left;
                if (left + width > window.innerWidth - 8) {
                  left = window.innerWidth - width - 8;
                }
                setDropdownPos({ top: rect.bottom + 4, left: Math.max(left, 8) });
              }
              setFilterDropdownOpen(!filterDropdownOpen);
            }}
            className="p-1.5 rounded-lg cursor-pointer transition-colors"
            style={{
              background: (filterMode !== 'all' || filterPriority !== 'all' || filterScope !== 'all') ? 'var(--s3)' : 'transparent',
              border: '1px solid var(--b2)',
              color: 'var(--muted)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
          {filterDropdownOpen && createPortal(
            <div
              data-filter-dropdown
              className="fixed rounded-xl shadow-2xl p-3 space-y-2.5 w-[200px]"
              style={{ top: dropdownPos.top, left: dropdownPos.left, background: 'var(--s1)', border: '1px solid var(--b1)', zIndex: 9999 }}
            >
              <div>
                <label className="text-[9px] text-muted uppercase tracking-wider font-mono mb-1 block">Mode</label>
                <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--b2)' }}>
                  {['all', 'human', 'agent', 'notify'].map((m) => (
                    <button
                      key={m}
                      onClick={() => { setFilterMode(m); setFilterDropdownOpen(false); }}
                      className="flex-1 px-1.5 py-1 text-[10px] font-mono cursor-pointer transition-all"
                      style={{
                        color: filterMode === m ? 'var(--gold)' : 'var(--muted)',
                        background: filterMode === m ? 'var(--s3)' : 'transparent',
                      }}
                    >
                      {m === 'all' ? 'All' : m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[9px] text-muted uppercase tracking-wider font-mono mb-1 block">Priority</label>
                <select
                  value={filterPriority}
                  onChange={(e) => { setFilterPriority(e.target.value); setFilterDropdownOpen(false); }}
                  className="w-full px-2 py-1 rounded-lg text-[11px] font-mono outline-none cursor-pointer"
                  style={{ background: 'var(--s2)', border: '1px solid var(--b2)', color: 'var(--muted)' }}
                >
                  <option value="all">All</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <label className="text-[9px] text-muted uppercase tracking-wider font-mono mb-1 block">Scope</label>
                <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--b2)' }}>
                  {['all', 'personal', 'project'].map((s) => (
                    <button
                      key={s}
                      onClick={() => { setFilterScope(s); setFilterDropdownOpen(false); }}
                      className="flex-1 px-1.5 py-1 text-[10px] font-mono cursor-pointer transition-all"
                      style={{
                        color: filterScope === s ? 'var(--gold)' : 'var(--muted)',
                        background: filterScope === s ? 'var(--s3)' : 'transparent',
                      }}
                    >
                      {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
           , document.body)}
        </div>

        <div className="flex-1" />

        <button
          onClick={() => setShowArchive(!showArchive)}
          className="text-[10px] font-mono px-2 py-0.5 rounded cursor-pointer transition-all duration-150"
          style={{
            color: showArchive ? 'var(--gold)' : 'var(--muted)',
            background: showArchive ? 'var(--s3)' : 'transparent',
            border: '1px solid var(--b2)',
          }}
        >
          Archive {archiveTasks.length}
        </button>

        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-gold px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer active:scale-[0.98]"
        >
          Add
        </button>
      </div>

      {/* Kanban board — single DndContext, per-column SortableContext + useDroppable */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        {/* Desktop: flex row, Mobile: snap scroll one column at a time */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0 snap-x snap-mandatory sm:overflow-x-visible sm:snap-none">
          <div className="flex h-full sm:gap-4 sm:flex-row flex-nowrap sm:min-w-0">
            {COLUMNS.map((col) => (
              <SortableContext key={col.id} items={columnTaskIds[col.id]} strategy={verticalListSortingStrategy}>
                <KanbanColumn
                  column={col}
                  tasks={columnTasks[col.id]}
                  isDragging={isDragging}
                  onEdit={setEditTask}
                  onRemove={handleRemove}
                  className="snap-center flex-shrink-0 w-screen sm:w-auto sm:flex-1 px-4 sm:px-0"
                />
              </SortableContext>
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeTaskId && (
            <TaskCardContent task={tasks.find(t => t.id === activeTaskId)!} />
          )}
        </DragOverlay>
      </DndContext>

      {showArchive && archiveTasks.length > 0 && (
        <div className="px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--b1)' }}>
          <h3 className="text-[11px] font-semibold text-muted mb-2">Archived Tasks</h3>
          <div className="flex gap-2 flex-wrap">
            {archiveTasks.map((task) => (
              <div
                key={task.id}
                className="glass-card rounded-lg px-3 py-2 flex items-center gap-2"
                style={{ opacity: 0.6 }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: task.status === 'failed' ? 'var(--red)' : 'var(--muted2)' }}
                />
                <span className="text-[11px] text-muted line-through">{task.title}</span>
                <span className="text-[9px] font-mono text-muted2">[{MODE_LABELS[task.mode]}]</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreateModal && (
        <EditModal
          task={null}
          onSave={handleCreateFromModal}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {editTask && (
        <EditModal
          task={editTask}
          onSave={handleEditSave}
          onClose={() => setEditTask(null)}
        />
      )}
    </div>
  );
}

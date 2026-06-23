/**
 * TasksPanel — slide-in task management panel for CommandChat.
 *
 * Features:
 *   - Admin board: all tasks, filterable by status / priority / assignee
 *   - My Tasks: tasks assigned to the current agent
 *   - CreateTaskModal: title, description, assignee, priority, due date, status
 *   - EditTaskModal: inline edit of any field
 *   - Due-date popup: fires when getDue returns items (wired via onTaskUpdate SSE callback)
 */

import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  X, Plus, CheckCircle2, Clock, AlertTriangle, ChevronDown,
  Trash2, Pencil, CalendarDays, User, Flag, MoreHorizontal,
  CheckCheck, Circle, Loader2, ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "urgent" | "high" | "medium" | "low";
type Status = "todo" | "in_progress" | "done";

interface Task {
  id: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assigneeAgentId: number | null;
  assigneeAgentName: string | null;
  createdByAgentName: string | null;
  dueAt: number | null;
  completedAt: number | null;
  popupDismissedAt: number | null;
  createdAt: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; dot: string }> = {
  urgent: { label: "Urgent", color: "text-red-600 bg-red-50 border-red-200", dot: "bg-red-500" },
  high:   { label: "High",   color: "text-orange-600 bg-orange-50 border-orange-200", dot: "bg-orange-500" },
  medium: { label: "Medium", color: "text-amber-600 bg-amber-50 border-amber-200", dot: "bg-amber-400" },
  low:    { label: "Low",    color: "text-slate-500 bg-slate-50 border-slate-200", dot: "bg-slate-400" },
};

const STATUS_CONFIG: Record<Status, { label: string; color: string; dot: string; icon: React.ReactNode }> = {
  todo:        { label: "To Do",       color: "text-blue-600 bg-blue-50 border-blue-200",   dot: "bg-blue-500",   icon: <Circle className="h-3 w-3" /> },
  in_progress: { label: "In Progress", color: "text-amber-600 bg-amber-50 border-amber-200", dot: "bg-amber-500", icon: <Clock className="h-3 w-3" /> },
  done:        { label: "Done",        color: "text-green-600 bg-green-50 border-green-200", dot: "bg-green-500", icon: <CheckCircle2 className="h-3 w-3" /> },
};

function formatDue(dueAt: number | null): { label: string; overdue: boolean } {
  if (!dueAt) return { label: "No due date", overdue: false };
  const now = Date.now();
  const diff = dueAt - now;
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor(abs / 3_600_000);
  const mins = Math.floor(abs / 60_000);
  let label: string;
  if (days >= 1) label = `${overdue ? "" : "in "}${days}d${overdue ? " ago" : ""}`;
  else if (hours >= 1) label = `${overdue ? "" : "in "}${hours}h${overdue ? " ago" : ""}`;
  else if (mins >= 1) label = `${overdue ? "" : "in "}${mins}m${overdue ? " ago" : ""}`;
  else label = overdue ? "just now" : "< 1m";
  return { label, overdue };
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority as Priority] ?? PRIORITY_CONFIG.medium;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border", cfg.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as Status] ?? STATUS_CONFIG.todo;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border", cfg.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

interface TaskFormData {
  title: string;
  description: string;
  priority: Priority;
  status: Status;
  assigneeAgentId: number | null;
  assigneeAgentName: string | null;
  dueAt: string; // date input value "YYYY-MM-DD"
}

function defaultForm(): TaskFormData {
  return {
    title: "",
    description: "",
    priority: "medium",
    status: "todo",
    assigneeAgentId: null,
    assigneeAgentName: null,
    dueAt: "",
  };
}

interface TaskModalProps {
  open: boolean;
  onClose: () => void;
  editTask?: Task | null;
  agentList: Array<{ id: number; name: string }>;
  onSaved: () => void;
}

function TaskModal({ open, onClose, editTask, agentList, onSaved }: TaskModalProps) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<TaskFormData>(() => {
    if (editTask) {
      const dueDate = editTask.dueAt
        ? new Date(editTask.dueAt).toISOString().split("T")[0]
        : "";
      return {
        title: editTask.title,
        description: editTask.description ?? "",
        priority: (editTask.priority as Priority) ?? "medium",
        status: (editTask.status as Status) ?? "todo",
        assigneeAgentId: editTask.assigneeAgentId,
        assigneeAgentName: editTask.assigneeAgentName,
        dueAt: dueDate,
      };
    }
    return defaultForm();
  });

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: () => { utils.tasks.list.invalidate(); utils.tasks.listMine.invalidate(); onSaved(); onClose(); },
  });
  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: () => { utils.tasks.list.invalidate(); utils.tasks.listMine.invalidate(); onSaved(); onClose(); },
  });

  const isLoading = createTask.isPending || updateTask.isPending;

  function handleSubmit() {
    const dueAt = form.dueAt
      ? new Date(form.dueAt + "T09:00:00").getTime()
      : undefined;
    if (editTask) {
      updateTask.mutate({
        id: editTask.id,
        title: form.title,
        description: form.description || null,
        priority: form.priority,
        status: form.status,
        assigneeAgentId: form.assigneeAgentId,
        assigneeAgentName: form.assigneeAgentName,
        dueAt: dueAt ?? null,
      });
    } else {
      createTask.mutate({
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
        status: form.status,
        assigneeAgentId: form.assigneeAgentId ?? undefined,
        assigneeAgentName: form.assigneeAgentName ?? undefined,
        dueAt,
      });
    }
  }

  function setAssignee(agentId: string) {
    if (agentId === "unassigned") {
      setForm(f => ({ ...f, assigneeAgentId: null, assigneeAgentName: null }));
    } else {
      const agent = agentList.find(a => a.id === Number(agentId));
      setForm(f => ({ ...f, assigneeAgentId: agent?.id ?? null, assigneeAgentName: agent?.name ?? null }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editTask ? "Edit Task" : "Create New Task"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Task Title</label>
            <Input
              placeholder="Enter task title"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              maxLength={255}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Description <span className="text-slate-400 font-normal">(optional)</span></label>
            <div className="relative">
              <Textarea
                placeholder="Add task description..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                maxLength={2000}
                rows={3}
                className="resize-none"
              />
              <span className="absolute bottom-2 right-2 text-[10px] text-slate-400">
                {form.description.length}/2000
              </span>
            </div>
          </div>

          {/* Assign To + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Assign To</label>
              <Select
                value={form.assigneeAgentId ? String(form.assigneeAgentId) : "unassigned"}
                onValueChange={setAssignee}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {agentList.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Priority</label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as Priority }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(PRIORITY_CONFIG) as [Priority, typeof PRIORITY_CONFIG[Priority]][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full", v.dot)} />
                        {v.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Due Date + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Due Date</label>
              <Input
                type="date"
                value={form.dueAt}
                onChange={e => setForm(f => ({ ...f, dueAt: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Status</label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as Status }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(STATUS_CONFIG) as [Status, typeof STATUS_CONFIG[Status]][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full", v.dot)} />
                        {v.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!form.title.trim() || isLoading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {isLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {editTask ? "Save Changes" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Due-date Popup ───────────────────────────────────────────────────────────

interface DueTaskPopupProps {
  tasks: Task[];
  onDismiss: (id: number) => void;
  onMarkDone: (id: number) => void;
  onOpenPanel: () => void;
}

export function DueTaskPopup({ tasks, onDismiss, onMarkDone, onOpenPanel }: DueTaskPopupProps) {
  if (tasks.length === 0) return null;
  const task = tasks[0]; // show one at a time
  const { label, overdue } = formatDue(task.dueAt);

  return (
    <div className="fixed bottom-20 right-4 z-[300] w-80 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
      {/* Top accent bar */}
      <div className="h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
            <ClipboardList className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">Task Due</span>
              <span className={cn("text-[10px] font-semibold", overdue ? "text-red-500" : "text-amber-500")}>
                · {label}
              </span>
            </div>
            <p className="text-sm font-semibold text-slate-900 truncate">{task.title}</p>
            {task.description && (
              <p className="text-xs text-slate-500 truncate mt-0.5">{task.description}</p>
            )}
            {tasks.length > 1 && (
              <p className="text-[10px] text-slate-400 mt-1">+{tasks.length - 1} more task{tasks.length > 2 ? "s" : ""} due</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <Button
            size="sm"
            className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onMarkDone(task.id)}
          >
            <CheckCheck className="h-3 w-3 mr-1" />
            Mark Done
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-xs"
            onClick={onOpenPanel}
          >
            View Tasks
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
            onClick={() => onDismiss(task.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main TasksPanel ──────────────────────────────────────────────────────────

interface TasksPanelProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  agentList: Array<{ id: number; name: string }>;
  /** Bump this to trigger a refetch (from SSE task_update) */
  refetchTick?: number;
}

export default function TasksPanel({ open, onClose, isAdmin, agentList, refetchTick }: TasksPanelProps) {
  const utils = trpc.useUtils();

  // ── View state ──────────────────────────────────────────────────────────────
  const [view, setView] = useState<"all" | "mine">(isAdmin ? "all" : "mine");
  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterPriority, setFilterPriority] = useState<Priority | "all">("all");
  const [filterAssignee, setFilterAssignee] = useState<number | "all">("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────────────
  const listQuery = trpc.tasks.list.useQuery(
    {
      status: filterStatus !== "all" ? filterStatus : undefined,
      priority: filterPriority !== "all" ? filterPriority : undefined,
      assigneeAgentId: filterAssignee !== "all" ? filterAssignee : undefined,
      page,
      pageSize: PAGE_SIZE,
    },
    { enabled: open && view === "all", staleTime: 30_000, refetchInterval: 60_000 }
  );
  const mineQuery = trpc.tasks.listMine.useQuery(undefined, {
    enabled: open && view === "mine", staleTime: 30_000, refetchInterval: 60_000,
  });

  // Refetch when SSE fires
  const prevTick = useState(refetchTick)[0];
  if (refetchTick !== prevTick && open) {
    utils.tasks.list.invalidate();
    utils.tasks.listMine.invalidate();
  }

  const deleteTask = trpc.tasks.delete.useMutation({
    onSuccess: () => { utils.tasks.list.invalidate(); utils.tasks.listMine.invalidate(); },
  });
  const updateStatus = trpc.tasks.updateStatus.useMutation({
    onSuccess: () => { utils.tasks.list.invalidate(); utils.tasks.listMine.invalidate(); },
  });

  const tasks: Task[] = useMemo(() => {
    if (view === "all") return (listQuery.data?.tasks ?? []) as Task[];
    return (mineQuery.data ?? []) as Task[];
  }, [view, listQuery.data, mineQuery.data]);

  const totalCount = view === "all" ? (listQuery.data?.total ?? 0) : tasks.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const isLoading = view === "all" ? listQuery.isLoading : mineQuery.isLoading;

  const handleSaved = useCallback(() => {
    utils.tasks.list.invalidate();
    utils.tasks.listMine.invalidate();
  }, [utils]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-y-0 right-0 z-[200] flex flex-col bg-white shadow-2xl border-l border-slate-200 animate-in slide-in-from-right-2 duration-200"
        style={{ width: "520px", maxWidth: "95vw" }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0 bg-slate-50">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-indigo-500" />
            <span className="text-sm font-semibold text-slate-900">Tasks</span>
            {totalCount > 0 && (
              <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">
                {totalCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New Task
            </Button>
            <button
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-slate-200 transition-colors text-slate-400"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── View tabs ── */}
        <div className="flex items-center gap-1 px-4 pt-3 pb-0 shrink-0">
          {isAdmin && (
            <button
              onClick={() => { setView("all"); setPage(1); }}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors",
                view === "all" ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"
              )}
            >
              All Tasks
            </button>
          )}
          <button
            onClick={() => setView("mine")}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors",
              view === "mine" ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"
            )}
          >
            My Tasks
          </button>
        </div>

        {/* ── Filters (admin all-tasks view only) ── */}
        {view === "all" && (
          <div className="flex items-center gap-2 px-4 py-2 shrink-0 flex-wrap">
            {/* Status filter */}
            <Select value={filterStatus} onValueChange={v => { setFilterStatus(v as Status | "all"); setPage(1); }}>
              <SelectTrigger className="h-7 text-xs w-[120px]">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Priority filter */}
            <Select value={filterPriority} onValueChange={v => { setFilterPriority(v as Priority | "all"); setPage(1); }}>
              <SelectTrigger className="h-7 text-xs w-[120px]">
                <SelectValue placeholder="All Priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Assignee filter */}
            <Select value={filterAssignee === "all" ? "all" : String(filterAssignee)} onValueChange={v => { setFilterAssignee(v === "all" ? "all" : Number(v)); setPage(1); }}>
              <SelectTrigger className="h-7 text-xs w-[140px]">
                <SelectValue placeholder="All Assignees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignees</SelectItem>
                {agentList.map(a => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* ── Task list ── */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400">
              <ClipboardList className="h-8 w-8 opacity-30" />
              <p className="text-sm font-medium">No tasks found</p>
              <p className="text-xs">Create a task to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {tasks.map(task => {
                const { label: dueLabel, overdue } = formatDue(task.dueAt);
                const isDone = task.status === "done";
                return (
                  <div
                    key={task.id}
                    className={cn(
                      "px-4 py-3 hover:bg-slate-50 transition-colors group",
                      isDone && "opacity-60"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Status toggle button */}
                      <button
                        onClick={() => updateStatus.mutate({ id: task.id, status: isDone ? "todo" : "done" })}
                        className={cn(
                          "mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors",
                          isDone
                            ? "border-green-500 bg-green-500 text-white"
                            : "border-slate-300 hover:border-indigo-400"
                        )}
                        title={isDone ? "Mark as To Do" : "Mark as Done"}
                      >
                        {isDone && <CheckCheck className="h-2.5 w-2.5" />}
                      </button>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className={cn("text-sm font-semibold text-slate-900 truncate", isDone && "line-through text-slate-400")}>
                              {task.title}
                            </p>
                            {task.description && (
                              <p className="text-xs text-slate-500 truncate mt-0.5">{task.description}</p>
                            )}
                          </div>
                          {/* Actions */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded hover:bg-slate-200 transition-all shrink-0">
                                <MoreHorizontal className="h-3.5 w-3.5 text-slate-500" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="text-xs">
                              <DropdownMenuItem onClick={() => setEditTask(task)}>
                                <Pencil className="h-3 w-3 mr-1.5" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => updateStatus.mutate({ id: task.id, status: isDone ? "todo" : "done" })}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1.5" />
                                {isDone ? "Mark To Do" : "Mark Done"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600 focus:text-red-600"
                                onClick={() => deleteTask.mutate({ id: task.id })}
                              >
                                <Trash2 className="h-3 w-3 mr-1.5" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        {/* Meta row */}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <PriorityBadge priority={task.priority} />
                          <StatusBadge status={task.status} />
                          {task.assigneeAgentName && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                              <User className="h-2.5 w-2.5" />
                              {task.assigneeAgentName}
                            </span>
                          )}
                          {task.dueAt && (
                            <span className={cn(
                              "inline-flex items-center gap-1 text-[10px] font-medium",
                              overdue && !isDone ? "text-red-500" : "text-slate-400"
                            )}>
                              <CalendarDays className="h-2.5 w-2.5" />
                              {dueLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Pagination (all-tasks view) ── */}
        {view === "all" && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 shrink-0 bg-slate-50">
            <span className="text-[11px] text-slate-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-6 w-6 p-0" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                <ChevronDown className="h-3 w-3 rotate-90" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const p = i + 1;
                return (
                  <Button
                    key={p}
                    size="sm"
                    variant={page === p ? "default" : "outline"}
                    className={cn("h-6 w-6 p-0 text-[11px]", page === p && "bg-indigo-600 border-indigo-600 text-white")}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                );
              })}
              <Button size="sm" variant="outline" className="h-6 w-6 p-0" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronDown className="h-3 w-3 -rotate-90" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create modal */}
      {createOpen && (
        <TaskModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          agentList={agentList}
          onSaved={handleSaved}
        />
      )}

      {/* Edit modal */}
      {editTask && (
        <TaskModal
          open={Boolean(editTask)}
          onClose={() => setEditTask(null)}
          editTask={editTask}
          agentList={agentList}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

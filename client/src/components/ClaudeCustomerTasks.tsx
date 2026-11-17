import React, { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CLAUDE_CUSTOMER_TASK_ACTION, type CustomerTask } from "@shared/claudeCustomerTasks";
import "./claude-customer-tasks.css";

export type CustomerTaskView = "open" | "mine" | "done";
export type CustomerTaskActions = {
  claim: (id: number) => Promise<void>;
  completeItem: (id: number, itemId: string) => Promise<void>;
  complete: (id: number, note: string) => Promise<void>;
};
type TaskContextValue = {
  callerId: string;
  tasks: CustomerTask[];
  loading: boolean;
  failed: boolean;
  pendingIds: ReadonlySet<number>;
  actions: CustomerTaskActions;
  onOpenConversation?: (task: CustomerTask) => void;
  refresh: () => void;
};
const TaskContext = createContext<TaskContextValue | null>(null);

export function customerTaskIdFromMessage(message: { quickAction: string | null; metadata: string | null }): number | null {
  if (message.quickAction !== CLAUDE_CUSTOMER_TASK_ACTION) return null;
  try {
    const value: unknown = JSON.parse(message.metadata ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const id = (value as { taskId?: unknown }).taskId;
    return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}

export function customerTaskIsMine(task: CustomerTask, callerId: string): boolean {
  return Boolean(callerId) && task.owner?.id === callerId;
}

export function customerTaskQueues(tasks: readonly CustomerTask[], callerId: string): Record<CustomerTaskView, CustomerTask[]> {
  const sorted = [...tasks].sort((left, right) => right.receivedAt - left.receivedAt || right.id - left.id);
  return {
    open: sorted.filter((task) => task.status !== "done"),
    mine: sorted.filter((task) => task.status === "claimed" && customerTaskIsMine(task, callerId)),
    done: sorted.filter((task) => task.status === "done"),
  };
}

export function customerTaskReplyStatus(status: CustomerTask["reply"]["status"]): string {
  switch (status) {
    case "prepared": return "Prepared · not sent";
    case "sent": return "Sent · provider accepted, delivery not verified";
    case "uncertain": return "Uncertain · sending not confirmed";
    case "suppressed": return "Suppressed · not sent";
  }
}

function taskTimestamp(value: number): string {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function taskAge(value: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - value) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

/** Own only the existing tRPC caches; the page retains its one Ops SSE connection. */
export function ClaudeCustomerTasksProvider({ callerId, children, onOpenConversation }: { callerId: string; children: ReactNode; onOpenConversation?: (task: CustomerTask) => void }) {
  const utils = trpc.useUtils();
  // Use the same Ops authentication as task mutations. Do not reintroduce the
  // global auth.me request or infer identity from a cached display name/cookie.
  const identity = trpc.claudeCustomerTasks.identity.useQuery(undefined, { staleTime: 300_000, retry: false, refetchOnWindowFocus: false });
  const effectiveCallerId = identity.data?.id || "";
  const query = trpc.claudeCustomerTasks.list.useQuery({}, { staleTime: 0, refetchOnWindowFocus: true, retry: false });
  const claim = trpc.claudeCustomerTasks.claim.useMutation();
  const completeItem = trpc.claudeCustomerTasks.completeItem.useMutation();
  const complete = trpc.claudeCustomerTasks.complete.useMutation();
  const inFlight = useRef(new Set<number>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(new Set());
  const refresh = () => { void utils.claudeCustomerTasks.invalidate(); };
  const applyRecord = (record: CustomerTask) => {
    utils.claudeCustomerTasks.get.setData({ id: record.id }, record);
    utils.claudeCustomerTasks.list.setData({}, (current) => current
      ? current.some((task) => task.id === record.id)
        ? current.map((task) => task.id === record.id ? record : task)
        : [...current, record]
      : undefined);
  };
  const cancelReads = (id: number) => Promise.all([
    utils.claudeCustomerTasks.list.cancel({}), utils.claudeCustomerTasks.get.cancel({ id }),
  ]);
  const run = async (id: number, request: () => Promise<CustomerTask>) => {
    if (inFlight.current.has(id)) throw new Error("This task update is already saving. Please wait.");
    inFlight.current.add(id);
    setPendingIds(new Set(inFlight.current));
    try {
      await cancelReads(id);
      const record = await request();
      await cancelReads(id);
      applyRecord(record);
    }
    finally {
      // A conflict must refresh the canonical owner/status too; never claim locally.
      try { await utils.claudeCustomerTasks.invalidate(); } catch { /* Keep a saved canonical record if refresh fails. */ }
      inFlight.current.delete(id);
      setPendingIds(new Set(inFlight.current));
    }
  };
  const actions: CustomerTaskActions = {
    claim: (id) => run(id, () => claim.mutateAsync({ id })),
    completeItem: (id, itemId) => run(id, () => completeItem.mutateAsync({ id, itemId })),
    complete: (id, note) => run(id, () => complete.mutateAsync({ id, note: note.trim() })),
  };
  return <TaskContext.Provider value={{ callerId: effectiveCallerId, tasks: query.data ?? [], loading: query.isLoading || identity.isLoading,
    failed: query.isError || identity.isError, pendingIds, actions, onOpenConversation, refresh }}>{children}</TaskContext.Provider>;
}

function useCustomerTasks() {
  const value = useContext(TaskContext);
  if (!value) throw new Error("Customer tasks require the authenticated Command Chat task provider.");
  return value;
}

export function ClaudeCustomerTasksQueue() {
  const context = useCustomerTasks();
  return <CustomerTaskQueue tasks={context.tasks} callerId={context.callerId} loading={context.loading}
    failed={context.failed} pendingIds={context.pendingIds} actions={context.actions} onOpenConversation={context.onOpenConversation} onRefresh={context.refresh} />;
}

/** Pure input seams allow synthetic SSR validation without importing the real app. */
export function CustomerTaskQueue({ tasks, callerId, loading = false, failed = false, pendingIds = new Set<number>(), actions, onOpenConversation, onRefresh }: {
  tasks: CustomerTask[]; callerId: string; loading?: boolean; failed?: boolean; pendingIds?: ReadonlySet<number>;
  actions: CustomerTaskActions; onOpenConversation?: (task: CustomerTask) => void; onRefresh: () => void;
}) {
  const [view, setView] = useState<CustomerTaskView>("open");
  const queues = customerTaskQueues(tasks, callerId);
  return <section className="cct-queue" aria-label="Customer tasks">
    <div className="cct-queue-controls">
      <div className="cct-views" role="group" aria-label="Task queue view">
        {(["open", "mine", "done"] as const).map((option) => <button type="button" key={option}
          aria-pressed={view === option} onClick={() => setView(option)}>
          {option === "open" ? "Open" : option === "mine" ? "Mine" : "Done"}<b>{queues[option].length}</b>
        </button>)}
      </div>
      <button type="button" className="cct-refresh" title="Refresh tasks" aria-label="Refresh tasks" onClick={onRefresh}><RefreshCw /></button>
    </div>
    {failed && <p className="cct-feedback" role="alert">Tasks could not be refreshed. Retry to get the latest status.</p>}
    {loading ? <p className="cct-feedback" role="status"><Loader2 />Loading tasks…</p> : <>
      <div className="cct-task-list">{queues[view].map((task) => <TaskCard key={task.id} task={task} callerId={callerId}
        pending={pendingIds.has(task.id)} actions={actions} onOpenConversation={onOpenConversation} />)}</div>
      {!queues[view].length && !failed && <p className="cct-feedback">{view === "open" ? "No open tasks." : view === "mine" ? "No tasks claimed by you." : "No staff-confirmed tasks yet."}</p>}
    </>}
  </section>;
}

/** Stream metadata is an id pointer, never a stale task snapshot or message-body inference. */
export function ClaudeCustomerTaskStreamCard({ taskId }: { taskId: number | null }) {
  const context = useCustomerTasks();
  const validId = taskId !== null && Number.isSafeInteger(taskId) && taskId > 0;
  const query = trpc.claudeCustomerTasks.get.useQuery({ id: taskId ?? 0 }, {
    enabled: validId, staleTime: 0, refetchOnWindowFocus: true, retry: false,
  });
  if (!validId) return <p className="cct-feedback" role="status">Task reference unavailable.</p>;
  if (query.isError) return <p className="cct-feedback" role="alert">Task could not be refreshed. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>;
  if (query.isLoading) return <p className="cct-feedback" role="status"><Loader2 />Loading task…</p>;
  if (!query.data) return <p className="cct-feedback" role="status">Task record unavailable.</p>;
  return <TaskCard task={query.data} callerId={context.callerId} pending={context.pendingIds.has(query.data.id)}
    actions={context.actions} onOpenConversation={context.onOpenConversation} placement="stream" />;
}

export function TaskCompletionConfirm({ task, note, pending, error, allowed, onNote, onCancel, onConfirm }: {
  task: CustomerTask; note: string; pending: boolean; error: string; allowed: boolean;
  onNote: (note: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  return <div className="cct-confirm-body">
    <p className="cct-confirm-task">{task.title}<small>{task.customerName || task.customerPhone}</small></p>
    <p>I completed all the actions in this task.</p>
    <p>This records your human confirmation of the entire request and checklist, not system verification.</p>
    <p className="cct-confirm-boundary">No booking change, customer text, or conversation closure is performed.</p>
    <label>Completion note <span>(required)</span><textarea value={note} onChange={(event) => onNote(event.target.value)} placeholder="What did you complete?" rows={2} required /></label>
    {!allowed && <p className="cct-feedback" role="alert">Only the current task owner can mark this done.</p>}
    {error && <p className="cct-feedback" role="alert">{error}</p>}
    <footer><button type="button" disabled={pending} onClick={onCancel}>Cancel</button><button type="button" className="cct-primary"
      disabled={pending || !allowed || !note.trim()} onClick={onConfirm}>{pending ? <Loader2 /> : <Check />}{pending ? "Saving…" : "Confirm done"}</button></footer>
  </div>;
}

/** Same compact card in the queue and stream, always supplied a canonical backend record. */
export function TaskCard({ task, callerId, pending = false, actions, onOpenConversation, placement = "queue", now = Date.now() }: {
  task: CustomerTask; callerId: string; pending?: boolean; actions: CustomerTaskActions;
  onOpenConversation?: (task: CustomerTask) => void; placement?: "queue" | "stream"; now?: number;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const busy = pending || saving;
  const mine = customerTaskIsMine(task, callerId);
  const editable = task.status === "claimed" && mine;
  const canComplete = editable;
  const update = async (request: () => Promise<void>) => {
    if (busy || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setError("");
    try { await request(); }
    catch { setError("Task update failed. The latest owner and status are being refreshed; retry after reviewing them."); }
    finally { busyRef.current = false; setSaving(false); }
  };
  return <article className={`cct-card cct-card-${placement}`} data-task-id={task.id} data-task-status={task.status} aria-label={`Task: ${task.title}`}>
    <header className="cct-card-heading"><span className="cct-task-icon"><ClipboardList /></span><div><span className="cct-task-label">Customer task</span><strong>{task.title}</strong>
      <small className="cct-customer-identity"><span>{task.customerName || "Customer"}</span><span className="cct-customer-phone">{task.customerPhone}</span></small></div><time dateTime={new Date(task.receivedAt).toISOString()} title={taskTimestamp(task.receivedAt)}>{taskAge(task.receivedAt, now)}</time></header>
    <div className="cct-card-status">
      <span>{task.status === "done" ? "Done · human-confirmed" : task.owner ? `Claimed by ${task.owner.name}` : "Unclaimed"}</span>
      {task.status === "unclaimed" && <button type="button" className="cct-primary" disabled={busy || !callerId}
        onClick={() => void update(() => actions.claim(task.id))}>{busy ? <><Loader2 aria-hidden="true" />Claiming…</> : "Claim"}</button>}
      {editable && <button type="button" disabled={busy || !canComplete} title="Confirm all actions in this task are complete"
        onClick={() => { if (!canComplete || busy) return; setError(""); setNote(""); setConfirmOpen(true); }}>Mark done</button>}
    </div>
    <button type="button" className="cct-conversation-link" disabled={!onOpenConversation || !Number.isSafeInteger(task.sessionId) || task.sessionId <= 0}
      onClick={() => { if (onOpenConversation && Number.isSafeInteger(task.sessionId) && task.sessionId > 0) onOpenConversation(task); }}>Open full conversation</button>
    <details className="cct-details"><summary>Customer text &amp; acknowledgment <ChevronDown /></summary><div className="cct-details-body">
      <section className="cct-source-message"><h4>Customer text</h4><p className="cct-verbatim">{task.sourceText}</p></section>
      <section><ul className="cct-items">{task.items.map((item) => {
        const confirmed = item.completedBy !== null && item.completedAt !== null;
        return <li key={item.id}><div><strong>{item.title}</strong>
          {confirmed && <small>Human-confirmed by {item.completedBy!.name} · {taskTimestamp(item.completedAt!)}</small>}</div>
          {confirmed ? <Check aria-label="Item human-confirmed" /> : editable ? <button type="button" disabled={busy}
            aria-label={`Confirm completed item: ${item.title}`} onClick={() => void update(() => actions.completeItem(task.id, item.id))}>Confirm item</button> : <small>Not confirmed</small>}
        </li>;
      })}</ul></section>
      <section className={`cct-reply cct-reply-${task.reply.status}`}><h4>Acknowledgment</h4><strong>{customerTaskReplyStatus(task.reply.status)}</strong>
        <p className="cct-verbatim">{task.reply.text}</p></section>
      {task.status === "done" && <section className="cct-completion"><h4>Staff confirmation</h4><p>Human-confirmed by {task.completedBy?.name || "Staff"}{task.completedAt !== null && ` · ${taskTimestamp(task.completedAt)}`} · not system-verified.</p>
        {task.completionNote && <p className="cct-verbatim">{task.completionNote}</p>}</section>}
      <div className="cct-prepared"><span>Task prepared</span><time dateTime={new Date(task.activity.find((entry) => entry.action === "created")?.at ?? task.receivedAt).toISOString()}>
        {taskTimestamp(task.activity.find((entry) => entry.action === "created")?.at ?? task.receivedAt)}</time></div>
    </div></details>
    {error && !confirmOpen && <p className="cct-feedback" role="alert">{error}</p>}
    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open); }}>
      <DialogContent className="cct-confirm-dialog"><DialogTitle>Mark task done?</DialogTitle>
        <DialogDescription>Staff confirmation only</DialogDescription>
        <TaskCompletionConfirm task={task} note={note} pending={busy} error={error} allowed={canComplete}
          onNote={setNote} onCancel={() => setConfirmOpen(false)} onConfirm={() => {
            if (!canComplete || busy || !note.trim()) return;
            void update(async () => { await actions.complete(task.id, note.trim()); setConfirmOpen(false); });
          }} />
      </DialogContent>
    </Dialog>
  </article>;
}

import React, { createContext, useContext, useRef, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Clock3, History, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { proxyRecordingUrl } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CLAUDE_CUSTOMER_TASK_ACTION, type CustomerTask } from "@shared/claudeCustomerTasks";
import "./claude-customer-tasks.css";
import { ClaudeBookingChangePanel, ManualBookingNotice, bookingChangeHistory, bookingChangeStatus, manualBookingStatus, useBookingChange, useManualBookingChange } from "./ClaudeBookingChangePanel";

export type CustomerTaskView = "open" | "mine" | "done";
export type CustomerTaskActions = {
  claim: (id: number, expectedOwnerId?: string) => Promise<void>;
  completeItem: (id: number, itemId: string) => Promise<void>;
  complete: (id: number, note: string) => Promise<void>;
};
type TaskContextValue = {
  callerId: string;
  tasks: CustomerTask[];
  loading: boolean;
  failed: boolean;
  transientFailure: boolean;
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
    case "not_applicable": return "Not applicable · AI call";
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
  const transientFailure = [identity.error, query.error].every(error => {
    const code = error?.data?.code;
    const httpStatus = error?.data?.httpStatus;
    return (!code || ["INTERNAL_SERVER_ERROR", "TIMEOUT", "TOO_MANY_REQUESTS", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT"].includes(code))
      && (httpStatus === undefined || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500);
  });
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
    claim: (id, expectedOwnerId) => run(id, () => expectedOwnerId === undefined
      ? claim.mutateAsync({ id })
      : claim.mutateAsync({ id, expectedOwnerId })),
    completeItem: (id, itemId) => run(id, () => completeItem.mutateAsync({ id, itemId })),
    complete: (id, note) => run(id, () => complete.mutateAsync({ id, note: note.trim() })),
  };
  return <TaskContext.Provider value={{ callerId: effectiveCallerId, tasks: query.data ?? [], loading: query.isLoading || identity.isLoading,
    failed: query.isError || identity.isError, transientFailure, pendingIds, actions, onOpenConversation, refresh }}>{children}</TaskContext.Provider>;
}

function useCustomerTasks() {
  const value = useContext(TaskContext);
  if (!value) throw new Error("Customer tasks require the authenticated Command Chat task provider.");
  return value;
}

/** Exact persisted SMS session only: no phone/name matching or call/email tasks. */
export function customerSmsConversationTasks(tasks: readonly CustomerTask[], sessionId: number): CustomerTask[] {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return [];
  return tasks.filter(task => !("call" in task) && !("email" in task) && task.sessionId === sessionId)
    .sort((left, right) => left.receivedAt - right.receivedAt || left.id - right.id);
}

type SmsTaskSourceMessage = { role?: unknown; opMsgId?: unknown; openPhoneId?: unknown; openPhoneMessageId?: unknown; providerMessageId?: unknown; metadata?: unknown };
/** Same retained provider-ID aliases as the saved SMS binding; never infer from text/time. */
export function customerSmsTaskMessageAnchors(messages: readonly SmsTaskSourceMessage[]): Array<string | null> {
  const counts = new Map<string, number>();
  const candidates = messages.map(message => {
    if (!message) return null;
    const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
      ? message.metadata as SmsTaskSourceMessage : null;
    const ids = Array.from(new Set([message, metadata].flatMap(part => part
      ? [part.opMsgId, part.openPhoneId, part.openPhoneMessageId, part.providerMessageId] : [])
      .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))));
    ids.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
    return (message.role === "user" || message.role === "customer") && ids.length === 1 ? ids[0] : null;
  });
  return candidates.map(id => id !== null && counts.get(id) === 1 ? id : null);
}

/** Reuse the shared authenticated list and task card; opening a task is read-only. */
export function ClaudeSmsConversationTasks({ sessionId, children }: { sessionId: number; children: (afterMessage: (sourceMessageId: string) => ReactNode) => ReactNode }) {
  const context = useCustomerTasks();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const tasks = customerSmsConversationTasks(context.tasks, sessionId);
  const selected = tasks.find(task => task.id === selectedId) ?? null;
  const byMessage = new Map<string, CustomerTask[]>();
  tasks.forEach(task => byMessage.set(task.sourceMessageId, [...(byMessage.get(task.sourceMessageId) ?? []), task]));
  const afterMessage = (sourceMessageId: string) => {
    const attached = byMessage.get(sourceMessageId) ?? [];
    if (!attached.length) return null;
    return <div className="cct-message-tasks" aria-label="Tasks from this message">
      {context.failed && <p role="alert">Tasks could not be refreshed. {context.transientFailure && "Showing the last loaded status. "}<button type="button" onClick={() => void context.refresh()}>Retry</button></p>}
      {context.loading ? <p role="status">Loading task status…</p> : (!context.failed || context.transientFailure) && attached.map(task =>
        <button className="cct-message-task" key={task.id} type="button" aria-haspopup="dialog" aria-label={`View task: ${task.title} — ${task.status === "done" ? "Done" : "Open"}`} onClick={event => { opener.current = event.currentTarget; setSelectedId(task.id); }}>
          <span className="cct-message-task-label"><ClipboardList aria-hidden="true" />Task</span><span className="cct-message-task-title">{task.title}</span><span className="cct-message-task-status" data-status={task.status === "done" ? "done" : "open"}>{task.status === "done" ? "Done" : "Open"}</span>
        </button>
      )}
    </div>;
  };
  return <>
    {children(afterMessage)}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelectedId(null); }}>
      <DialogContent className="cct-confirm-dialog cct-related-task-dialog" onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus({ preventScroll: true }); }}><DialogTitle>Task details</DialogTitle><DialogDescription>Existing task from this SMS conversation</DialogDescription>
        <TaskContext.Provider value={{ ...context, onOpenConversation: () => setSelectedId(null) }}>
          {selected && <ClaudeCustomerTaskStreamCard taskId={selected.id} defaultExpanded />}
        </TaskContext.Provider>
      </DialogContent>
    </Dialog>
  </>;
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
export function ClaudeCustomerTaskStreamCard({ taskId, defaultExpanded = false }: { taskId: number | null; defaultExpanded?: boolean }) {
  const context = useCustomerTasks();
  const validId = taskId !== null && Number.isSafeInteger(taskId) && taskId > 0;
  if (!validId) return <p className="cct-feedback" role="status">Task reference unavailable.</p>;
  const task = context.tasks.find(record => record.id === taskId) ?? null;
  if (context.failed && (!task || !context.transientFailure)) return <p className="cct-feedback" role="alert">Task could not be refreshed. <button type="button" onClick={() => void context.refresh()}>Retry</button></p>;
  if (context.loading) return <p className="cct-feedback" role="status"><Loader2 />Loading task…</p>;
  if (!task) return <p className="cct-feedback" role="status">Task record unavailable.</p>;
  return <>
    <TaskCard key={task.id} task={task} callerId={context.callerId} pending={context.pendingIds.has(task.id)}
      actions={context.actions} onOpenConversation={context.onOpenConversation} placement="stream" defaultExpanded={defaultExpanded} />
    {context.failed && <p className="cct-feedback" role="alert">Task could not be refreshed. Showing the last loaded status. <button type="button" onClick={() => void context.refresh()}>Retry</button></p>}
  </>;
}

/** Canonical call evidence needs no SMS session or conversation lookup. */
export function CustomerTaskCallRecording({ taskId }: { taskId: number }) {
  const recording = trpc.claudeCustomerTasks.recording.useQuery({ id: taskId }, { retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const url = proxyRecordingUrl(recording.data?.url);
  const retry = () => { setFailedUrl(null); setAttempt(value => value + 1); void recording.refetch(); };
  if (recording.isLoading) return <p role="status">Loading call recording…</p>;
  if (recording.isError) return <p role="alert">Call recording unavailable. <button type="button" onClick={retry}>Retry</button></p>;
  if (!url) return <p>Call recording unavailable.</p>;
  return <section aria-label="Call recording"><h4>Call recording</h4>
    <audio key={`${url}:${attempt}`} controls preload="metadata" className="w-full" aria-label="Call recording" src={url} onError={() => setFailedUrl(url)} />
    {failedUrl === url && <p role="alert">Audio could not be loaded. <button type="button" onClick={retry}>Retry</button></p>}
    <a href={url} target="_blank" rel="noopener noreferrer">Open call recording</a>
  </section>;
}
/** Display-only source slices: preserve paragraph boundaries and all original words. */
export function phoneCallReadingParagraphs(content: string): string[] {
  return content.split(/\r?\n[\t ]*\r?\n/).filter(paragraph => paragraph.trim()).flatMap(paragraph => {
    const sentences = typeof Intl.Segmenter === "function"
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(paragraph), item => item.segment)
      : [paragraph];
    const result: string[] = [];
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > 350) { result.push(current); current = ""; }
      if (sentence.length > 600) {
        if (current) { result.push(current); current = ""; }
        result.push(...(sentence.match(/(?:\s*\S+){1,45}\s*/g) ?? [sentence]));
      } else current += sentence;
    }
    if (current) result.push(current);
    return result;
  });
}

export function CustomerTaskPhoneTranscript({ task }: { task: Extract<CustomerTask, { call: unknown }> }) {
  const saved = task.call.provider === "openphone" && task.call.transcriptSource === "saved";
  const blocks = task.call.transcript.split(saved ? /(?=^[\t ]*Unattributed:)/im : /(?=^[\t ]*(?:Caller|Staff|Unattributed):)/im).filter(block => block.trim());
  const hasUnknownSpeaker = saved || blocks.some(block => !/^[\t ]*(?:Caller|Staff):/i.test(block));
  return <div className="cct-phone-transcript">
    {hasUnknownSpeaker && <p className="cct-phone-transcript-notice">Speaker not identified{saved ? " — this transcript may include both sides of the call." : " for some or all of this recording."}</p>}
    {blocks.map((block, index) => {
      const match = block.match(/^[\t ]*(Caller|Staff|Unattributed):([\s\S]*)$/i);
      const labeled = match && (!saved || /^unattributed$/i.test(match[1]));
      const content = labeled ? match[2] : block;
      return <article className="cct-call-turn" data-speaker={labeled ? match[1].toLowerCase() : "unattributed"} key={index}>
        {labeled && <strong className="cct-call-speaker">{match[1]}:</strong>}
        {phoneCallReadingParagraphs(content).map((paragraph, paragraphIndex) => <p className="cct-verbatim" key={paragraphIndex}>{paragraph}</p>)}
      </article>;
    })}
  </div>;
}

/** Use the AI Calls page's line/label presentation, without inventing speaker identity.
 * Saved Whisper evidence is not diarized: label-like words inside it remain prose. */
export function CustomerTaskCallTranscript({ task }: { task: Extract<CustomerTask, { call: unknown }> }) {
  if (task.call.provider === "openphone") return <CustomerTaskPhoneTranscript task={task} />;
  const unattributed = false; // The existing AI-call line/label presentation is unchanged.
  return <div className="cct-call-transcript">{task.call.transcript.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const match = line.match(/^\s*(Assistant|AI|User|Caller|Customer|Client|Staff|Unattributed):([\s\S]*)$/i);
    const labeled = match && (!unattributed || /^unattributed$/i.test(match[1]));
    const content = labeled ? match[2] : line;
    // Neutral reading paragraphs only; do not imply new speakers or alter words.
    const paragraphs = content.match(/(?:\s*\S+){1,60}\s*/g) ?? [content];
    return <article className="cct-call-turn" key={index}>
      {labeled && <strong className="cct-call-speaker">{match[1]}:</strong>}
      {paragraphs.map((paragraph, paragraphIndex) => <p className="cct-verbatim" key={paragraphIndex}>{paragraph}</p>)}
    </article>;
  })}</div>;
}
export function CustomerTaskCallEvidence({ task }: { task: Extract<CustomerTask, { call: unknown }> }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className="cct-conversation-link">Open full call</button></DialogTrigger>
    <DialogContent className="cct-confirm-dialog">
      <DialogTitle>{task.call.provider === "openphone" ? "Full staff call" : "Full AI call"}</DialogTitle>
      <DialogDescription>{task.customerName || (task.call.provider === "openphone" ? "Caller" : "Customer")}{task.customerPhone && ` · ${task.customerPhone}`}</DialogDescription>
      <div className="cct-confirm-body">
        <section aria-label="Full call transcript"><h4>Full call transcript</h4><CustomerTaskCallTranscript task={task} /></section>
        {open && task.call.recordingUrl && <CustomerTaskCallRecording taskId={task.id} />}
      </div>
    </DialogContent>
  </Dialog>;
}

export function TaskCompletionConfirm({ task, note, pending, error, allowed, onNote, onCancel, onConfirm }: {
  task: CustomerTask; note: string; pending: boolean; error: string; allowed: boolean;
  onNote: (note: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  return <div className="cct-confirm-body">
    <p className="cct-confirm-task">{task.title}<small>{task.customerName || ("email" in task ? task.email.fromEmail : task.customerPhone)}</small></p>
    <p>I completed all the actions in this task.</p>
    <p>This records your human confirmation of the entire request and checklist, not system verification.</p>
    <p className="cct-confirm-boundary">{"call" in task ? "No booking change, customer call, customer text, or conversation closure is performed." : "email" in task ? "No booking change, customer email, or conversation closure is performed." : "No booking change, customer text, or conversation closure is performed."}</p>
    <label>Completion note <span>(required)</span><textarea value={note} onChange={(event) => onNote(event.target.value)} placeholder="What did you complete?" rows={2} required /></label>
    {!allowed && <p className="cct-feedback" role="alert">Only the current task owner can mark this done.</p>}
    {error && <p className="cct-feedback" role="alert">{error}</p>}
    <footer><button type="button" disabled={pending} onClick={onCancel}>Cancel</button><button type="button" className="cct-primary"
      disabled={pending || !allowed || !note.trim()} onClick={onConfirm}>{pending ? <Loader2 /> : <Check />}{pending ? "Saving…" : "Confirm done"}</button></footer>
  </div>;
}

/** Same compact card in the queue and stream, always supplied a canonical backend record. */
export function TaskCard({ task, callerId, pending = false, actions, onOpenConversation, placement = "queue", now = Date.now(), defaultExpanded = false }: {
  task: CustomerTask; callerId: string; pending?: boolean; actions: CustomerTaskActions;
  onOpenConversation?: (task: CustomerTask) => void; placement?: "queue" | "stream"; now?: number; defaultExpanded?: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const busy = pending || saving;
  const mine = customerTaskIsMine(task, callerId);
  const editable = task.status === "claimed" && mine;
  const canComplete = editable;
  const booking = useBookingChange(task, expanded);
  const update = async (request: () => Promise<void>) => {
    if (busy || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setError("");
    try { await request(); }
    catch { setError("Task update failed. The latest owner and status are being refreshed; retry after reviewing them."); }
    finally { busyRef.current = false; setSaving(false); }
  };
  const call = "call" in task ? task.call : null;
  const channel = call ? call.provider === "openphone" ? "Phone call" : "AI call" : "email" in task ? "Email" : "SMS";
  const name = task.customerName || (call?.provider === "openphone" ? "Caller" : "Customer");
  const contact = "email" in task ? task.email.fromEmail : task.customerPhone;
  const done = task.status === "done";
  // Launch27 or unclear booking: always "Manual action required", never an automated or verified status.
  const manual = useManualBookingChange(task, booking.data);
  const status = manual ? manualBookingStatus(manual) : bookingChangeStatus(booking.data);
  const record = booking.data?.record ?? null;
  // Booking-related cards focus on the appointment once it has changed; others show the request and checklist.
  const showRequest = !call && !("email" in task) && !record;
  const showChecklist = !record || task.items.length > 1;
  const created = task.activity.find((entry) => entry.action === "created")?.at ?? task.receivedAt;
  // Audit trail. Activity notes can hold internal ids (item ids, owner ids), so only human text is shown.
  const history = [
    { at: created, text: "Task prepared" },
    ...task.activity.filter((entry) => entry.action === "claimed").map((entry) => ({ at: entry.at, text: `Claimed${entry.actor ? ` · ${entry.actor.name}` : ""}` })),
    ...task.items.filter((item) => item.completedBy !== null && item.completedAt !== null)
      .map((item) => ({ at: item.completedAt!, text: `Confirmed "${item.title}" · ${item.completedBy!.name}` })),
    ...(done ? [{ at: task.completedAt ?? created, text: `Marked done · ${task.completedBy?.name || "Staff"}${task.completionNote ? ` · ${task.completionNote}` : ""}` }] : []),
    ...bookingChangeHistory(record),
    ...(booking.dismissed ?? []).flatMap((dismissed) => bookingChangeHistory(dismissed)),
  ].sort((a, b) => a.at - b.at);
  const sourceLabel = call ? call.provider === "openphone" ? "Call evidence" : "Caller evidence" : "email" in task ? "Customer email" : "Customer text";
  const canOpenConversation = !call && Boolean(onOpenConversation) && ("email" in task ? Boolean(task.email.threadId) : typeof task.sessionId === "number" && Number.isSafeInteger(task.sessionId) && task.sessionId > 0);
  return <article className={`cct-card cct-card-${placement}${expanded ? " cct-card-open" : ""}`} data-task-id={task.id} data-task-status={task.status} aria-label={`Task: ${task.title}`}>
    <header className="cct-card-heading">
      <span className="cct-task-icon" aria-hidden="true">{done ? <CheckCircle2 /> : <ClipboardList />}</span>
      <div className="cct-card-title">
        <strong className={expanded ? undefined : "cct-clamp"} title={expanded ? undefined : task.title}>{task.title}</strong>
        <small className="cct-card-meta">{name} · {channel} · <time dateTime={new Date(task.receivedAt).toISOString()} title={taskTimestamp(task.receivedAt)}>{taskAge(task.receivedAt, now)}</time></small>
        {expanded && contact && <small className="cct-customer-phone">{contact}</small>}
      </div>
      <button type="button" className="cct-expand" aria-expanded={expanded} aria-label={expanded ? "Collapse task" : "Expand task"} onClick={() => setExpanded((open) => !open)}>
        {expanded ? <ChevronUp /> : <ChevronDown />}</button>
    </header>
    {!expanded && status && <p className={`cbc-status cbc-status-${status.tone}`}>{status.tone === "done" ? <CheckCircle2 aria-hidden="true" /> : status.tone === "warning" ? <AlertTriangle aria-hidden="true" /> : <Clock3 aria-hidden="true" />}{status.text}</p>}
    <div className="cct-card-status">
      <span>{done ? `Completed by ${task.completedBy?.name || "Staff"}` : task.owner ? `Claimed by ${task.owner.name}` : "Unclaimed"}</span>
      {task.status === "unclaimed" && <button type="button" className="cct-primary" disabled={busy || !callerId}
        onClick={() => void update(() => actions.claim(task.id))}>{busy ? <><Loader2 aria-hidden="true" />Claiming…</> : "Claim"}</button>}
      {task.status === "claimed" && !mine && task.owner && <button type="button" className="cct-primary" disabled={busy || !callerId}
        title={`Take over from ${task.owner.name}`} onClick={() => void update(() => actions.claim(task.id, task.owner!.id))}>
        {busy ? <><Loader2 aria-hidden="true" />Taking over…</> : "Take over"}</button>}
      {editable && <button type="button" disabled={busy || !canComplete} title="Confirm all actions in this task are complete"
        onClick={() => { if (!canComplete || busy) return; setError(""); setNote(""); setConfirmOpen(true); }}>Mark done</button>}
    </div>
    {"call" in task ? <CustomerTaskCallEvidence task={task} /> : <button type="button" className="cct-conversation-link" disabled={!canOpenConversation}
      onClick={() => { if (canOpenConversation && onOpenConversation) onOpenConversation(task); }}>Open full conversation</button>}
    {expanded && <div className="cct-card-body">
      {showRequest && <section className="cct-block"><h5>Customer request</h5><p className="cct-verbatim cct-request">{task.sourceText}</p></section>}
      {manual && <ManualBookingNotice task={task} manual={manual} />}
      {!call && !("email" in task) && <ClaudeBookingChangePanel task={task} manual={manual} />}
      {showChecklist && <section className="cct-block"><h5>Checklist</h5><ul className="cct-items">{task.items.map((item) => {
        const confirmed = item.completedBy !== null && item.completedAt !== null;
        return <li key={item.id}>
          {confirmed ? <span className="cct-check cct-check-done" role="img" aria-label="Item human-confirmed"><Check /></span>
            : editable ? <button type="button" className="cct-check" disabled={busy} aria-label={`Confirm completed item: ${item.title}`}
              onClick={() => void update(() => actions.completeItem(task.id, item.id))} />
            : <span className="cct-check" role="img" aria-label="Not confirmed" />}
          <div><span>{item.title}</span>
            {call && <blockquote>{item.evidenceQuote}</blockquote>}
            {"email" in task && task.email.bodyFormat === "html" && <div className="cct-verbatim" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.evidenceQuote, { USE_PROFILES: { html: true }, FORBID_ATTR: ["style", "color", "bgcolor"] }) }} />}
          </div>
        </li>;
      })}</ul></section>}
      <details className="cct-details"><summary>{call ? sourceLabel : <>{sourceLabel} &amp; acknowledgment</>}<ChevronDown /></summary><div className="cct-details-body">
        <section className="cct-source-message"><h5>{sourceLabel}</h5>{"email" in task && task.email.bodyFormat === "html"
          ? <div className="cct-verbatim" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(task.sourceText, { USE_PROFILES: { html: true }, FORBID_ATTR: ["style", "color", "bgcolor"] }) }} />
          : <p className="cct-verbatim">{task.sourceText}</p>}</section>
        {!call && <section className={`cct-reply cct-reply-${task.reply.status}`}><h5>Acknowledgment · {customerTaskReplyStatus(task.reply.status)}</h5>
          <p className="cct-verbatim">{task.reply.text}</p></section>}
      </div></details>
      <details className="cct-details"><summary><span><History aria-hidden="true" />Activity history ({history.length})</span><ChevronDown /></summary>
        <ul className="cct-log">{history.map((entry, index) => <li key={index}><time dateTime={new Date(entry.at).toISOString()}>{taskTimestamp(entry.at)}</time><span>{entry.text}</span></li>)}</ul>
      </details>
    </div>}
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

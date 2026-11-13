import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LockKeyhole, MessageSquareText, Pause, Play, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import type { AuditMessage, AuditRecord } from "@shared/dailyActionAudit";
import type { LiveTextAction, LiveTextCheck, LiveTextFeed, LiveTextFeedFailure, LiveTextRow } from "@shared/liveTextMonitor";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "@shared/bookingWidgetConfig";
import "./live-text-monitor.css";

const VISIBLE_LIMIT = 100;
const INITIAL_CHECK_LIMIT = 10;
const FALLBACK_MS = 5_000;
type Entry = { row: LiveTextRow; state: "unchecked" | "pending" | "done" | "error"; check?: LiveTextCheck; automatic: boolean; epoch: number };
type CheckTask = { key: string; revision: string; epoch: number };

function timestamp(value: string | null): number {
  if (!value || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
function messageTime(message: AuditMessage): number {
  return timestamp(message.occurredAt) || timestamp(message.observedAt);
}
function timeLabel(message: AuditMessage): string {
  const time = messageTime(message);
  return time ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(time)) : "Time unavailable";
}
function short(value: string, limit = 160): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
function safeLink(href: string): boolean {
  return href === "/admin/bookings" || href === "/admin/schedule";
}
function feedFailureReason(failure: LiveTextFeedFailure | undefined): string {
  switch (failure) {
    case "DB_UNAVAILABLE": return "Stored conversation history is temporarily unavailable.";
    case "DB_SCHEMA": return "Stored conversation history could not be read in its current format.";
    case "DB_TIMEOUT": return "Reading stored conversation history timed out.";
    default: return "Stored conversation history could not be read. Please try again.";
  }
}
function recordFields(type: LiveTextAction["type"], record: AuditRecord): Array<[string, string | null]> {
  switch (type) {
    case "address": return [["Address", record.address]];
    case "assignment": return [["Team", record.teamName]];
    case "service": return [["Service", record.serviceName], ["Extras", record.extras?.map(value => BOOKING_WIDGET_PRICED_EXTRAS.find(extra => extra.id === value)?.label ?? value).join(", ") || (record.extras ? "None" : null)]];
    case "payment": return [["Payment", record.paymentStatus], ["Paid", record.paidAmountCents !== null && Number.isFinite(record.paidAmountCents) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(record.paidAmountCents / 100) : null]];
    default: return [["Service date", record.date], ["Arrival", record.time], ["Status", record.status]];
  }
}

function conversationFor(entry: Entry, entries: Entry[]): AuditMessage[] {
  const phone = entry.row.message.customerPhone;
  const line = entry.row.message.businessPhone;
  const exactPhone = /^\+1\d{10}$/.test(phone);
  const exactLine = typeof line === "string" && /^\+1\d{10}$/.test(line);
  const exactSession = Number.isSafeInteger(entry.row.sessionId) && entry.row.sessionId > 0 && entry.row.message.sessionId === entry.row.sessionId;
  // AI Team's stored conversation is one exact session, never phone/line siblings.
  const sameConversation = (message: AuditMessage) => !entry.row.identityAmbiguous && exactPhone && exactSession &&
    message.customerPhone === phone && message.sessionId === entry.row.sessionId &&
    (exactLine ? message.businessPhone === line : line === null && message.businessPhone === null);
  const stored = entries.filter(value => !value.row.identityAmbiguous && sameConversation(value.row.message) &&
    value.row.sessionId === entry.row.sessionId).map(value => value.row.message);
  const messages = [...stored, ...(entry.check?.conversation ?? []), entry.row.message]
    .filter(message => message === entry.row.message || sameConversation(message));
  return Array.from(new Map(messages.map(message => [message.key, message])).values())
    .sort((a, b) => (messageTime(a) || Infinity) - (messageTime(b) || Infinity) || a.key.localeCompare(b.key));
}

function Status({ label, detail, tone }: { label: string; detail: string; tone: string }) {
  return <div className="ltm-decision"><strong className={`ltm-status ltm-status-${tone}`}>{label}</strong>{detail && <p>{short(detail)}</p>}</div>;
}

export function LiveTextMessageRow({ entry, entries, enabled, onCheck }: { entry: Entry; entries: Entry[]; enabled: boolean; onCheck: (key: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const { row, state } = entry;
  // Keep exact-session conversation context, but never show previous record proof while checking or after an error.
  const check = state === "done" ? entry.check : undefined;
  const recordNames = Array.from(new Set((entry.check?.actions ?? []).flatMap(action => action.records)
    .filter(record => record.customerPhone === row.message.customerPhone && record.customerName?.trim())
    .map(record => record.customerName!.trim())));
  const displayName = row.customerName || (recordNames.length === 1 ? recordNames[0] : null);
  const required = state === "error" ? "review" : check?.required;
  const verified = state === "error" ? "review" : check?.verified;
  const label = (decision: string | undefined) => decision === "yes" ? "Yes" : decision === "no" ? "No" : decision === "not_applicable" ? "Not needed" : decision === "review" ? "Review" : state === "pending" ? "Checking…" : "Not checked";
  const requiredDetail = state === "error" ? "Check unavailable" : check?.summary ?? "";
  const verifiedDetail = state === "error" ? "Check again to review the record" : check?.evidence ?? "";
  return <div className="ltm-row" role="row">
    <div className="ltm-person" role="cell"><strong>{row.identityAmbiguous || recordNames.length > 1 ? "Name needs review" : displayName || "Name unavailable"}</strong><span>{row.message.customerPhone || "Phone unavailable"}</span></div>
    <div className="ltm-conversation" role="cell">
      <button type="button" className="ltm-expand" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}><span className="ltm-preview">{row.message.text || "Text unavailable"}</span><ChevronDown size={16} aria-hidden="true" /></button>
      <div className="ltm-message-meta"><span>{row.message.direction === "inbound" ? "Customer" : "Business"} · {timeLabel(row.message)}</span><button type="button" className="ltm-check" disabled={!enabled || state === "pending"} onClick={() => onCheck(row.key)}>{state === "pending" ? "Checking…" : "Check"}</button></div>
      {check?.syncs?.map((sync, index) => <p key={`${sync.date}:${index}`} className={`ltm-sync-status ltm-sync-${sync.complete && !sync.failure ? "synced" : "incomplete"}`} role="status">{sync.complete && !sync.failure ? `Synced ${sync.date}` : `Incomplete · ${sync.date} · Review`}</p>)}
      {expanded && <div id={detailId} className="ltm-details">
        <h2>Recent conversation (last 20 stored entries)</h2><ol className="ltm-thread">{conversationFor(entry, entries).map(message => <li key={message.key} className={`ltm-text ltm-text-${message.direction}`}><div><strong>{message.direction === "inbound" ? "Customer" : "Business"}</strong><span>{timeLabel(message)}</span></div><p>{message.text || "Text unavailable"}</p></li>)}</ol>
        {check?.actions.map(action => <section className="ltm-action" key={action.id}><h3>Requested action</h3><p>{short(action.summary)}</p><h3>Current record</h3><p>{short(action.evidence) || "Record needs review"}</p>{action.records.map((record, index) => <dl key={record.key || index}>{recordFields(action.type, record).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value || "Unavailable"}</dd></div>)}</dl>)}{action.links.some(link => safeLink(link.href)) && <nav aria-label="Current record links">{action.links.filter(link => safeLink(link.href)).map((link, index) => <a key={index} href={link.href}>{link.label || "Open record"}</a>)}</nav>}</section>)}
      </div>}
    </div>
    <div className="ltm-required" role="cell" aria-label="Action required"><span className="ltm-mobile-label">Action required</span><Status label={state === "pending" ? "Checking…" : label(required)} detail={requiredDetail} tone={state === "pending" ? "pending" : required ?? state} /></div>
    <div className="ltm-verified" role="cell" aria-label="Action verified"><span className="ltm-mobile-label">Action verified</span><Status label={state === "pending" ? "Checking…" : label(verified)} detail={verifiedDetail} tone={state === "pending" ? "pending" : verified ?? state} /></div>
  </div>;
}

export function LiveTextWorkspace() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [paused, setPaused] = useState(false);
  const [foreground, setForeground] = useState(() => typeof document !== "undefined" && document.visibilityState === "visible");
  const [unavailable, setUnavailable] = useState(false);
  const [failure, setFailure] = useState<LiveTextFeedFailure | undefined>();
  const [partial, setPartial] = useState(false);
  const mounted = useRef(false);
  const running = useRef(false);
  const rows = useRef(new Map<string, Entry>());
  const order = useRef<string[]>([]);
  const initialized = useRef(false);
  const queue = useRef<CheckTask[]>([]);
  const activeCheck = useRef<CheckTask | null>(null);
  const operationEpoch = useRef(0);
  const feedBusy = useRef(false);
  const feedDirty = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mounted only behind the admin gate. Explicit refetch owns ALL foreground requests;
  // React Query must not start a second fetch on focus/reconnect or retry in the background.
  const feed = trpc.aiActions.liveText.feed.useQuery(undefined, { enabled: false, retry: false, gcTime: 0, staleTime: 0, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false });
  const check = trpc.aiActions.liveText.checkAndSync.useMutation({ retry: false, gcTime: 0 });
  const transport = useRef({ refetch: feed.refetch, mutateAsync: check.mutateAsync });
  transport.current = { refetch: feed.refetch, mutateAsync: check.mutateAsync };
  const enabled = foreground && !paused;
  running.current = enabled;

  function canRun(): boolean {
    return mounted.current && running.current && document.visibilityState === "visible";
  }
  function publish() {
    if (mounted.current) setEntries(order.current.map(key => rows.current.get(key)).filter((entry): entry is Entry => Boolean(entry)));
  }
  function clearTimers() {
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    if (fallbackTimer.current !== null) clearTimeout(fallbackTimer.current);
    refreshTimer.current = null;
    fallbackTimer.current = null;
  }
  function matching(task: CheckTask): Entry | undefined {
    const entry = rows.current.get(task.key);
    return mounted.current && entry?.row.revision === task.revision && entry.epoch === task.epoch ? entry : undefined;
  }
  function enqueue(entry: Entry) {
    if (queue.current.some(task => task.key === entry.row.key && task.epoch === entry.epoch)) return;
    if (activeCheck.current?.key === entry.row.key && activeCheck.current.epoch === entry.epoch) return;
    entry.state = "pending";
    queue.current.push({ key: entry.row.key, revision: entry.row.revision, epoch: entry.epoch });
  }
  async function drain() {
    if (!canRun() || activeCheck.current) return;
    let task: CheckTask | undefined;
    let entry: Entry | undefined;
    while ((task = queue.current.shift())) {
      entry = matching(task);
      if (entry) break;
    }
    if (!task || !entry) return;
    const requested = task;
    activeCheck.current = requested;
    try {
      const result: LiveTextCheck = await transport.current.mutateAsync({ sessionId: entry.row.sessionId, messageKey: entry.row.message.key });
      const current = matching(requested);
      if (!current) return;
      if (result.rowKey !== requested.key || result.revision !== requested.revision) {
        // The stored text changed before the next feed arrived: never install stale proof.
        current.state = "error";
        current.check = undefined;
        requestRefresh();
      } else {
        current.check = result;
        current.state = "done";
      }
    } catch {
      const current = matching(requested);
      if (current) current.state = "error";
    } finally {
      activeCheck.current = null;
      if (mounted.current) {
        publish();
        // Pausing stops NEW calls, not a check that was already sent.
        void drain();
      }
    }
  }
  function applyFeed(result: LiveTextFeed) {
    if (result.unavailable) { setUnavailable(true); setFailure(result.failure); return; }
    const latest = Array.from(new Map(result.rows.map(row => [row.key, row])).values())
      .sort((a, b) => messageTime(b.message) - messageTime(a.message) || b.sessionId - a.sessionId || b.key.localeCompare(a.key))
      .slice(0, VISIBLE_LIMIT);
    const next = new Map<string, Entry>();
    latest.forEach((row, index) => {
      const previous = rows.current.get(row.key);
      const automatic = previous ? previous.automatic || previous.state !== "unchecked" : initialized.current || index < INITIAL_CHECK_LIMIT;
      const entry: Entry = previous?.row.revision === row.revision ? { ...previous, row } : { row, state: "unchecked", automatic, epoch: ++operationEpoch.current };
      next.set(row.key, entry);
      if (automatic && (!previous || previous.row.revision !== row.revision)) enqueue(entry);
    });
    rows.current = next;
    order.current = latest.map(row => row.key);
    initialized.current = true;
    queue.current = queue.current.filter(task => next.get(task.key)?.epoch === task.epoch);
    setUnavailable(false);
    setFailure(undefined);
    setPartial(result.partial);
    publish();
    void drain();
  }
  async function refresh() {
    if (!canRun()) return;
    if (feedBusy.current) { feedDirty.current = true; return; }
    feedBusy.current = true;
    try {
      const response = await transport.current.refetch({ cancelRefetch: false });
      if (!canRun()) return;
      if (response.error || !response.data) { setUnavailable(true); setFailure(undefined); }
      else applyFeed(response.data);
    } catch {
      if (canRun()) { setUnavailable(true); setFailure(undefined); }
    } finally {
      feedBusy.current = false;
      if (feedDirty.current) {
        feedDirty.current = false;
        requestRefresh();
      }
    }
  }
  function requestRefresh() {
    if (!canRun()) return;
    if (feedBusy.current) { feedDirty.current = true; return; }
    if (refreshTimer.current !== null) return;
    refreshTimer.current = setTimeout(() => { refreshTimer.current = null; void refresh(); }, 120);
  }
  function reverify() {
    if (!canRun()) return;
    // A job + booking event burst shares the existing bounded recheck batch.
    // Do not fill its emptied top slots with another ten older actionable rows.
    if (order.current.some(key => {
      const entry = rows.current.get(key);
      return entry?.state === "pending" && entry.check?.required === "yes";
    })) return;
    order.current.map(key => rows.current.get(key)).filter((entry): entry is Entry => Boolean(entry && entry.state === "done" && entry.check?.required === "yes"))
      .slice(0, INITIAL_CHECK_LIMIT).forEach(enqueue);
    publish();
    void drain();
  }
  function manualCheck(key: string) {
    if (!canRun()) return;
    const entry = rows.current.get(key);
    if (!entry || entry.state === "pending") return;
    entry.automatic = true;
    enqueue(entry);
    publish();
    void drain();
  }

  useEffect(() => {
    mounted.current = true;
    const visibility = () => {
      if (document.visibilityState !== "visible") { running.current = false; clearTimers(); }
      setForeground(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      running.current = false;
      clearTimers();
      queue.current = [];
      rows.current.clear();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useOpsStream({ onNewMessage: requestRefresh, onLeadUpdate: requestRefresh, onConnected: requestRefresh, onJobUpdate: reverify, onBookingFunnelUpdate: reverify }, { enabled, label: "Live Text Monitor" });

  useEffect(() => {
    if (!enabled) { clearTimers(); return; }
    void refresh();
    void drain();
    function fallback() {
      fallbackTimer.current = setTimeout(() => {
        fallbackTimer.current = null;
        if (!canRun()) return;
        // Covers stored texts inserted after their SSE event. It never rechecks unchanged texts.
        requestRefresh();
        fallback();
      }, FALLBACK_MS);
    }
    fallback();
    return clearTimers;
  }, [enabled]);

  function togglePause() {
    running.current = paused && foreground;
    if (!paused) clearTimers();
    setPaused(value => !value);
  }
  const needsAction = entries.filter(entry => entry.state !== "error" && entry.check?.required === "yes" && entry.check.verified !== "yes").length;
  const verifiedCount = entries.filter(entry => entry.state === "done" && entry.check?.verified === "yes").length;
  const initialLoading = !initialized.current && !unavailable;
  const showCounts = initialized.current && (!unavailable || entries.length > 0);
  const healthy = initialized.current && !unavailable && enabled;
  return <main className="live-text-monitor-page"><div className="ltm-content">
    <header className="ltm-header"><div><h1><MessageSquareText size={23} aria-hidden="true" />Live Text Monitor</h1><p>Reads stored texts · future service dates sync automatically while open</p></div><button type="button" className="ltm-pause" aria-pressed={paused} onClick={togglePause}>{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}{paused ? "Resume" : "Pause"}</button></header>
    <section className="ltm-summary" aria-label={unavailable && entries.length ? "Cached text summary" : "Text summary"}><span><strong>{showCounts ? entries.length : "—"}</strong> {unavailable && entries.length ? "Cached texts" : "Texts"}</span><span><strong>{showCounts ? needsAction : "—"}</strong> {unavailable && entries.length ? "Cached needs action" : "Needs action"}</span><span><strong>{showCounts ? verifiedCount : "—"}</strong> {unavailable && entries.length ? "Cached verified" : "Verified"}</span><span className={`ltm-live ${healthy ? "ltm-live-on" : ""}`} role="status">{unavailable ? "Unavailable" : initialLoading ? "Loading…" : enabled ? "Live" : "Paused"}</span></section>
    <div className="ltm-note"><span>Latest 10 checked automatically · new texts checked live</span><span>Future service dates sync before verification</span></div>
    {unavailable && <div className={`ltm-feed-error ${entries.length ? "" : "ltm-feed-error-empty"}`} role="alert"><h2>{entries.length ? "Updates unavailable · showing cached texts" : "Text messages could not be loaded"}</h2><p>{feedFailureReason(failure)}</p><button type="button" className="ltm-check ltm-retry" disabled={!enabled} onClick={requestRefresh}>Retry</button></div>}
    {entries.length ? <div className="ltm-table" role="table" aria-label="Stored text messages"><div className="ltm-columns" role="row"><div role="columnheader">Name / phone</div><div role="columnheader">Text conversation</div><div role="columnheader">Action required</div><div role="columnheader">Action verified</div></div>{entries.map(entry => <LiveTextMessageRow key={entry.row.key} entry={entry} entries={entries} enabled={enabled} onCheck={manualCheck} />)}</div> : !unavailable && <div className="ltm-empty" role="status"><MessageSquareText size={25} aria-hidden="true" /><p>{initialLoading ? "Loading stored text messages…" : "No stored text messages found"}</p></div>}
    <p className="ltm-footnote">Latest {VISIBLE_LIMIT} stored texts · last 20 entries per recent conversation{partial ? " · some context unavailable" : ""}</p>
  </div></main>;
}

export default function LiveTextMonitor() {
  const me = trpc.agents.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false, gcTime: 0 });
  // No feed, checks, fallback timer, or SSE hook mounts until admin access is confirmed.
  if (me.isLoading) return <main className="live-text-monitor-page"><div className="ltm-access" role="status"><ShieldCheck size={25} aria-hidden="true" /><h1>Checking admin access…</h1></div></main>;
  if (me.error) return <main className="live-text-monitor-page"><div className="ltm-access" role="alert"><LockKeyhole size={25} aria-hidden="true" /><h1>Could not verify admin access</h1><p>Sign in as an admin and reload.</p></div></main>;
  if (me.data?.isAdmin !== true) return <main className="live-text-monitor-page"><div className="ltm-access"><LockKeyhole size={25} aria-hidden="true" /><h1>Admin access required</h1><p>Sign in with an admin agent account.</p></div></main>;
  return <LiveTextWorkspace />;
}

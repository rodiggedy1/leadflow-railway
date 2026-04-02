import { useState } from "react";
import { X, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

// ─── Types ───────────────────────────────────────────────────────────────────

type Priority = "High" | "Normal" | "Low";
type FollowUpType = "Lead callback" | "Customer issue" | "Reschedule" | "Voicemail";
type FollowUpStatus = "Due soon" | "High priority" | "Needs decision" | "Queued";

interface HistoryEntry {
  text: string;
  time: string;
}

interface FollowUp {
  id: number;
  name: string;
  nextStep: string;
  dueAt: number;
  owner: string;
  type: FollowUpType;
  priority: Priority;
  internalNote: string | null;
  customerFacingMove: string | null;
  history: HistoryEntry[];
  completedAt: number | null;
  reminderSentAt: number | null;
}

function deriveStatus(item: FollowUp): FollowUpStatus {
  if (item.priority === "High") return "High priority";
  const now = Date.now();
  const diff = item.dueAt - now;
  if (diff < 0) return "Due soon";
  if (diff < 2 * 60 * 60 * 1000) return "Due soon";
  if (item.type === "Reschedule") return "Needs decision";
  return "Queued";
}

function formatDue(dueAt: number): { date: string; time: string } {
  const d = new Date(dueAt);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const date = isToday
    ? "Today"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return { date, time };
}

// ─── (mock data removed — using real DB) ────────────────────────────────────
const _UNUSED_PLACEHOLDER = [
  {
    id: "1",
    name: "Jessica R.",
    nextStep: "Call back lead",
    dueDate: "Today",
    dueTime: "1:30 PM",
    owner: "Madison",
    type: "Lead callback",
    priority: "Normal",
    status: "Due soon",
    internalNote: "Called twice, no answer. Yelp lead from yesterday.",
    customerFacingMove: "Call back and offer same-day slot if available.",
    history: [
      { text: "Lead submitted via Yelp", time: "9:15 AM" },
      { text: "First call attempt — no answer", time: "10:30 AM" },
      { text: "Second call attempt — voicemail", time: "11:45 AM" },
    ],
  },
  {
    id: "2",
    name: "Mr. Wilson",
    nextStep: "Offer partial refund",
    dueDate: "Today",
    dueTime: "2:00 PM",
    owner: "Ariana",
    type: "Customer issue",
    priority: "High",
    status: "High priority",
    internalNote: "Customer upset about streaky bathrooms and missed trash can. Wants a resolution today.",
    customerFacingMove: "Apologize live, offer same-day touch-up if possible, otherwise partial refund.",
    history: [
      { text: "Complaint submitted at 11:08 AM", time: "11:08 AM" },
      { text: "Photos reviewed by ops", time: "11:20 AM" },
      { text: "Cleaner team already left area", time: "11:35 AM" },
    ],
  },
  {
    id: "3",
    name: "Apt 4B move-out",
    nextStep: "Reschedule service",
    dueDate: "Today",
    dueTime: "3:15 PM",
    owner: "Kevin",
    type: "Reschedule",
    priority: "Normal",
    status: "Needs decision",
    internalNote: "Client moving out Friday, needs reschedule to Thursday AM.",
    customerFacingMove: "Confirm Thursday 9 AM slot and update booking.",
    history: [
      { text: "Reschedule request received via SMS", time: "8:00 AM" },
      { text: "Thursday slot checked — available", time: "8:45 AM" },
    ],
  },
  {
    id: "4",
    name: "Sandra M.",
    nextStep: "Retry after voicemail",
    dueDate: "Today",
    dueTime: "4:00 PM",
    owner: "Madison",
    type: "Voicemail",
    priority: "Low",
    status: "Queued",
    internalNote: "Quote follow-up. Left voicemail at 10 AM.",
    customerFacingMove: "Call back, re-pitch the quote, offer a first-clean discount.",
    history: [
      { text: "Quote sent via SMS", time: "9:00 AM" },
      { text: "Voicemail left", time: "10:00 AM" },
    ],
  },
];

const FOLLOW_UP_TYPES: { type: FollowUpType; sub: string }[] = [
  { type: "Lead callback", sub: "Call back at a set time" },
  { type: "Customer issue", sub: "Refund, save, complaint" },
  { type: "Reschedule", sub: "Move job + notify" },
  { type: "Voicemail", sub: "No answer, queue next touch" },
];

const NEXT_STEP_OPTIONS = [
  "Call in 30 min",
  "Call at 2:00 PM",
  "Send text update",
  "Offer partial refund",
  "Escalate",
  "Wait for reply",
];

const OWNERS = ["Madison", "Ariana", "Kevin", "Jade", "Me"];

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: FollowUpStatus }) {
  const styles: Record<FollowUpStatus, string> = {
    "Due soon": "bg-white border border-slate-200 text-slate-600",
    "High priority": "bg-white border border-red-200 text-red-600",
    "Needs decision": "bg-white border border-amber-200 text-amber-700",
    "Queued": "bg-white border border-slate-200 text-slate-500",
  };
  return (
    <span className={cn("text-xs font-medium px-3 py-1 rounded-full", styles[status])}>
      {status}
    </span>
  );
}

// ─── Priority badge ───────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: Priority }) {
  const styles: Record<Priority, string> = {
    High: "bg-red-50 text-red-600 border border-red-200",
    Normal: "bg-slate-50 text-slate-600 border border-slate-200",
    Low: "bg-slate-50 text-slate-400 border border-slate-200",
  };
  return (
    <span className={cn("text-sm font-semibold px-3 py-1.5 rounded-lg", styles[priority])}>
      {priority}
    </span>
  );
}

// ─── Queue view ───────────────────────────────────────────────────────────────

function QueueView({
  items,
  onSelect,
  onNew,
  onClose,
}: {
  items: FollowUp[];
  onSelect: (item: FollowUp) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-slate-100">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
            Scheduled Follow-Ups
          </p>
          <h2 className="text-xl font-bold text-slate-900 leading-tight">Who owns what</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-3 py-1 rounded-full">
            {items.length} active
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {items.map((item) => {
          const { date: dDate, time: dTime } = formatDue(item.dueAt);
          const status = deriveStatus(item);
          return (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="w-full text-left bg-white border border-slate-200 rounded-2xl px-4 py-3.5 hover:border-slate-300 hover:shadow-sm transition"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="font-bold text-slate-900 text-sm leading-tight">{item.name}</span>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-slate-500 mb-2.5">{item.nextStep}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                {dDate} · {dTime}
              </span>
              <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                Owner: {item.owner}
              </span>
              <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
                {item.type}
              </span>
            </div>
          </button>
          );
        })}

        {/* Why this matters */}
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl px-4 py-4 mt-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
            Why this matters
          </p>
          <p className="text-sm text-slate-500 leading-relaxed">
            Every follow-up stays visible with an owner, due time, and reason, so ops can scan the
            whole list and instantly see what is scheduled, who is carrying it, and what is at risk
            of being missed.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 pb-4 pt-2 border-t border-slate-100">
        <button
          onClick={onNew}
          className="w-full bg-slate-900 text-white text-sm font-semibold rounded-xl py-2.5 hover:bg-slate-700 transition"
        >
          + New follow-up
        </button>
      </div>
    </div>
  );
}

// ─── New follow-up form ───────────────────────────────────────────────────────

function NewFollowUpView({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  const createMutation = trpc.followUps.create.useMutation({
    onSuccess: () => { utils.followUps.list.invalidate(); onSaved(); },
  });
  const [selectedType, setSelectedType] = useState<FollowUpType | null>(null);
  const [owner, setOwner] = useState("Madison");
  const [priority, setPriority] = useState<Priority>("Normal");
  const [nextStep, setNextStep] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState(
    new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  );
  const [dueTime, setDueTime] = useState("2:00 PM");
  const [note, setNote] = useState("");
  const [customerMove, setCustomerMove] = useState("");
  const [name, setName] = useState("");

  function handleSave() {
    if (!selectedType || !name.trim()) return;
    const combined = `${dueDate} ${dueTime}`;
    const parsed = new Date(combined);
    const dueAt = isNaN(parsed.getTime()) ? Date.now() + 2 * 60 * 60 * 1000 : parsed.getTime();
    createMutation.mutate({
      name: name.trim(),
      nextStep: nextStep ?? "Follow up",
      dueAt,
      owner,
      type: selectedType,
      priority,
      internalNote: note || undefined,
      customerFacingMove: customerMove || undefined,
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-slate-100">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
            Inline Popup
          </p>
          <h2 className="text-xl font-bold text-slate-900 leading-tight">New follow-up</h2>
        </div>
        <button
          onClick={onBack}
          className="text-xs font-semibold bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-50 transition"
        >
          Close
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Name */}
        <div>
          <label className="text-sm font-semibold text-slate-700 block mb-1.5">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer or job name"
            className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>

        {/* Type */}
        <div>
          <label className="text-sm font-semibold text-slate-700 block mb-2">Type</label>
          <div className="space-y-2">
            {FOLLOW_UP_TYPES.map(({ type, sub }) => {
              const selected = selectedType === type;
              return (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={cn(
                    "w-full text-left border rounded-xl px-4 py-3 flex items-center justify-between transition",
                    selected
                      ? "bg-red-50 border-red-200"
                      : "bg-white border-slate-200 hover:border-slate-300"
                  )}
                >
                  <div>
                    <p className={cn("text-sm font-bold", selected ? "text-red-700" : "text-slate-900")}>
                      {type}
                    </p>
                    <p className="text-xs text-slate-400">{sub}</p>
                  </div>
                  <span
                    className={cn(
                      "text-xs font-semibold px-3 py-1 rounded-full border",
                      selected
                        ? "bg-red-100 text-red-600 border-red-200"
                        : "bg-white text-slate-500 border-slate-200"
                    )}
                  >
                    {selected ? "Selected" : "Pick"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Owner + Priority */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">Owner</label>
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
            >
              {OWNERS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">Priority</label>
            <div className="flex gap-1.5">
              {(["High", "Normal", "Low"] as Priority[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    "flex-1 text-xs font-semibold rounded-xl py-2.5 border transition",
                    priority === p && p === "High"
                      ? "bg-red-50 border-red-200 text-red-600"
                      : priority === p
                      ? "bg-slate-100 border-slate-300 text-slate-700"
                      : "bg-white border-slate-200 text-slate-400 hover:border-slate-300"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Next step chips */}
        <div>
          <label className="text-sm font-semibold text-slate-700 block mb-2">Next step</label>
          <div className="flex flex-wrap gap-2">
            {NEXT_STEP_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => setNextStep(nextStep === opt ? null : opt)}
                className={cn(
                  "text-xs font-medium px-3 py-1.5 rounded-full border transition",
                  nextStep === opt
                    ? "bg-red-50 border-red-300 text-red-600"
                    : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Due date + time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">Due date</label>
            <input
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">Due time</label>
            <input
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
        </div>

        {/* Internal note */}
        <div>
          <label className="text-sm font-semibold text-slate-700 block mb-1.5">Internal note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="What's the context? What happened?"
            className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
          />
        </div>

        {/* Customer-facing move */}
        <div>
          <label className="text-sm font-semibold text-slate-700 block mb-1.5">Customer-facing move</label>
          <textarea
            value={customerMove}
            onChange={(e) => setCustomerMove(e.target.value)}
            rows={2}
            placeholder="What will you say or do with the customer?"
            className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-5 pt-3 border-t border-slate-100">
        <button
          onClick={handleSave}
          disabled={!selectedType || !name.trim()}
          className="w-full bg-slate-900 text-white text-sm font-semibold rounded-xl py-2.5 hover:bg-slate-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save follow-up
        </button>
      </div>
    </div>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function DetailView({
  item,
  onBack,
  onComplete,
  onClose,
}: {
  item: FollowUp;
  onBack: () => void;
  onComplete: () => void;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const completeMutation = trpc.followUps.complete.useMutation({
    onSuccess: () => { utils.followUps.list.invalidate(); onComplete(); },
  });
  const addNoteMutation = trpc.followUps.addNote.useMutation({
    onSuccess: () => utils.followUps.list.invalidate(),
  });
  const [noteInput, setNoteInput] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  function handleAddNote() {
    if (!noteInput.trim()) return;
    addNoteMutation.mutate({ id: item.id, text: noteInput.trim() });
    setNoteInput("");
    setAddingNote(false);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-slate-100">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
            Follow-up Detail
          </p>
          <h2 className="text-xl font-bold text-slate-900 leading-tight">{item.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <PriorityBadge priority={item.priority} />
          <button
            onClick={onBack}
            className="text-xs font-semibold bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-50 transition"
          >
            Back to queue
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Next action */}
        <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
            Next Action
          </p>
          <h3 className="text-lg font-bold text-slate-900 mb-3">{item.nextStep}</h3>
          {(() => { const { date: dd, time: dt } = formatDue(item.dueAt); const st = deriveStatus(item); return (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
              {dd} · {dt}
            </span>
            <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
              Owner: {item.owner}
            </span>
            <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
              {item.type}
            </span>
            <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
              {st}
            </span>
          </div>
          ); })()}
        </div>

        {/* Notes row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Internal Note
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">{item.internalNote || "—"}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Customer-Facing Move
            </p>
            <p className="text-sm text-slate-600 leading-relaxed">{item.customerFacingMove || "—"}</p>
          </div>
        </div>

        {/* Ownership sidebar-style cards */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white border border-slate-200 rounded-xl px-3 py-3">
            <p className="text-[10px] text-slate-400 mb-1">Owner</p>
            <p className="text-sm font-bold text-slate-900">{item.owner}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-3 py-3">
            <p className="text-[10px] text-slate-400 mb-1">Priority</p>
            <p className={cn("text-sm font-bold", item.priority === "High" ? "text-red-600" : "text-slate-900")}>
              {item.priority}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-3 py-3">
            <p className="text-[10px] text-slate-400 mb-1">Due</p>
            <p className="text-sm font-bold text-slate-900">{formatDue(item.dueAt).date} · {formatDue(item.dueAt).time}</p>
          </div>
        </div>

        {/* History */}
        <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                History
              </p>
              <p className="text-sm font-bold text-slate-900">What happened so far</p>
            </div>
            <button
              onClick={() => setAddingNote(true)}
              className="text-xs font-semibold bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-50 transition"
            >
              Add note
            </button>
          </div>
          <div className="space-y-2">
            {item.history.map((h, i) => (
              <div key={i} className="bg-slate-50 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3">
                <p className="text-sm text-slate-700">{h.text}</p>
                <span className="text-xs text-slate-400 shrink-0">{h.time}</span>
              </div>
            ))}
          </div>
          {addingNote && (
            <div className="mt-3 flex gap-2">
              <input
                autoFocus
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
                placeholder="Add a note..."
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <button
                onClick={handleAddNote}
                className="text-xs font-semibold bg-slate-900 text-white px-3 py-2 rounded-xl hover:bg-slate-700 transition"
              >
                Add
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Actions footer */}
      <div className="px-5 pb-5 pt-3 border-t border-slate-100 space-y-2">
        <button
          onClick={() => completeMutation.mutate({ id: item.id })}
          disabled={completeMutation.isPending}
          className="w-full bg-slate-900 text-white text-sm font-semibold rounded-xl py-2.5 hover:bg-slate-700 transition disabled:opacity-50"
        >
          {completeMutation.isPending ? "Marking…" : "Mark completed"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button className="text-sm font-medium bg-white border border-slate-200 text-slate-700 rounded-xl py-2 hover:bg-slate-50 transition">
            Reassign owner
          </button>
          <button className="text-sm font-medium bg-white border border-slate-200 text-slate-700 rounded-xl py-2 hover:bg-slate-50 transition">
            Change due time
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

type View = "queue" | "new" | "detail";

interface FollowUpsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function FollowUpsModal({ open, onClose }: FollowUpsModalProps) {
  const [view, setView] = useState<View>("queue");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: rawItems = [], isLoading } = trpc.followUps.list.useQuery(undefined, {
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });
  const items = rawItems as FollowUp[];
  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  if (!open) return null;

  function handleSelect(item: FollowUp) {
    setSelectedId(item.id);
    setView("detail");
  }

  function handleNew() {
    setView("new");
  }

  function handleBack() {
    setSelectedId(null);
    setView("queue");
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Panel — slides in from the right side of the chat */}
      <div className="fixed right-4 bottom-20 z-50 w-[420px] max-h-[calc(100vh-6rem)] bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        {view === "queue" && (
          <QueueView
            items={items}
            onSelect={handleSelect}
            onNew={handleNew}
            onClose={onClose}
          />
        )}
        {view === "new" && (
          <NewFollowUpView onBack={handleBack} onSaved={handleBack} />
        )}
        {view === "detail" && selectedItem && (
          <DetailView
            item={selectedItem}
            onBack={handleBack}
            onComplete={handleBack}
            onClose={onClose}
          />
        )}
      </div>
    </>
  );
}

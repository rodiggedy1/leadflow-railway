/**
 * FieldManagement — Workflow transparency + live job communication log.
 *
 * Tab 1 "Workflow": Every automated SMS/call step in the day-of sequence.
 * Tab 2 "Log":      Today's jobs list. Click any job to expand its full
 *                   communication timeline — every automated message, call,
 *                   and status event in chronological order.
 *
 * Performance notes:
 *   - getJobsForDay returns jobs WITH pre-embedded timelines (2 DB queries total).
 *   - No per-job getJobTimeline calls — zero N+1 round trips.
 *   - staleTime: 30s prevents unnecessary refetches on tab focus.
 *   - refetchIntervalInBackground: false — polling only runs when tab is visible.
 */
import { useState, useCallback, useMemo } from "react";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import DayBoard from "@/components/DayBoard";
import ControlTowerTab from "@/components/ControlTowerTab";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MessageSquare,
  Phone,
  PhoneCall,
  Timer,
  Zap,
  Camera,
  ClipboardList,
  ArrowDown,
  Info,
  Car,
  UserX,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  MapPin,
  User,
  Calendar,
  XCircle,
  Activity,
  Loader2,
  FlaskConical,
  Play,
  ChevronRight,
  Send,
} from "lucide-react";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW TAB TYPES & DATA
// ─────────────────────────────────────────────────────────────────────────────

type TriggerKind = "time" | "keyword" | "status" | "exception" | "no-show";
type ActionKind = "sms" | "sms-client" | "call" | "sms+call" | "cs-alert";

interface WorkflowStep {
  id: number;
  phase: string;
  label: string;
  triggerKind: TriggerKind;
  triggerDescription: string;
  actionKind: ActionKind;
  messages: {
    role: "outbound" | "auto-response" | "call" | "client-sms" | "cs-alert";
    content: string;
    note?: string;
  }[];
  notes?: string[];
  isException?: boolean;
  isClientFacing?: boolean;
}

const WORKFLOW: WorkflowStep[] = [
  {
    id: 1,
    phase: "Pre-Job",
    label: "Pre-Job Reminder — Cleaner",
    triggerKind: "time",
    triggerDescription: "2 hours before job start",
    actionKind: "sms",
    messages: [
      {
        role: "outbound",
        content:
          "Hey {{name}} — reminder for your cleaning at {{time}}.\n\nBefore you arrive:\n• Review notes\n• Bring full supplies\n• Be ready to check in + upload photos\n\nSet your status to \"On the Way\" in the app.\n{{magic_link}}",
        note: "{{name}}, {{time}}, and {{magic_link}} are filled in automatically. {{magic_link}} is a personal one-tap login link valid for 30 days.",
      },
    ],
    notes: ["Sent 2 hours before job start."],
  },
  {
    id: 2,
    phase: "Pre-Job",
    label: "Pre-Job Notification — Client",
    triggerKind: "time",
    triggerDescription: "2 hours before job start (floor: 7:30 AM ET)",
    actionKind: "sms-client",
    isClientFacing: true,
    messages: [
      {
        role: "client-sms",
        content:
          "Hey {{client_name}} — you're all set for your home cleaning today at {{time}} 😊\n\nYou can follow your cleaning here: {{tracking_link}}\n\nWe'll update this in real time if anything changes, including arrival timing.",
        note: "Sent to the CLIENT at T-2hrs. If T-2hrs falls before 7:30 AM ET, held until 7:30 AM ET. {{tracking_link}} is the live job tracker URL.",
      },
    ],
    notes: [
      "Never sends before 7:30 AM ET, even if the job starts at 8 AM or earlier.",
      "Tracking link is unique per job and shows live cleaner status.",
    ],
  },
  {
    id: 3,
    phase: "On the Way",
    label: "Client \"On the Way\" Notification",
    triggerKind: "status",
    triggerDescription: "Cleaner taps \"On the Way\" in app",
    actionKind: "sms-client",
    isClientFacing: true,
    messages: [
      {
        role: "client-sms",
        content:
          "Hi {{client_name}}! Your Maids in Black team is on the way and will arrive at {{address}} around {{eta}}. 🚗\n\nTrack their arrival in real time here: {{tracking_link}}\n\nThe best way to make sure everything is perfect is to take a quick look before they head out. A quick 1 minute walkthrough really helps.\nFeel free to point anything out — they're happy to fix it on the spot.\n\nIf you have any last-minute notes, reply here.",
        note: "Sent to the CLIENT. {{client_name}}, {{address}}, {{eta}}, and {{tracking_link}} are pulled from the job record.",
      },
    ],
    notes: [
      "Fires immediately when the cleaner's app status changes to On the Way.",
      "ETA is calculated from the cleaner's selected ETA option in the app.",
    ],
  },
  {
    id: 4,
    phase: "Running Late",
    label: "Running Late — Client Notification",
    triggerKind: "status",
    triggerDescription: "Cleaner taps \"Running Late\" in app",
    actionKind: "sms-client",
    isClientFacing: true,
    messages: [
      {
        role: "client-sms",
        content:
          "Hey {{client_name}} — quick heads up, the team is running about {{delay}} behind.\n\nYou can follow their updated arrival here: {{tracking_link}}\n\nReally appreciate your flexibility, and we do apologize for the delay. Look forward to seeing you soon. 🙏",
        note: "{{delay}} is the number of minutes late (e.g. \"30 minutes\"). {{tracking_link}} is the live tracker URL. Fires once per job.",
      },
    ],
    notes: [
      "Fires once per job — if the cleaner taps Running Late multiple times, only the first triggers the SMS.",
    ],
  },
  {
    id: 5,
    phase: "Arrival",
    label: "Arrival Check-In",
    triggerKind: "status",
    triggerDescription: "Cleaner selects \"ARRIVED\" in app",
    actionKind: "sms",
    messages: [
      {
        role: "auto-response",
        content:
          "You're checked in ✅\n\nBefore starting:\nTake photos of anything broken or pre-existing damage — this protects you from being blamed.\n{{magic_link}}",
        note: "Instant auto-reply the moment the status is received. {{magic_link}} is the cleaner's personal one-tap login link.",
      },
    ],
    notes: ["If the cleaner uses the app check-in instead of texting, the same auto-response fires."],
  },
  {
    id: 6,
    phase: "Mid-Job",
    label: "Mid-Job Nudge",
    triggerKind: "time",
    triggerDescription: "45–60 minutes after check-in / arrival",
    actionKind: "sms",
    messages: [
      {
        role: "outbound",
        content:
          "Quick check — everything going smoothly?\n\nRemember:\n• Kitchens + bathrooms = highest priority\n• Don't miss floors + surfaces\n\nLog in and double check your notes + checklist.\n{{magic_link}}\n\nReply if any issues.",
      },
    ],
    notes: [
      "Optional step — can be toggled off per cleaner or per job type.",
      "Timer starts from the arrival check-in timestamp, not the scheduled start time.",
    ],
  },
  {
    id: 7,
    phase: "Completion",
    label: "Completion Flow",
    triggerKind: "status",
    triggerDescription: "Cleaner marks job \"Completed\" in app",
    actionKind: "sms",
    messages: [
      {
        role: "outbound",
        content:
          "Before leaving:\n\n1. Upload photos + double check notes + checklist\n2. Confirm:\n   • All rooms completed\n   • Trash removed\n   • Lights off / doors locked\n   • Walk the client around and ask for a review\n\nReply DONE when finished.\n{{magic_link}}",
        note: "{{magic_link}} is the cleaner's personal one-tap login link — tapping it opens their portal directly with no password needed.",
      },
    ],
    notes: [
      "Mandatory — fires for every completed job, no exceptions.",
      "Photo upload is required before the job is marked fully closed in the system.",
    ],
  },
  {
    id: 8,
    phase: "Exception",
    label: "Exception Escalation — Cleaner Not Responding",
    triggerKind: "exception",
    triggerDescription:
      "30 minutes before job start AND no \"On the Way\" status OR no check-in received",
    actionKind: "sms+call",
    isException: true,
    messages: [
      {
        role: "outbound",
        content: "Hey — we haven't received your check-in. Is everything okay?\n{{magic_link}}",
        note: "Step 1: SMS to the cleaner fires first. {{magic_link}} is their personal one-tap login link.",
      },
      {
        role: "call",
        content: "Auto-call placed to cleaner if no reply within 10 minutes.",
        note: "Step 2: If no response to the SMS, an automated call to the cleaner is triggered.",
      },
    ],
    notes: [
      "Also triggers if job is marked complete but no photos have been uploaded within 30 minutes.",
      "Escalation goes: SMS → wait 10 min → auto-call → alert CS team if still no response.",
    ],
  },
  {
    id: 9,
    phase: "No-Show",
    label: "No-Show / Late Escalation",
    triggerKind: "no-show",
    triggerDescription:
      "10 minutes before job start AND no \"On the Way\" or \"ARRIVED\" status in app",
    actionKind: "cs-alert",
    isException: true,
    messages: [
      {
        role: "cs-alert",
        content:
          "🚨 NO-SHOW ALERT\n\nCleaner: {{cleaner_name}}\nJob: {{client_name}} at {{address}}\nScheduled: {{job_time}}\n\nNo \"On the Way\" or \"Arrived\" status received. Please call the cleaner immediately and notify the client.",
        note: "Sent to the CS team via SMS alert. CS must then call the cleaner and proactively contact the client.",
      },
    ],
    notes: [
      "This is a CS team alert — no automated message goes to the cleaner or client at this stage.",
      "CS team is responsible for calling the cleaner to confirm status and calling the client to set expectations.",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW TAB SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function TriggerBadge({ kind }: { kind: TriggerKind }) {
  const map: Record<TriggerKind, { label: string; className: string }> = {
    time:      { label: "Time-based",    className: "bg-blue-50 text-blue-700 border-blue-200" },
    keyword:   { label: "Keyword",       className: "bg-purple-50 text-purple-700 border-purple-200" },
    status:    { label: "Status Change", className: "bg-green-50 text-green-700 border-green-200" },
    exception: { label: "Exception",     className: "bg-red-50 text-red-700 border-red-200" },
    "no-show": { label: "No-Show",       className: "bg-rose-50 text-rose-700 border-rose-200" },
  };
  const { label, className } = map[kind];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2.5 py-0.5 ${className}`}>
      {kind === "time"      && <Clock className="w-3 h-3" />}
      {kind === "keyword"   && <MessageSquare className="w-3 h-3" />}
      {kind === "status"    && <Zap className="w-3 h-3" />}
      {kind === "exception" && <AlertTriangle className="w-3 h-3" />}
      {kind === "no-show"   && <UserX className="w-3 h-3" />}
      {label}
    </span>
  );
}

function ActionBadge({ kind }: { kind: ActionKind }) {
  const map: Record<ActionKind, { label: string; className: string }> = {
    "sms":       { label: "SMS → Cleaner", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    "sms-client":{ label: "SMS → Client",  className: "bg-sky-50 text-sky-700 border-sky-200" },
    "call":      { label: "Auto-Call",     className: "bg-orange-50 text-orange-700 border-orange-200" },
    "sms+call":  { label: "SMS + Call",    className: "bg-amber-50 text-amber-700 border-amber-200" },
    "cs-alert":  { label: "CS Alert",      className: "bg-rose-50 text-rose-700 border-rose-200" },
  };
  const { label, className } = map[kind];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2.5 py-0.5 ${className}`}>
      {kind === "sms"        && <MessageSquare className="w-3 h-3" />}
      {kind === "sms-client" && <MessageSquare className="w-3 h-3" />}
      {kind === "call"       && <Phone className="w-3 h-3" />}
      {kind === "sms+call"   && <PhoneCall className="w-3 h-3" />}
      {kind === "cs-alert"   && <AlertTriangle className="w-3 h-3" />}
      {label}
    </span>
  );
}

function MessageBubble({
  role,
  content,
  note,
}: {
  role: WorkflowStep["messages"][number]["role"];
  content: string;
  note?: string;
}) {
  const isClient    = role === "client-sms";
  const isCall      = role === "call";
  const isCsAlert   = role === "cs-alert";
  const isAutoReply = role === "auto-response";

  const bubbleClass = isClient
    ? "bg-sky-50 border-sky-200"
    : isCsAlert
    ? "bg-rose-50 border-rose-200"
    : isCall
    ? "bg-orange-50 border-orange-200"
    : isAutoReply
    ? "bg-violet-50 border-violet-200"
    : "bg-gray-50 border-gray-200";

  const labelClass = isClient
    ? "text-sky-600"
    : isCsAlert
    ? "text-rose-600"
    : isCall
    ? "text-orange-600"
    : isAutoReply
    ? "text-violet-600"
    : "text-gray-500";

  const roleLabel = isClient
    ? "SMS to Client"
    : isCsAlert
    ? "CS Team Alert"
    : isCall
    ? "Auto-Call"
    : isAutoReply
    ? "Auto-Reply"
    : "SMS to Cleaner";

  return (
    <div className={`rounded-lg border p-3 ${bubbleClass}`}>
      <div className={`text-xs font-semibold mb-1.5 ${labelClass}`}>{roleLabel}</div>
      <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
        {content}
      </pre>
      {note && (
        <p className="mt-2 text-xs text-gray-400 italic flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          {note}
        </p>
      )}
    </div>
  );
}

function StepCard({ step }: { step: WorkflowStep }) {
  const [open, setOpen] = useState(true); // default expanded

  const phaseColor: Record<string, string> = {
    "Pre-Job":   "bg-blue-100 text-blue-700",
    "On the Way":"bg-sky-100 text-sky-700",
    "Running Late":"bg-amber-100 text-amber-700",
    "Arrival":   "bg-emerald-100 text-emerald-700",
    "Mid-Job":   "bg-violet-100 text-violet-700",
    "Completion":"bg-teal-100 text-teal-700",
    "Exception": "bg-red-100 text-red-700",
    "No-Show":   "bg-rose-100 text-rose-700",
  };

  return (
    <Card className={`overflow-hidden ${step.isException ? "border-red-200" : step.isClientFacing ? "border-sky-200" : "border-gray-200"}`}>
      <CardHeader
        className="cursor-pointer select-none py-3 px-4"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center ${step.isException ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                {step.id}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${phaseColor[step.phase] ?? "bg-gray-100 text-gray-600"}`}>
                  {step.phase}
                </span>
                <TriggerBadge kind={step.triggerKind} />
                <ActionBadge kind={step.actionKind} />
              </div>
              <CardTitle className="text-sm font-semibold text-gray-900">{step.label}</CardTitle>
              <p className="text-xs text-gray-500 mt-0.5">{step.triggerDescription}</p>
            </div>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 mt-1" />}
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pt-0 px-4 pb-4 border-t border-gray-100">
          <div className="space-y-3 mt-3">
            {step.messages.map((msg, i) => (
              <MessageBubble key={i} role={msg.role} content={msg.content} note={msg.note} />
            ))}
          </div>
          {step.notes && step.notes.length > 0 && (
            <div className="mt-3 space-y-1">
              {step.notes.map((note, i) => (
                <p key={i} className="text-xs text-gray-400 flex items-start gap-1">
                  <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-gray-300" />
                  {note}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG TAB — TYPES
// ─────────────────────────────────────────────────────────────────────────────

type EventType = "sms_cleaner" | "sms_client" | "call" | "cs_alert" | "status_change";

interface TimelineEvent {
  id: string;
  logId?: number;  // numeric DB row ID — present for field_mgmt_log events, absent for synthetic status_change events
  type: EventType;
  status: "sent" | "failed" | "pending" | "status_change";  // display state
  timestamp: Date;
  label: string;
  detail?: string;
  recipient?: string;
  success: boolean;
  errorDetail?: string;
  step?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG TAB — TIMELINE EVENT ROW
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_STYLES: Record<EventType, {
  dot: string;
  line: string;
  icon: React.ReactNode;
  badge: string;
  label: string;
}> = {
  sms_cleaner:   { dot: "bg-emerald-500", line: "bg-emerald-200", icon: <MessageSquare className="w-3.5 h-3.5" />, badge: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "SMS → Cleaner" },
  sms_client:    { dot: "bg-sky-500",     line: "bg-sky-200",     icon: <MessageSquare className="w-3.5 h-3.5" />, badge: "bg-sky-50 text-sky-700 border-sky-200",             label: "SMS → Client" },
  call:          { dot: "bg-orange-500",  line: "bg-orange-200",  icon: <PhoneCall className="w-3.5 h-3.5" />,     badge: "bg-orange-50 text-orange-700 border-orange-200",   label: "Auto-Call" },
  cs_alert:      { dot: "bg-rose-500",    line: "bg-rose-200",    icon: <AlertTriangle className="w-3.5 h-3.5" />, badge: "bg-rose-50 text-rose-700 border-rose-200",         label: "CS Alert" },
  status_change: { dot: "bg-violet-500",  line: "bg-violet-200",  icon: <Activity className="w-3.5 h-3.5" />,      badge: "bg-violet-50 text-violet-700 border-violet-200",   label: "Status Change" },
};

function TimelineEventRow({ event, isLast, onRetrySuccess }: { event: TimelineEvent; isLast: boolean; onRetrySuccess?: () => void }) {
  const [expanded, setExpanded] = useState(true); // default expanded
  const [retrying, setRetrying] = useState(false);
  const s = EVENT_STYLES[event.type];
  const hasDetail = !!event.detail;
  const isPending = event.status === "pending";
  const isFailed = event.status === "failed";
  const isSent = event.status === "sent";

  const retryMutation = trpc.fieldMgmt.retryStep.useMutation({
    onSuccess: (data) => {
      setRetrying(false);
      if (data.success) {
        toast.success(`Retry sent`, { description: `${event.label} → ${data.recipientPhone}` });
        onRetrySuccess?.();
      } else {
        toast.error(`Retry failed`, { description: data.errorDetail ?? "Unknown error" });
      }
    },
    onError: (err) => {
      setRetrying(false);
      toast.error("Retry failed", { description: err.message });
    },
  });

  const canRetry = isFailed && event.logId !== undefined && !!event.detail;

  const timeLabel = isPending
    ? `Expected ${new Date(event.timestamp).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
      })} ET`
    : `${new Date(event.timestamp).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
      })} ET`;

  // Dot colour: green=sent, red=failed, grey=pending, violet=status_change
  const dotClass = isPending
    ? "bg-gray-300"
    : isFailed
    ? "bg-red-400"
    : isSent
    ? s.dot
    : "bg-violet-500"; // status_change

  // Badge style: muted for pending
  const badgeClass = isPending
    ? "bg-gray-50 text-gray-400 border-gray-200"
    : s.badge;

  return (
    <div className={`flex gap-3 ${isPending ? "opacity-50" : ""}`}>
      {/* Left: dot + line */}
      <div className="flex flex-col items-center">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 ${dotClass}`} />
        {!isLast && <div className={`w-0.5 flex-1 mt-1 ${isPending ? "bg-gray-100" : s.line} min-h-[20px]`} />}
      </div>

      {/* Right: content */}
      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2 py-0.5 ${badgeClass}`}>
              {s.icon}{s.label}
            </span>
            <span className={`text-sm font-medium ${isPending ? "text-gray-400" : "text-gray-800"}`}>{event.label}</span>
            {/* Status pill */}
            {isSent && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                <CheckCircle2 className="w-3 h-3" /> Sent
              </span>
            )}
            {isFailed && (
              <span className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                <XCircle className="w-3 h-3" /> Failed
              </span>
            )}
            {isPending && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                <Clock className="w-3 h-3" /> Pending
              </span>
            )}
            {canRetry && (
              <button
                onClick={() => {
                  if (!event.logId) return;
                  setRetrying(true);
                  retryMutation.mutate({ logId: event.logId });
                }}
                disabled={retrying}
                className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 hover:bg-amber-100 transition-colors disabled:opacity-50"
              >
                {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {retrying ? "Retrying…" : "Retry"}
              </button>
            )}
          </div>
          <span className={`text-xs shrink-0 ${isPending ? "text-gray-300" : "text-gray-400"}`}>{timeLabel}</span>
        </div>

        {/* Recipient */}
        {event.recipient && !isPending && (
          <p className="text-xs text-gray-400 mt-0.5">To: {event.recipient}</p>
        )}

        {/* Error detail */}
        {isFailed && event.errorDetail && (
          <p className="text-xs text-red-500 mt-1">{event.errorDetail}</p>
        )}

        {/* Expandable SMS content — only for sent/failed rows with a message */}
        {hasDetail && !isPending && (
          <div className="mt-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Hide message" : "View message"}
            </button>
            {expanded && (
              <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 leading-relaxed">
                  {event.detail}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG TAB — JOB STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  on_the_way:        { label: "On the Way",        className: "bg-blue-50 text-blue-700 border-blue-200" },
  arrived:           { label: "Arrived",            className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  running_late:      { label: "Running Late",       className: "bg-amber-50 text-amber-700 border-amber-200" },
  in_progress:       { label: "In Progress",        className: "bg-violet-50 text-violet-700 border-violet-200" },
  completed:         { label: "Completed",          className: "bg-green-50 text-green-700 border-green-200" },
  issue_at_property: { label: "Issue at Property",  className: "bg-red-50 text-red-700 border-red-200" },
};

function JobStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">Not started</span>;
  const s = STATUS_STYLES[status] ?? { label: status, className: "bg-gray-50 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center text-xs font-medium border rounded-full px-2.5 py-0.5 ${s.className}`}>
      {s.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG TAB — SKELETON CARD (perceived performance while loading)
// ─────────────────────────────────────────────────────────────────────────────

function JobCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Skeleton className="h-1.5 flex-1 rounded-full" />
            <Skeleton className="h-3 w-14" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG TAB — JOB CARD (expandable, timeline pre-loaded from parent query)
// ─────────────────────────────────────────────────────────────────────────────

type JobWithTimeline = {
  id: number;
  cleanerName: string;
  teamName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
  serviceType: string | null;
  jobStatus: string | null;
  bookingStatus: string | null;
  stepsFired: number;
  stepsSuccess: number;
  totalSteps: number;
  /** Pre-embedded timeline — no extra query needed */
  timeline: TimelineEvent[];
};

function JobCard({ job }: { job: JobWithTimeline }) {
  const [open, setOpen] = useState(true); // default expanded
  const [showTest, setShowTest] = useState(false);
  const utils = trpc.useUtils();

  const serviceTime = useMemo(() => {
    if (!job.serviceDateTime) return null;
    return new Date(job.serviceDateTime).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
    });
  }, [job.serviceDateTime]);

  const progressPct = job.totalSteps > 0 ? Math.round((job.stepsFired / job.totalSteps) * 100) : 0;

  // Coerce timestamps from superjson (may arrive as string or Date)
  const events: TimelineEvent[] = useMemo(
    () => job.timeline.map((e) => ({ ...e, timestamp: new Date(e.timestamp) })),
    [job.timeline]
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Job header — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-4 flex items-start gap-3"
      >
        {/* Status dot */}
        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
          job.jobStatus === "completed"         ? "bg-green-500" :
          job.jobStatus === "issue_at_property" ? "bg-red-500" :
          job.jobStatus === "running_late"      ? "bg-amber-500" :
          job.jobStatus                         ? "bg-blue-500" : "bg-gray-300"
        }`} />

        <div className="flex-1 min-w-0">
          {/* Row 1: cleaner + status */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 text-sm">{job.cleanerName}</span>
              {job.teamName && job.teamName !== job.cleanerName && (
                <span className="text-xs text-gray-400">({job.teamName})</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <JobStatusBadge status={job.jobStatus} />
              {(job.bookingStatus === "rescheduled" || job.bookingStatus === "cancelled") && (
                <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                  job.bookingStatus === "rescheduled"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-slate-100 text-slate-500 border-slate-300"
                }`}>
                  {job.bookingStatus === "rescheduled" ? "Rescheduled" : "Cancelled"}
                </span>
              )}
            </div>
          </div>

          {/* Row 2: client + address + time */}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {job.customerName && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <User className="w-3 h-3" />{job.customerName}
              </span>
            )}
            {job.jobAddress && (
              <span className="flex items-center gap-1 text-xs text-gray-500 truncate max-w-[220px]">
                <MapPin className="w-3 h-3 shrink-0" />{job.jobAddress}
              </span>
            )}
            {serviceTime && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Clock className="w-3 h-3" />{serviceTime} ET
              </span>
            )}
          </div>

          {/* Row 3: step progress bar */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  progressPct === 100 ? "bg-green-500" : progressPct > 0 ? "bg-blue-500" : "bg-gray-200"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 shrink-0">
              {job.stepsFired}/{job.totalSteps} steps
            </span>
            {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
          </div>
        </div>
      </button>

      {/* Expanded timeline — data is already available, no loading state needed */}
      {open && (
        <div className="border-t border-gray-100 px-4 pt-4 pb-4">
          {events.length === 0 ? (
            <div className="py-6 text-center">
              <Activity className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No activity yet for this job.</p>
              <p className="text-xs text-gray-300 mt-1">Events will appear here as the day progresses.</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Communication Timeline
                </span>
                <div className="flex items-center gap-2">
                  {events.filter(e => e.status === "sent").length > 0 && (
                    <span className="text-xs text-emerald-600 font-medium">
                      {events.filter(e => e.status === "sent").length} sent
                    </span>
                  )}
                  {events.filter(e => e.status === "failed").length > 0 && (
                    <span className="text-xs text-red-600 font-medium">
                      {events.filter(e => e.status === "failed").length} failed
                    </span>
                  )}
                  {events.filter(e => e.status === "pending").length > 0 && (
                    <span className="text-xs text-gray-400">
                      {events.filter(e => e.status === "pending").length} pending
                    </span>
                  )}
                </div>
              </div>
              <div>
                {events.map((event, idx) => (
                  <TimelineEventRow
                    key={event.id}
                    event={event}
                    isLast={idx === events.length - 1}
                    onRetrySuccess={() => utils.fieldMgmt.getJobsForDay.invalidate()}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Test tool toggle */}
          <div className="mt-3">
            <button
              onClick={() => setShowTest((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 transition-colors"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              {showTest ? "Hide test tools" : "Test this job"}
              <ChevronRight className={`w-3 h-3 transition-transform ${showTest ? "rotate-90" : ""}`} />
            </button>
            {showTest && (
              <TestPanel
                jobId={job.id}
                onDone={() => {
                  // Invalidate the day query so the timeline refreshes with the new log row
                  utils.fieldMgmt.getJobsForDay.invalidate();
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG TAB — TEST PANEL (admin fire-step + status simulation)
// ─────────────────────────────────────────────────────────────────────────────

const ALL_STEPS: { value: string; label: string; recipient: string }[] = [
  { value: "pre_job_reminder",    label: "Pre-Job Reminder",        recipient: "Cleaner" },
  { value: "client_pre_job",      label: "Pre-Job Notification",    recipient: "Client" },
  { value: "client_on_the_way",   label: "On the Way Notification", recipient: "Client" },
  { value: "client_running_late", label: "Running Late Alert",       recipient: "Client" },
  { value: "arrived_checkin",     label: "Arrival Check-In",        recipient: "Cleaner" },
  { value: "mid_job_nudge",       label: "Mid-Job Nudge",           recipient: "Cleaner" },
  { value: "completion_flow",     label: "Completion Checklist",    recipient: "Cleaner" },
  { value: "exception_sms",       label: "No Check-In Alert",       recipient: "Cleaner" },
  { value: "noshow_alert",        label: "No-Show CS Alert",        recipient: "CS" },
];

const STATUS_SIM_BUTTONS: { status: string; label: string; color: string }[] = [
  { status: "on_the_way",        label: "On the Way",    color: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" },
  { status: "arrived",           label: "Arrived",       color: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" },
  { status: "running_late",      label: "Running Late",  color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
  { status: "completed",         label: "Completed",     color: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100" },
  { status: "issue_at_property", label: "Issue",         color: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100" },
];

const TEST_PHONE_DISPLAY = "+1 (302) 981-6191";

function TestPanel({ jobId, onDone }: { jobId: number; onDone: () => void }) {
  const [selectedStep, setSelectedStep] = useState<string>(ALL_STEPS[0].value);

  const fireStep = trpc.fieldMgmt.fireStep.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`SMS sent to ${TEST_PHONE_DISPLAY}`, {
          description: `Step: ${ALL_STEPS.find((s) => s.value === data.step)?.label ?? data.step}`,
        });
      } else {
        toast.error(`Step failed`, { description: data.errorDetail ?? "Unknown error" });
      }
      onDone();
    },
    onError: (err) => {
      toast.error("Fire step failed", { description: err.message });
    },
  });

  const simulateStatus = trpc.fieldMgmt.simulateStatusChange.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Status set + SMS sent to ${TEST_PHONE_DISPLAY}`, {
          description: `Status: ${STATUS_SIM_BUTTONS.find((s) => s.status === data.status)?.label ?? data.status}`,
        });
      } else {
        toast.error(`Status simulation failed`, { description: data.errorDetail ?? "Unknown error" });
      }
      onDone();
    },
    onError: (err) => {
      toast.error("Simulate status failed", { description: err.message });
    },
  });

  const isBusy = fireStep.isPending || simulateStatus.isPending;

  return (
    <div className="mt-4 border-t border-dashed border-amber-200 pt-4">
      {/* Test mode header */}
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Test Mode</span>
        <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
          All SMS → {TEST_PHONE_DISPLAY}
        </span>
      </div>

      {/* Status simulation */}
      <div className="mb-3">
        <p className="text-xs text-gray-500 mb-2 font-medium">Simulate cleaner status tap:</p>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_SIM_BUTTONS.map((btn) => (
            <button
              key={btn.status}
              disabled={isBusy}
              onClick={() => simulateStatus.mutate({ cleanerJobId: jobId, status: btn.status as any })}
              className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2.5 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${btn.color}`}
            >
              {simulateStatus.isPending && simulateStatus.variables?.status === btn.status
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Play className="w-3 h-3" />
              }
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Fire individual step */}
      <div>
        <p className="text-xs text-gray-500 mb-2 font-medium">Fire a specific step:</p>
        <div className="flex items-center gap-2">
          <select
            value={selectedStep}
            onChange={(e) => setSelectedStep(e.target.value)}
            disabled={isBusy}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
          >
            {ALL_STEPS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} → {s.recipient}
              </option>
            ))}
          </select>
          <button
            disabled={isBusy}
            onClick={() => fireStep.mutate({ cleanerJobId: jobId, step: selectedStep as any })}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {fireStep.isPending
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Send className="w-3 h-3" />
            }
            {fireStep.isPending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG TAB — MAIN VIEW
// ─────────────────────────────────────────────────────────────────────────────

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function LogTab() {
  const [date, setDate] = useState(() => todayET());
  const [groupByCleaner, setGroupByCleaner] = useState(false);

  const { data: jobs, isLoading, error, refetch, isFetching } = trpc.fieldMgmt.getJobsForDay.useQuery(
    { date },
    {
      // Cache for 30s — prevents refetch on tab focus / component remount
      staleTime: 30_000,
      // Poll every 60s, but only when the browser tab is visible
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      retry: false,
      throwOnError: false,
    }
  );

  const handleDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDate(e.target.value);
  }, []);

  const grouped = useMemo(() => {
    if (!jobs || !groupByCleaner) return null;
    const map = new Map<string, typeof jobs>();
    for (const job of jobs) {
      const key = job.cleanerName || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    }
    return map;
  }, [jobs, groupByCleaner]);

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <input
            type="date"
            value={date}
            onChange={handleDateChange}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Settings: Group by Cleaner */}
          <button
            onClick={() => setGroupByCleaner((v) => !v)}
            title="Toggle group by cleaner"
            className={`flex items-center gap-1.5 text-xs border rounded-lg px-3 py-1.5 transition-colors ${
              groupByCleaner
                ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                : "bg-white text-gray-500 border-gray-200 hover:text-gray-700"
            }`}
          >
            <User className="w-3 h-3" />
            Group by Cleaner
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Skeleton loading — show 3 placeholder cards while fetching */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" />
          <JobCardSkeleton />
          <JobCardSkeleton />
          <JobCardSkeleton />
        </div>
      )}

      {error && !error.message?.includes("login required") && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-2">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          Failed to load jobs. {error.message}
        </div>
      )}

      {!isLoading && !error && jobs && jobs.length === 0 && (
        <div className="py-16 text-center">
          <Calendar className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No jobs found for {date}</p>
          <p className="text-xs text-gray-400 mt-1">Try a different date or check that jobs have been synced from Launch27.</p>
        </div>
      )}

      {!isLoading && !error && jobs && jobs.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            {jobs.length} job{jobs.length !== 1 ? "s" : ""} · refreshes every 60s when tab is active
          </p>
          {grouped ? (
            // Grouped by cleaner view
            Array.from(grouped.entries()).map(([cleanerName, cleanerJobs]) => (
              <div key={cleanerName}>
                <div className="flex items-center gap-2 mb-2 mt-4 first:mt-0">
                  <User className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{cleanerName}</span>
                  <span className="text-xs text-gray-400">({cleanerJobs.length} job{cleanerJobs.length !== 1 ? "s" : ""})</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                <div className="space-y-3">
                  {cleanerJobs.map((job) => (
                    <JobCard key={job.id} job={job as JobWithTimeline} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            // Flat view
            jobs.map((job) => (
              <JobCard key={job.id} job={job as JobWithTimeline} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

function BoardTab() {
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })
  );
  const utils = trpc.useUtils();

  const { data: jobs, isLoading, isFetching } = trpc.fieldMgmt.getJobsForDay.useQuery(
    { date },
    {
      staleTime: 30_000,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      retry: false,
      throwOnError: false,
    }
  );

  const confirmMutation = trpc.fieldMgmt.confirmAssignment.useMutation({
    onSuccess: () => {
      toast.success("Assignment confirmed — automation will now include this job.");
      utils.fieldMgmt.getJobsForDay.invalidate({ date });
    },
    onError: (err) => {
      toast.error(`Failed to confirm: ${err.message}`);
    },
  });

  const handleConfirmAssignment = useCallback((jobId: number) => {
    confirmMutation.mutate({ cleanerJobId: jobId });
  }, [confirmMutation]);

  return (
    <DayBoard
      jobs={jobs ?? []}
      isLoading={isLoading}
      date={date}
      onDateChange={setDate}
      isFetching={isFetching}
      onConfirmAssignment={handleConfirmAssignment}
    />
  );
}

function FieldManagementLoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = trpc.agents.login.useMutation({
    onSuccess: (data) => {
      if (!data.agent.isAdmin) {
        toast.error("Admin access required.");
        return;
      }
      toast.success(`Welcome back, ${data.agent.name}!`);
      onSuccess();
    },
    onError: (err) => toast.error(err.message || "Login failed"),
  });
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm w-full mx-4">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gray-900 flex items-center justify-center mx-auto mb-3">
            <ClipboardList className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Field Management</h1>
          <p className="text-sm text-gray-500 mt-1">Admin access required</p>
        </div>
        <div className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate({ email, password })}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <button
            onClick={() => loginMutation.mutate({ email, password })}
            disabled={loginMutation.isPending}
            className="w-full py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {loginMutation.isPending ? "Signing in…" : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FieldManagement() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  const [activeTab, setActiveTab] = useState<"workflow" | "log" | "board" | "tower">("board");

  return (
    <AdminPageGuard pageId="field-management">
    <div className="min-h-screen bg-gray-50">
      <AdminHeader activeTab="field-management" pagePermissions={pagePermissions} isAdmin={isAdmin} />

      <div className={`mx-auto px-4 sm:px-6 py-8 ${
        activeTab === "board" || activeTab === "tower" ? "max-w-7xl" : "max-w-3xl"
      }`}>
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Field Management</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Day-of workflow automation and live job communication log.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
          {(["board", "tower", "log", "workflow"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab === "board" ? "Day Board" : tab === "tower" ? "Control Tower" : tab === "log" ? "Job Log" : "Workflow"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "board" && <BoardTab />}
        {activeTab === "tower" && <ControlTowerTab />}

        {activeTab === "workflow" && (
          <>
            {/* Legend */}
            <div className="mb-6 flex flex-wrap gap-2 items-center">
              <span className="text-xs text-gray-500 font-medium">Triggers:</span>
              <TriggerBadge kind="time" />
              <TriggerBadge kind="status" />
              <TriggerBadge kind="exception" />
              <TriggerBadge kind="no-show" />
              <span className="text-xs text-gray-400 mx-1">|</span>
              <span className="text-xs text-gray-500 font-medium">Actions:</span>
              <ActionBadge kind="sms" />
              <ActionBadge kind="sms-client" />
              <ActionBadge kind="sms+call" />
              <ActionBadge kind="cs-alert" />
            </div>

            <div className="space-y-4">
              {[...WORKFLOW].sort((a, b) => a.id - b.id).map((step, idx) => (
                <div key={step.id}>
                  <StepCard step={step} />
                  {idx < WORKFLOW.length - 1 && (
                    <div className="flex justify-center my-1">
                      <ArrowDown className="w-4 h-4 text-gray-300" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800">
                <strong>Automation status:</strong> Kill switch is currently OFF. Flip <code>FIELD_MGMT_ENABLED = true</code> in <code>server/fieldMgmtEngine.ts</code> to go live.
              </div>
            </div>
          </>
        )}

        {activeTab === "log" && <LogTab />}
      </div>
    </div>
    </AdminPageGuard>
  );
}

/**
 * FieldManagement — Workflow transparency + live job communication log.
 *
 * Tab 1 "Workflow": Every automated SMS/call step in the day-of sequence.
 * Tab 2 "Log":      Today's jobs list. Click any job to expand its full
 *                   communication timeline — every automated message, call,
 *                   and status event in chronological order.
 */
import { useState, useCallback } from "react";
import AdminHeader from "@/components/AdminHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";

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
          "Hey {{name}} — reminder for your cleaning at {{time}}.\n\nBefore you arrive:\n• Review notes: {{platform login link}}\n  (Login: {{cleaner_login_email}})\n• Bring full supplies\n• Be ready to check in + upload photos\n\nSet your status to \"On the Way\" in the app.",
        note: "{{name}}, {{time}}, {{platform login link}}, and {{cleaner_login_email}} are filled in automatically from the job record.",
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
          "You're checked in ✅\n\nBefore starting:\nTake photos of anything broken or pre-existing damage — this protects you from being blamed.",
        note: "Instant auto-reply the moment the status is received.",
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
          "Quick check — everything going smoothly?\n\nRemember:\n• Kitchens + bathrooms = highest priority\n• Don't miss floors + surfaces\n\nLog in and double check your notes + checklist: {{login link}}\n(Login: {{cleaner_login_email}})\n\nReply if any issues.",
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
          "Before leaving:\n\n1. Upload photos + double check notes + checklist: {{login link}}\n   (Login: {{cleaner_login_email}})\n2. Confirm:\n   • All rooms completed\n   • Trash removed\n   • Lights off / doors locked\n   • Walk the client around and ask for a review\n\nReply DONE when finished.",
        note: "{{login link}} links directly to the photo upload screen for this job. {{cleaner_login_email}} is the cleaner's platform login.",
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
        content: "Hey — we haven't received your check-in. Is everything okay?",
        note: "Step 1: SMS to the cleaner fires first.",
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
      {kind === "keyword"   && <Zap className="w-3 h-3" />}
      {kind === "status"    && <CheckCircle2 className="w-3 h-3" />}
      {kind === "exception" && <AlertTriangle className="w-3 h-3" />}
      {kind === "no-show"   && <UserX className="w-3 h-3" />}
      {label}
    </span>
  );
}

function ActionBadge({ kind }: { kind: ActionKind }) {
  const map: Record<ActionKind, { label: string; icon: React.ReactNode; className: string }> = {
    sms:         { label: "SMS → Cleaner",   icon: <MessageSquare className="w-3 h-3" />, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    "sms-client":{ label: "SMS → Client",    icon: <MessageSquare className="w-3 h-3" />, className: "bg-sky-50 text-sky-700 border-sky-200" },
    call:        { label: "Auto-Call",        icon: <PhoneCall className="w-3 h-3" />,     className: "bg-orange-50 text-orange-700 border-orange-200" },
    "sms+call":  { label: "SMS + Auto-Call", icon: <Phone className="w-3 h-3" />,         className: "bg-red-50 text-red-700 border-red-200" },
    "cs-alert":  { label: "CS Team Alert",   icon: <AlertTriangle className="w-3 h-3" />, className: "bg-rose-50 text-rose-700 border-rose-200" },
  };
  const { label, icon, className } = map[kind];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2.5 py-0.5 ${className}`}>
      {icon}{label}
    </span>
  );
}

function PhaseIcon({ phase }: { phase: string }) {
  const icons: Record<string, React.ReactNode> = {
    "Pre-Job":      <Timer className="w-5 h-5" />,
    "On the Way":   <Car className="w-5 h-5" />,
    Arrival:        <CheckCircle2 className="w-5 h-5" />,
    "Mid-Job":      <MessageSquare className="w-5 h-5" />,
    Completion:     <ClipboardList className="w-5 h-5" />,
    Exception:      <AlertTriangle className="w-5 h-5" />,
    "No-Show":      <UserX className="w-5 h-5" />,
    "Running Late": <Clock className="w-5 h-5" />,
  };
  return <>{icons[phase] ?? <Zap className="w-5 h-5" />}</>;
}

type MessageRole = "outbound" | "auto-response" | "call" | "client-sms" | "cs-alert";

function MessageBubble({ role, content, note }: { role: MessageRole; content: string; note?: string }) {
  const styleMap: Record<MessageRole, { bg: string; border: string; icon: React.ReactNode; label: string; textColor: string }> = {
    "outbound":      { bg: "bg-gray-50",   border: "border-gray-200",   icon: <MessageSquare className="w-3.5 h-3.5 text-gray-500" />,   label: "Outbound SMS → Cleaner",       textColor: "text-gray-500" },
    "auto-response": { bg: "bg-gray-50",   border: "border-gray-200",   icon: <MessageSquare className="w-3.5 h-3.5 text-gray-500" />,   label: "Auto-Response SMS → Cleaner",  textColor: "text-gray-500" },
    "call":          { bg: "bg-orange-50", border: "border-orange-200", icon: <PhoneCall className="w-3.5 h-3.5 text-orange-600" />,     label: "Auto-Call → Cleaner",          textColor: "text-orange-600" },
    "client-sms":    { bg: "bg-sky-50",    border: "border-sky-200",    icon: <MessageSquare className="w-3.5 h-3.5 text-sky-600" />,    label: "Outbound SMS → Client",        textColor: "text-sky-600" },
    "cs-alert":      { bg: "bg-rose-50",   border: "border-rose-200",   icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />,   label: "SMS Alert → CS Team",          textColor: "text-rose-600" },
  };
  const s = styleMap[role];
  return (
    <div className={`rounded-xl p-4 text-sm ${s.bg} border ${s.border}`}>
      <div className="flex items-center gap-2 mb-2">
        {s.icon}
        <span className={`text-xs font-semibold uppercase tracking-wide ${s.textColor}`}>{s.label}</span>
      </div>
      <pre className="whitespace-pre-wrap font-sans text-gray-800 leading-relaxed">{content}</pre>
      {note && (
        <p className="mt-2 text-xs text-gray-500 flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 shrink-0 text-gray-400" />{note}
        </p>
      )}
    </div>
  );
}

function StepCard({ step }: { step: WorkflowStep }) {
  const isNoShow = step.triggerKind === "no-show";
  const cardClass = isNoShow ? "border-rose-200 bg-rose-50/30" : step.isException ? "border-red-200 bg-red-50/30" : step.isClientFacing ? "border-sky-200 bg-sky-50/20" : "";
  const iconBg   = isNoShow ? "bg-rose-100 text-rose-600" : step.isException ? "bg-red-100 text-red-600" : step.isClientFacing ? "bg-sky-100 text-sky-600" : "bg-gray-100 text-gray-600";
  return (
    <Card className={`relative ${cardClass}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
              <PhaseIcon phase={step.phase} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs font-normal text-gray-500">Step {step.id}</Badge>
                <span className="text-xs text-gray-400">•</span>
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">{step.phase}</span>
                {step.isClientFacing && (
                  <span className="text-xs font-medium text-sky-600 bg-sky-50 border border-sky-200 rounded-full px-2 py-0.5">Client-facing</span>
                )}
              </div>
              <CardTitle className="text-base mt-0.5">{step.label}</CardTitle>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <TriggerBadge kind={step.triggerKind} />
            <ActionBadge kind={step.actionKind} />
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2.5">
          <Zap className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Trigger: </span>
            <span className="text-sm text-gray-700">{step.triggerDescription}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {step.messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} note={msg.note} />
        ))}
        {step.notes && step.notes.length > 0 && (
          <div className="mt-1 space-y-1">
            {step.notes.map((note, i) => (
              <p key={i} className="text-xs text-gray-500 flex items-start gap-1.5">
                <Camera className="w-3 h-3 mt-0.5 shrink-0 text-gray-400" />{note}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG TAB — TYPES
// ─────────────────────────────────────────────────────────────────────────────

type EventType = "sms_cleaner" | "sms_client" | "call" | "cs_alert" | "status_change";

interface TimelineEvent {
  id: string;
  type: EventType;
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

function TimelineEventRow({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const s = EVENT_STYLES[event.type];
  const hasDetail = !!event.detail;

  const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
  });

  return (
    <div className="flex gap-3">
      {/* Left: dot + line */}
      <div className="flex flex-col items-center">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 ${event.success ? s.dot : "bg-red-400"}`} />
        {!isLast && <div className={`w-0.5 flex-1 mt-1 ${s.line} min-h-[20px]`} />}
      </div>

      {/* Right: content */}
      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2 py-0.5 ${s.badge}`}>
              {s.icon}{s.label}
            </span>
            <span className="text-sm font-medium text-gray-800">{event.label}</span>
            {!event.success && (
              <span className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                <XCircle className="w-3 h-3" /> Failed
              </span>
            )}
          </div>
          <span className="text-xs text-gray-400 shrink-0">{time} ET</span>
        </div>

        {/* Recipient */}
        {event.recipient && (
          <p className="text-xs text-gray-400 mt-0.5">To: {event.recipient}</p>
        )}

        {/* Error */}
        {!event.success && event.errorDetail && (
          <p className="text-xs text-red-500 mt-1">{event.errorDetail}</p>
        )}

        {/* Expandable SMS content */}
        {hasDetail && (
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
// LOG TAB — JOB CARD (expandable)
// ─────────────────────────────────────────────────────────────────────────────

type JobSummary = {
  id: number;
  cleanerName: string;
  teamName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
  serviceType: string | null;
  jobStatus: string | null;
  stepsFired: number;
  stepsSuccess: number;
  totalSteps: number;
};

function JobCard({ job }: { job: JobSummary }) {
  const [open, setOpen] = useState(false);

  const { data: timeline, isLoading: timelineLoading, refetch } = trpc.fieldMgmt.getJobTimeline.useQuery(
    { cleanerJobId: job.id },
    { enabled: open, refetchInterval: open ? 60_000 : false, retry: false, throwOnError: false }
  );

  const serviceTime = job.serviceDateTime
    ? new Date(job.serviceDateTime).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
      })
    : null;

  const progressPct = job.totalSteps > 0 ? Math.round((job.stepsFired / job.totalSteps) * 100) : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Job header — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-4 flex items-start gap-3"
      >
        {/* Status dot */}
        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
          job.jobStatus === "completed" ? "bg-green-500" :
          job.jobStatus === "issue_at_property" ? "bg-red-500" :
          job.jobStatus === "running_late" ? "bg-amber-500" :
          job.jobStatus ? "bg-blue-500" : "bg-gray-300"
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
            <JobStatusBadge status={job.jobStatus} />
          </div>

          {/* Row 2: client + address */}
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

      {/* Expanded timeline */}
      {open && (
        <div className="border-t border-gray-100 px-4 pt-4 pb-2">
          {timelineLoading ? (
            <div className="flex items-center gap-2 py-6 justify-center text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading timeline…</span>
            </div>
          ) : !timeline || timeline.events.length === 0 ? (
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
                <button
                  onClick={(e) => { e.stopPropagation(); refetch(); }}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
              <div>
                {timeline.events.map((event, idx) => (
                  <TimelineEventRow
                    key={event.id}
                    event={{ ...event, timestamp: new Date(event.timestamp) }}
                    isLast={idx === timeline.events.length - 1}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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

  const { data: jobs, isLoading, error, refetch, isFetching } = trpc.fieldMgmt.getJobsForDay.useQuery(
    { date },
    { refetchInterval: 60_000, retry: false, throwOnError: false }
  );

  const handleDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDate(e.target.value);
  }, []);

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
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* States */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading jobs…</span>
        </div>
      )}

      {error && !error.message?.includes('login required') && (
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
            {jobs.length} job{jobs.length !== 1 ? "s" : ""} · auto-refreshes every 60s
          </p>
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function FieldManagement() {
  const [activeTab, setActiveTab] = useState<"workflow" | "log">("workflow");

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader activeTab="field-management" />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Field Management</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Day-of workflow automation and live job communication log.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
          {(["workflow", "log"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab === "workflow" ? "Workflow" : "Job Log"}
            </button>
          ))}
        </div>

        {/* Tab content */}
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
  );
}

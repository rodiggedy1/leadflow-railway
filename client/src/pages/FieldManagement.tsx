/**
 * FieldManagement — Transparency view of the cleaner field workflow.
 * Shows every SMS and call trigger in the day-of sequence so the team
 * can review timing and message content before automation is wired up.
 */
import AdminHeader from "@/components/AdminHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Workflow definition ───────────────────────────────────────────────────────

const WORKFLOW: WorkflowStep[] = [
  {
    id: 1,
    phase: "Pre-Job",
    label: "Pre-Job Reminder",
    triggerKind: "time",
    triggerDescription: "2 hours before first job of the day",
    actionKind: "sms",
    messages: [
      {
        role: "outbound",
        content:
          "Hey {{name}} — reminder for your cleaning at {{time}}.\n\nBefore you arrive:\n• Review notes: {{platform login link}}\n  (Login: {{cleaner_login_email}})\n• Bring full supplies\n• Be ready to check in + upload photos\n\nSet your status to \"On the Way\" in the app.",
        note: "{{name}}, {{time}}, {{platform login link}}, and {{cleaner_login_email}} are filled in automatically from the job record.",
      },
    ],
    notes: [
      "Sent only for the cleaner's first job of the day.",
      "If the cleaner has multiple jobs, only one reminder fires — not one per job.",
    ],
  },
  {
    id: 2,
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
          "Hi {{client_name}}! Your Maids in Black team is on the way and will arrive at {{address}} around {{eta}}. 🚗\n\nThe best way to make sure everything is perfect is to take a quick look before they head out. A quick 1 minute walkthrough really helps.\nFeel free to point anything out — they're happy to fix it on the spot.\n\nIf you have any last-minute notes, reply here.",
        note: "Sent to the CLIENT (not the cleaner). {{client_name}}, {{address}}, and {{eta}} are pulled from the job record.",
      },
    ],
    notes: [
      "Fires immediately when the cleaner's app status changes to On the Way.",
      "ETA is calculated from the cleaner's current location to the job address.",
    ],
  },
  {
    id: 3,
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
    notes: [
      "If the cleaner uses the app check-in instead of texting, the same auto-response fires.",
    ],
  },
  {
    id: 4,
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
    id: 5,
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
    id: 6,
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
    id: 7,
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
      "If CS cannot reach the cleaner within 5 minutes, the backup cleaner protocol should be activated.",
    ],
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

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
    sms: {
      label: "SMS → Cleaner",
      icon: <MessageSquare className="w-3 h-3" />,
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    "sms-client": {
      label: "SMS → Client",
      icon: <MessageSquare className="w-3 h-3" />,
      className: "bg-sky-50 text-sky-700 border-sky-200",
    },
    call: {
      label: "Auto-Call",
      icon: <PhoneCall className="w-3 h-3" />,
      className: "bg-orange-50 text-orange-700 border-orange-200",
    },
    "sms+call": {
      label: "SMS + Auto-Call",
      icon: <Phone className="w-3 h-3" />,
      className: "bg-red-50 text-red-700 border-red-200",
    },
    "cs-alert": {
      label: "CS Team Alert",
      icon: <AlertTriangle className="w-3 h-3" />,
      className: "bg-rose-50 text-rose-700 border-rose-200",
    },
  };
  const { label, icon, className } = map[kind];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2.5 py-0.5 ${className}`}>
      {icon}
      {label}
    </span>
  );
}

function PhaseIcon({ phase }: { phase: string }) {
  const icons: Record<string, React.ReactNode> = {
    "Pre-Job":    <Timer className="w-5 h-5" />,
    "On the Way": <Car className="w-5 h-5" />,
    Arrival:      <CheckCircle2 className="w-5 h-5" />,
    "Mid-Job":    <MessageSquare className="w-5 h-5" />,
    Completion:   <ClipboardList className="w-5 h-5" />,
    Exception:    <AlertTriangle className="w-5 h-5" />,
    "No-Show":    <UserX className="w-5 h-5" />,
  };
  return <>{icons[phase] ?? <Zap className="w-5 h-5" />}</>;
}

type MessageRole = "outbound" | "auto-response" | "call" | "client-sms" | "cs-alert";

function MessageBubble({
  role,
  content,
  note,
}: {
  role: MessageRole;
  content: string;
  note?: string;
}) {
  const styleMap: Record<MessageRole, { bg: string; border: string; icon: React.ReactNode; label: string; textColor: string }> = {
    "outbound": {
      bg: "bg-gray-50", border: "border-gray-200",
      icon: <MessageSquare className="w-3.5 h-3.5 text-gray-500" />,
      label: "Outbound SMS → Cleaner", textColor: "text-gray-500",
    },
    "auto-response": {
      bg: "bg-gray-50", border: "border-gray-200",
      icon: <MessageSquare className="w-3.5 h-3.5 text-gray-500" />,
      label: "Auto-Response SMS → Cleaner", textColor: "text-gray-500",
    },
    "call": {
      bg: "bg-orange-50", border: "border-orange-200",
      icon: <PhoneCall className="w-3.5 h-3.5 text-orange-600" />,
      label: "Auto-Call → Cleaner", textColor: "text-orange-600",
    },
    "client-sms": {
      bg: "bg-sky-50", border: "border-sky-200",
      icon: <MessageSquare className="w-3.5 h-3.5 text-sky-600" />,
      label: "Outbound SMS → Client", textColor: "text-sky-600",
    },
    "cs-alert": {
      bg: "bg-rose-50", border: "border-rose-200",
      icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />,
      label: "SMS Alert → CS Team", textColor: "text-rose-600",
    },
  };

  const s = styleMap[role];
  return (
    <div className={`rounded-xl p-4 text-sm ${s.bg} border ${s.border}`}>
      <div className="flex items-center gap-2 mb-2">
        {s.icon}
        <span className={`text-xs font-semibold uppercase tracking-wide ${s.textColor}`}>
          {s.label}
        </span>
      </div>
      <pre className="whitespace-pre-wrap font-sans text-gray-800 leading-relaxed">{content}</pre>
      {note && (
        <p className="mt-2 text-xs text-gray-500 flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 shrink-0 text-gray-400" />
          {note}
        </p>
      )}
    </div>
  );
}

function StepCard({ step }: { step: WorkflowStep }) {
  const isNoShow = step.triggerKind === "no-show";
  const cardClass = isNoShow
    ? "border-rose-200 bg-rose-50/30"
    : step.isException
    ? "border-red-200 bg-red-50/30"
    : step.isClientFacing
    ? "border-sky-200 bg-sky-50/20"
    : "";

  const iconBg = isNoShow
    ? "bg-rose-100 text-rose-600"
    : step.isException
    ? "bg-red-100 text-red-600"
    : step.isClientFacing
    ? "bg-sky-100 text-sky-600"
    : "bg-gray-100 text-gray-600";

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
                <Badge variant="outline" className="text-xs font-normal text-gray-500">
                  Step {step.id}
                </Badge>
                <span className="text-xs text-gray-400">•</span>
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">{step.phase}</span>
                {step.isClientFacing && (
                  <span className="text-xs font-medium text-sky-600 bg-sky-50 border border-sky-200 rounded-full px-2 py-0.5">
                    Client-facing
                  </span>
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

        {/* Trigger description */}
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
                <Camera className="w-3 h-3 mt-0.5 shrink-0 text-gray-400" />
                {note}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FieldManagement() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader activeTab="field-management" />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Field Management</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Every automated message and call in the cleaner day-of workflow. Review each step, confirm the triggers and message content, then we'll wire up the automation.
          </p>
        </div>

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

        {/* Workflow steps */}
        <div className="space-y-4">
          {WORKFLOW.map((step, idx) => (
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

        {/* Footer note */}
        <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-800">
            <strong>Next step:</strong> Review each step above and let us know if any trigger timing, message wording, or escalation logic needs adjusting. Once confirmed, we'll build the actual automation behind each step.
          </div>
        </div>
      </div>
    </div>
  );
}

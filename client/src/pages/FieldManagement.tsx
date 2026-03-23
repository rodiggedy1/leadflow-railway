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
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type TriggerKind = "time" | "keyword" | "status" | "exception";
type ActionKind = "sms" | "call" | "sms+call";

interface WorkflowStep {
  id: number;
  phase: string;
  label: string;
  triggerKind: TriggerKind;
  triggerDescription: string;
  actionKind: ActionKind;
  messages: {
    role: "outbound" | "auto-response" | "call";
    content: string;
    note?: string;
  }[];
  notes?: string[];
  isException?: boolean;
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
          "Hey {{name}} — reminder for your cleaning at {{time}}.\n\nBefore you arrive:\n• Review notes: {{platform login link}}\n• Bring full supplies\n• Be ready to check in + upload photos\n\nSet your status to \"On the Way\" in the app.",
        note: "{{name}}, {{time}}, {{platform login link}} are filled in automatically from the job record.",
      },
    ],
    notes: [
      "Sent only for the cleaner's first job of the day.",
      "If the cleaner has multiple jobs, only one reminder fires — not one per job.",
    ],
  },
  {
    id: 2,
    phase: "Arrival",
    label: "Arrival Check-In",
    triggerKind: "keyword",
    triggerDescription: 'Cleaner texts "ARRIVED" (or app marks On-Site)',
    actionKind: "sms",
    messages: [
      {
        role: "auto-response",
        content:
          "You're checked in ✅\n\nBefore starting:\nTake photos of anything broken or pre-existing damage — this protects you from being blamed.",
        note: "Instant auto-reply the moment the keyword is received.",
      },
    ],
    notes: [
      "Keyword is case-insensitive: \"arrived\", \"ARRIVED\", \"Arrived\" all trigger.",
      "If the cleaner uses the app check-in instead of texting, the same auto-response fires.",
    ],
  },
  {
    id: 3,
    phase: "Mid-Job",
    label: "Mid-Job Nudge",
    triggerKind: "time",
    triggerDescription: "45–60 minutes after check-in / arrival",
    actionKind: "sms",
    messages: [
      {
        role: "outbound",
        content:
          "Quick check — everything going smoothly?\n\nRemember:\n• Kitchens + bathrooms = highest priority\n• Don't miss floors + surfaces\n\nReply if any issues.",
      },
    ],
    notes: [
      "Optional step — can be toggled off per cleaner or per job type.",
      "Timer starts from the arrival check-in timestamp, not the scheduled start time.",
    ],
  },
  {
    id: 4,
    phase: "Completion",
    label: "Completion Flow",
    triggerKind: "status",
    triggerDescription: 'Cleaner marks job "Completed" in app',
    actionKind: "sms",
    messages: [
      {
        role: "outbound",
        content:
          "Before leaving:\n\n1. Upload photos: {{login link}}\n2. Confirm:\n   • All rooms completed\n   • Trash removed\n   • Lights off / doors locked\n   • Walk the client around and ask for a review\n\nReply DONE when finished.",
        note: "{{login link}} links directly to the photo upload screen for this job.",
      },
    ],
    notes: [
      "Mandatory — fires for every completed job, no exceptions.",
      "Photo upload is required before the job is marked fully closed in the system.",
    ],
  },
  {
    id: 5,
    phase: "Exception",
    label: "Exception Escalation",
    triggerKind: "exception",
    triggerDescription:
      "30 minutes before job start AND no \"On the Way\" status OR no check-in received",
    actionKind: "sms+call",
    messages: [
      {
        role: "outbound",
        content:
          "Hey — we haven't received your check-in. Is everything okay? Reply YES if you're on your way.",
        note: "Step 1: SMS fires first.",
      },
      {
        role: "call",
        content: "Auto-call placed to cleaner if no reply within 10 minutes.",
        note: "Step 2: If no response to the SMS, an automated call is triggered.",
      },
    ],
    notes: [
      "Also triggers if job is marked complete but no photos have been uploaded within 30 minutes.",
      "Escalation goes: SMS → wait 10 min → auto-call → alert CS team if still no response.",
    ],
    isException: true,
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function TriggerBadge({ kind }: { kind: TriggerKind }) {
  const map: Record<TriggerKind, { label: string; className: string }> = {
    time: { label: "Time-based", className: "bg-blue-50 text-blue-700 border-blue-200" },
    keyword: { label: "Keyword", className: "bg-purple-50 text-purple-700 border-purple-200" },
    status: { label: "Status Change", className: "bg-green-50 text-green-700 border-green-200" },
    exception: { label: "Exception", className: "bg-red-50 text-red-700 border-red-200" },
  };
  const { label, className } = map[kind];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2.5 py-0.5 ${className}`}>
      {kind === "time" && <Clock className="w-3 h-3" />}
      {kind === "keyword" && <Zap className="w-3 h-3" />}
      {kind === "status" && <CheckCircle2 className="w-3 h-3" />}
      {kind === "exception" && <AlertTriangle className="w-3 h-3" />}
      {label}
    </span>
  );
}

function ActionBadge({ kind }: { kind: ActionKind }) {
  const map: Record<ActionKind, { label: string; icon: React.ReactNode; className: string }> = {
    sms: {
      label: "SMS",
      icon: <MessageSquare className="w-3 h-3" />,
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
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
    "Pre-Job": <Timer className="w-5 h-5" />,
    Arrival: <CheckCircle2 className="w-5 h-5" />,
    "Mid-Job": <MessageSquare className="w-5 h-5" />,
    Completion: <ClipboardList className="w-5 h-5" />,
    Exception: <AlertTriangle className="w-5 h-5" />,
  };
  return <>{icons[phase] ?? <Zap className="w-5 h-5" />}</>;
}

function MessageBubble({
  role,
  content,
  note,
}: {
  role: "outbound" | "auto-response" | "call";
  content: string;
  note?: string;
}) {
  const isCall = role === "call";
  return (
    <div className={`rounded-xl p-4 text-sm ${isCall ? "bg-orange-50 border border-orange-200" : "bg-gray-50 border border-gray-200"}`}>
      <div className="flex items-center gap-2 mb-2">
        {isCall ? (
          <PhoneCall className="w-3.5 h-3.5 text-orange-600" />
        ) : (
          <MessageSquare className="w-3.5 h-3.5 text-gray-500" />
        )}
        <span className={`text-xs font-semibold uppercase tracking-wide ${isCall ? "text-orange-600" : "text-gray-500"}`}>
          {role === "outbound" ? "Outbound SMS" : role === "auto-response" ? "Auto-Response SMS" : "Auto-Call"}
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
  return (
    <Card className={`relative ${step.isException ? "border-red-200 bg-red-50/30" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                step.isException
                  ? "bg-red-100 text-red-600"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              <PhaseIcon phase={step.phase} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs font-normal text-gray-500">
                  Step {step.id}
                </Badge>
                <span className="text-xs text-gray-400">•</span>
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">{step.phase}</span>
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
        {/* Messages */}
        {step.messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} note={msg.note} />
        ))}

        {/* Notes */}
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
            This page shows every automated message and call in the cleaner day-of workflow. Review each step, confirm the triggers and message content are correct, then we'll wire up the automation.
          </p>
        </div>

        {/* Legend */}
        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <span className="text-xs text-gray-500 font-medium">Trigger types:</span>
          <TriggerBadge kind="time" />
          <TriggerBadge kind="keyword" />
          <TriggerBadge kind="status" />
          <TriggerBadge kind="exception" />
          <span className="text-xs text-gray-400 mx-1">|</span>
          <span className="text-xs text-gray-500 font-medium">Actions:</span>
          <ActionBadge kind="sms" />
          <ActionBadge kind="sms+call" />
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

/**
 * ConversationDrawer — shared between AdminDashboard and AgentDashboard.
 * Contains all types, helpers, and the drawer component so both views are identical.
 */
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Pencil,
  PhoneIncoming,
  RotateCcw,
  Sparkles,
  StickyNote,
  User,
  XCircle,
  BarChart2,
} from "lucide-react";
import { toast } from "sonner";
import { calculateExtrasTotal } from "@shared/extras";
import MessageDateSeparator, { formatMsgDate, isDifferentDay } from "@/components/MessageDateSeparator";
import { triggerTestChime } from "@/hooks/useNewReplyNotifier";

// ── Types ─────────────────────────────────────────────────────────────────────
export type Stage =
  | "QUOTE_SENT"
  | "AVAILABILITY"
  | "SLOT_CHOICE"
  | "ADDRESS"
  | "CONFIRMATION"
  | "CALL_SCHEDULED"
  | "DONE"
  | "UNHANDLED"
  | "BOOKED"
  | "FOLLOW_UP_SCHEDULED"
  | "VOICEMAIL"
  | "WIDGET_SIZING"
  | "COLD"
  | "LOST";

export const STAGE_CONFIG: Record<
  Stage,
  { label: string; textColor: string; bgColor: string; borderColor: string; order: number }
> = {
  QUOTE_SENT: { label: "Quote Sent", textColor: "#1d4ed8", bgColor: "#dbeafe", borderColor: "#bfdbfe", order: 1 },
  AVAILABILITY: { label: "Availability", textColor: "#92400e", bgColor: "#fef3c7", borderColor: "#fde68a", order: 2 },
  SLOT_CHOICE: { label: "Slot Choice", textColor: "#9a3412", bgColor: "#ffedd5", borderColor: "#fed7aa", order: 3 },
  ADDRESS: { label: "Address", textColor: "#6b21a8", bgColor: "#f3e8ff", borderColor: "#e9d5ff", order: 4 },
  CONFIRMATION: { label: "Confirmation", textColor: "#134e4a", bgColor: "#ccfbf1", borderColor: "#99f6e4", order: 5 },
  CALL_SCHEDULED: { label: "Call Scheduled", textColor: "#1e3a5f", bgColor: "#e0e7ff", borderColor: "#c7d2fe", order: 6 },
  DONE: { label: "Done", textColor: "#14532d", bgColor: "#dcfce7", borderColor: "#bbf7d0", order: 7 },
  UNHANDLED: { label: "Needs Review", textColor: "#991b1b", bgColor: "#fee2e2", borderColor: "#fecaca", order: 8 },
  BOOKED: { label: "$ Booked", textColor: "#065f46", bgColor: "#d1fae5", borderColor: "#6ee7b7", order: 9 },
  FOLLOW_UP_SCHEDULED: { label: "🔔 Follow Up", textColor: "#7c3aed", bgColor: "#f5f3ff", borderColor: "#ddd6fe", order: 10 },
  VOICEMAIL: { label: "📞 Voicemail", textColor: "#0369a1", bgColor: "#e0f2fe", borderColor: "#bae6fd", order: 11 },
  WIDGET_SIZING: { label: "Sizing", textColor: "#0369a1", bgColor: "#e0f2fe", borderColor: "#bae6fd", order: 0 },
  COLD: { label: "❄️ Cold", textColor: "#334155", bgColor: "#f1f5f9", borderColor: "#cbd5e1", order: 12 },
  LOST: { label: "😞 Lost", textColor: "#6b7280", bgColor: "#f3f4f6", borderColor: "#d1d5db", order: 13 },
};

export const OUTCOME_STAGES: Stage[] = [
  "BOOKED",
  "FOLLOW_UP_SCHEDULED",
  "VOICEMAIL",
  "COLD",
  "LOST",
];

export type DrawerSession = {
  id: number;
  leadName: string | null;
  leadPhone: string;
  stage: string;
  messageHistory: string;
  selectedSlot: string | null;
  address: string | null;
  quotedPrice: string | null;
  serviceType: string | null;
  extras: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  assignedAgentId: number | null;
  assignedAgentName: string | null;
  bookedAmount: number | null;
  isBooked: number;
  aiMode: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  gclid: string | null;
  leadSource: string | null;
  reactivationLastPrice: number | null;
  reactivationDiscountPct: number | null;
  followUpDate: string | null;
  followUpMessage: string | null;
  followUpSent: number;
  language: string | null;
  barkQA: string | null;
  jobFrequency: string | null;
  lastJobDate: string | null;
  lastJobPrice: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
export function toLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getLanguageBadge(language: string | null): React.ReactElement | null {
  if (!language || language === "en") return null;
  const langMap: Record<string, { flag: string; label: string }> = {
    es: { flag: "🇪🇸", label: "Spanish" },
    fr: { flag: "🇫🇷", label: "French" },
    pt: { flag: "🇧🇷", label: "Portuguese" },
    zh: { flag: "🇨🇳", label: "Chinese" },
    ar: { flag: "🇸🇦", label: "Arabic" },
    hi: { flag: "🇮🇳", label: "Hindi" },
    ko: { flag: "🇰🇷", label: "Korean" },
    ja: { flag: "🇯🇵", label: "Japanese" },
    de: { flag: "🇩🇪", label: "German" },
    it: { flag: "🇮🇹", label: "Italian" },
    ru: { flag: "🇷🇺", label: "Russian" },
    vi: { flag: "🇻🇳", label: "Vietnamese" },
    tl: { flag: "🇵🇭", label: "Tagalog" },
    am: { flag: "🇪🇹", label: "Amharic" },
  };
  const info = langMap[language] ?? { flag: "🌐", label: language.toUpperCase() };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
      {info.flag} {info.label}
    </span>
  );
}

export function getSourceBadge(leadSource: string | null): React.ReactElement {
  if (!leadSource || leadSource === "form") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-600">Quote Form</span>;
  }
  if (leadSource === "widget") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700">Widget</span>;
  }
  if (leadSource === "email") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-700">Google Ads Form</span>;
  }
  if (leadSource === "voice") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-violet-100 text-violet-700">Google Ads Call</span>;
  }
  if (leadSource === "reactivation") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-700">Campaign</span>;
  }
  if (leadSource === "bark") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">Bark</span>;
  }
  if (leadSource.startsWith("campaign:")) {
    const campaignId = leadSource.replace("campaign:", "");
    const label = campaignId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-700">📣 Campaign: {label}</span>;
  }
  if (leadSource === "command-center") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-700">📣 Campaign</span>;
  }
  if (leadSource.startsWith("always-on:")) {
    const groupType = leadSource.replace("always-on:", "");
    const label = formatGroupType(groupType);
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-700">Always-On: {label}</span>;
  }
  if (leadSource.startsWith("always-on-test:")) {
    const groupType = leadSource.replace("always-on-test:", "");
    const label = formatGroupType(groupType);
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-yellow-100 text-yellow-700">Test: {label}</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-600">{leadSource}</span>;
}

export function timeAgo(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export function formatGroupType(groupType: string): string {
  const map: Record<string, string> = {
    bedroom_count: "Bedroom Count",
    bathroom_count: "Bathroom Count",
    zip_code: "Zip Code",
    service_type: "Service Type",
    lead_source: "Lead Source",
  };
  return map[groupType] ?? groupType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function computeTotalQuote(quotedPrice: string | null, extrasJson: string | null): string | null {
  if (!quotedPrice) return null;
  const base = parseInt(quotedPrice, 10);
  if (isNaN(base)) return quotedPrice;
  if (!extrasJson) return quotedPrice;
  let keys: string[] = [];
  try { keys = JSON.parse(extrasJson); } catch { return quotedPrice; }
  if (!keys.length) return quotedPrice;
  const total = base + calculateExtrasTotal(keys);
  return String(total);
}

export function StageBadge({ stage }: { stage: string }) {
  const cfg = STAGE_CONFIG[stage as Stage] ?? {
    label: stage,
    textColor: "#374151",
    bgColor: "#f3f4f6",
    borderColor: "#e5e7eb",
  };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-medium border whitespace-nowrap"
      style={{
        fontSize: "11px",
        backgroundColor: cfg.bgColor,
        borderColor: cfg.borderColor,
        color: cfg.textColor,
      }}
    >
      {cfg.label}
    </span>
  );
}

function AdminNotesSection({
  session,
  notes,
  setNotes,
  loadedNotes,
  notesSaved,
  updateNotes,
}: {
  session: DrawerSession;
  notes: string;
  setNotes: (v: string) => void;
  loadedNotes: string;
  notesSaved: boolean;
  updateNotes: ReturnType<typeof trpc.agents.updateNotes.useMutation>;
}) {
  const [open, setOpen] = useState(false);
  const currentNotes = notes !== "" ? notes : loadedNotes;
  return (
    <div className="border-t">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <span className="flex items-center gap-1.5">
          Internal Notes
          {currentNotes && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />}
        </span>
        <span className="text-gray-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <Textarea
            placeholder="e.g. Left voicemail, price objection, follow up Friday..."
            value={currentNotes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="resize-none text-sm"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-400">Visible to agents and admins only</span>
            <div className="flex items-center gap-2">
              {notesSaved && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => updateNotes.mutate({ sessionId: session.id, notes: currentNotes })}
                disabled={updateNotes.isPending}
              >
                {updateNotes.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Notes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ConversationDrawer ───────────────────────────────────────────────────
export default function ConversationDrawer({
  session,
  onClose,
  isAdmin,
  agentList,
  onSessionUpdate,
  onRefresh,
  currentAgentName,
  initialTab,
}: {
  session: DrawerSession;
  onClose: () => void;
  isAdmin: boolean;
  agentList: { id: number; name: string; isActive: number | boolean }[];
  onSessionUpdate: (updates: Partial<DrawerSession>) => void;
  onRefresh: () => void;
  currentAgentName?: string;
  initialTab?: "conversation" | "flow" | "performance";
}) {
  const utils = trpc.useUtils();
  let messages: { role: string; content: string }[] = [];
  try {
    messages = JSON.parse(session.messageHistory || "[]");
  } catch {
    messages = [];
  }

  const [pendingLostSession, setPendingLostSession] = useState<{ id: number; name: string | null } | null>(null);

  const adminUpdateStageMutation = trpc.leads.adminUpdateStage.useMutation({
    onSuccess: (_, vars) => {
      onSessionUpdate({ stage: vars.stage });
      utils.leads.list.invalidate();
      utils.leads.stats.invalidate();
      onRefresh();
      toast.success("Stage updated");
    },
    onError: (e) => toast.error(e.message),
  });
  const agentUpdateStageMutation = trpc.leads.agentUpdateStage.useMutation({
    onSuccess: (_, vars) => {
      onSessionUpdate({ stage: vars.stage as Stage });
      utils.leads.list.invalidate();
      utils.leads.stats.invalidate();
      onRefresh();
      toast.success("Stage updated");
    },
    onError: (e) => toast.error(e.message),
  });
  const updateStageMutation = isAdmin ? adminUpdateStageMutation : agentUpdateStageMutation;

  const markAsLostMutation = trpc.leads.markAsLost.useMutation({
    onSuccess: () => {
      onSessionUpdate({ stage: "LOST" as Stage });
      utils.leads.list.invalidate();
      utils.leads.stats.invalidate();
      onRefresh();
      toast.success("Lead marked as lost");
    },
    onError: (e) => toast.error(e.message),
  });

  function handleStageSelect(val: string) {
    if (val === session.stage) return;
    if (val === "LOST") {
      setPendingLostSession({ id: session.id, name: session.leadName ?? session.leadPhone ?? null });
      return;
    }
    if (isAdmin) {
      adminUpdateStageMutation.mutate({ sessionId: session.id, stage: val as Stage });
    } else {
      agentUpdateStageMutation.mutate({ sessionId: session.id, stage: val as ("BOOKED" | "FOLLOW_UP_SCHEDULED" | "VOICEMAIL" | "COLD" | "LOST") });
    }
  }

  const assignAgentMutation = trpc.leads.adminAssignAgent.useMutation({
    onSuccess: (_, vars) => {
      const agent = vars.agentId === null ? null : agentList.find(a => a.id === vars.agentId);
      onSessionUpdate({
        assignedAgentId: vars.agentId,
        assignedAgentName: agent?.name ?? null,
      });
      utils.leads.list.invalidate();
      onRefresh();
      toast.success(vars.agentId === null ? "Lead unassigned" : `Assigned to ${agent?.name}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Lead name editing
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(session.leadName ?? "");
  const updateLeadNameMutation = trpc.leads.updateLeadName.useMutation({
    onSuccess: (data) => {
      onSessionUpdate({ leadName: data.leadName });
      utils.leads.list.invalidate();
      setEditingName(false);
      toast.success("Name updated");
    },
    onError: (e) => toast.error(e.message),
  });

  // Phone editing
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState(session.leadPhone ?? "");
  const updateLeadPhoneMutation = trpc.leads.updateLeadPhone.useMutation({
    onSuccess: (data) => {
      onSessionUpdate({ leadPhone: data.leadPhone });
      utils.leads.list.invalidate();
      setEditingPhone(false);
      toast.success("Phone updated");
    },
    onError: (e) => toast.error(e.message),
  });

  // Reply
  const [replyText, setReplyText] = useState("");
  const [localMessages, setLocalMessages] = useState<{ role: string; content: string; ts?: number }[]>(
    withFallbackTs(messages, session.createdAt, session.updatedAt)
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevInboundCountRef = useRef<number | null>(null);

  function withFallbackTs(
    msgs: { role: string; content: string; ts?: number }[],
    createdAt: Date | string,
    updatedAt: Date | string
  ) {
    if (msgs.length === 0) return msgs;
    const start = new Date(createdAt).getTime();
    const end = new Date(updatedAt).getTime();
    const span = Math.max(end - start, 0);
    return msgs.map((m, i) => ({
      ...m,
      ts: m.ts ?? Math.round(start + (span * i) / Math.max(msgs.length - 1, 1)),
    }));
  }

  // Auto-refresh conversation every 5s
  const { data: freshSession } = trpc.leads.list.useQuery(undefined, {
    refetchInterval: 5000,
    select: (sessions) => sessions.find(s => s.id === session.id),
  });
  useEffect(() => {
    if (freshSession?.messageHistory) {
      try {
        const fresh: { role: string; content: string; ts?: number }[] = JSON.parse(freshSession.messageHistory);
        const inboundCount = fresh.filter(m => m.role === "user").length;
        if (prevInboundCountRef.current !== null && inboundCount > prevInboundCountRef.current) {
          void triggerTestChime();
        }
        prevInboundCountRef.current = inboundCount;
        setLocalMessages(withFallbackTs(fresh, session.createdAt, freshSession.updatedAt ?? session.updatedAt));
      } catch { /* ignore */ }
    }
  }, [freshSession?.messageHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages]);

  const sendMessageMutation = trpc.leads.sendMessage.useMutation({
    onSuccess: (_, vars) => {
      setLocalMessages(prev => [...prev, { role: "assistant", content: vars.message, ts: Date.now(), senderName: currentAgentName ?? "Agent" } as any]);
      setReplyText("");
    },
    onError: (err) => toast.error(err.message),
  });

  const setAiModeMutation = trpc.leads.setAiMode.useMutation({
    onSuccess: (_, vars) => {
      utils.leads.list.invalidate();
      onSessionUpdate({ aiMode: vars.aiMode });
      toast.success(vars.aiMode === 1 ? "AI auto-reply enabled" : "Manual mode — you're in control");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSend = () => {
    const text = replyText.trim();
    if (!text || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate({ sessionId: session.id, message: text });
  };

  // Typing presence
  const setTypingMutation = trpc.leads.setTyping.useMutation();
  const handleTypingChange = (isTyping: boolean) => {
    setTypingMutation.mutate({ sessionId: session.id, isTyping });
  };
  const { data: typingData } = trpc.leads.getTyping.useQuery(
    { sessionId: session.id },
    { refetchInterval: 2000 }
  );

  // Booked amount editing
  const [bookedAmountInput, setBookedAmountInput] = useState(
    session.bookedAmount !== null && session.bookedAmount !== undefined
      ? String(session.bookedAmount)
      : ""
  );
  const [bookedAmountSaved, setBookedAmountSaved] = useState(false);
  const setBookedAmountMutation = trpc.agents.setBookedAmount.useMutation({
    onSuccess: (_, vars) => {
      utils.leads.list.invalidate();
      setBookedAmountSaved(true);
      setTimeout(() => setBookedAmountSaved(false), 2000);
      toast.success(vars.bookedAmount === null ? "Booked amount cleared" : `Booked amount set to $${vars.bookedAmount}`);
    },
    onError: (err) => toast.error(err.message),
  });

  // Internal notes
  const { data: notesData } = trpc.agents.getNotes.useQuery({ sessionId: session.id });
  const [notes, setNotes] = useState(notesData?.notes ?? "");
  const [notesSaved, setNotesSaved] = useState(false);
  const updateNotes = trpc.agents.updateNotes.useMutation({
    onSuccess: () => { setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000); },
    onError: (err) => toast.error(err.message),
  });
  const loadedNotes = notesData?.notes ?? "";

  // Call recordings
  const { data: callRecordings } = trpc.leads.getCallRecordings.useQuery({ sessionId: session.id });
  const { data: voiceCalls = [] } = trpc.voice.getCallsBySession.useQuery({ sessionId: session.id });

  // AI closing recommendation
  const { data: closingRec, isLoading: isLoadingRec, refetch: refetchRec } = trpc.leads.getClosingRecommendation.useQuery(
    { sessionId: session.id },
    { staleTime: 5 * 60 * 1000, retry: 1 }
  );

  // Follow-up scheduling
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(session.followUpDate ?? "");
  const [followUpMessage, setFollowUpMessage] = useState(session.followUpMessage ?? "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const closingRecAny = closingRec as any;
  const setFollowUpMutation = trpc.leads.adminSetFollowUp.useMutation({
    onSuccess: (_, vars) => {
      onSessionUpdate({
        followUpDate: vars.followUpDate,
        followUpMessage: vars.followUpMessage,
        stage: vars.followUpDate ? "FOLLOW_UP_SCHEDULED" : session.stage,
      });
      utils.leads.list.invalidate();
      onRefresh();
      setShowFollowUpPicker(false);
      toast.success(vars.followUpDate ? "Follow-up scheduled" : "Follow-up cleared");
    },
    onError: (e) => toast.error(e.message),
  });

  // Tabs
  const [drawerTab, setDrawerTab] = useState<"conversation" | "flow" | "performance">(initialTab ?? "conversation");

  // Note input toggle
  const [showNoteInput, setShowNoteInput] = useState(false);

  const applySuggestion = (index: number) => {
    if (index === -1) {
      setReplyText(closingRec?.suggestedMessage ?? "");
    } else {
      const msg = closingRec?.alternativeMessages?.[index];
      setReplyText(msg ?? "");
    }
  };

  // AI score panel
  const [scorePanelSessionId, setScorePanelSessionId] = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scorePanel = { data: null as any, isLoading: false };

  const pipelineStages = ["Lead In", "Quoted", "In Progress", "Follow-Up", "Re-engage", "Booked"];
  const stageToIndex: Record<string, number> = {
    WIDGET_SIZING: 0, QUOTE_SENT: 1, AVAILABILITY: 2, SLOT_CHOICE: 2, ADDRESS: 2,
    CONFIRMATION: 2, CALL_SCHEDULED: 2, DONE: 2, UNHANDLED: 2,
    FOLLOW_UP_SCHEDULED: 3, VOICEMAIL: 3, COLD: 4, BOOKED: 5,
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* Drawer panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col bg-white shadow-2xl"
        style={{ width: "min(900px, 95vw)", borderLeft: "1px solid #F0D8D0" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ borderColor: "#F0D8D0" }}>
          <div className="flex items-center gap-3 min-w-0">
            {/* Lead name / phone */}
            <div className="min-w-0">
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    autoFocus
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && nameInput.trim()) updateLeadNameMutation.mutate({ sessionId: session.id, leadName: nameInput.trim() });
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    className="h-7 text-sm w-40"
                    placeholder="Enter name"
                  />
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { if (nameInput.trim()) updateLeadNameMutation.mutate({ sessionId: session.id, leadName: nameInput.trim() }); }} disabled={updateLeadNameMutation.isPending}>
                    {updateLeadNameMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-green-600" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingName(false)}><XCircle className="w-3.5 h-3.5 text-gray-400" /></Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-gray-900 text-base truncate max-w-[200px]">
                    {session.leadName ?? "Unknown"}
                  </span>
                  <button onClick={() => setEditingName(true)} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {/* Phone */}
              {editingPhone ? (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Input
                    autoFocus
                    value={phoneInput}
                    onChange={e => setPhoneInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") updateLeadPhoneMutation.mutate({ sessionId: session.id, leadPhone: phoneInput.trim() });
                      if (e.key === "Escape") setEditingPhone(false);
                    }}
                    className="h-6 text-xs w-36"
                    placeholder="Phone number"
                  />
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => updateLeadPhoneMutation.mutate({ sessionId: session.id, leadPhone: phoneInput.trim() })} disabled={updateLeadPhoneMutation.isPending}>
                    {updateLeadPhoneMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 text-green-600" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setEditingPhone(false)}><XCircle className="w-3 h-3 text-gray-400" /></Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-gray-500">{formatPhone(session.leadPhone)}</span>
                  <button onClick={() => setEditingPhone(true)} className="text-gray-400 hover:text-gray-600 transition-colors">
                    <Pencil className="w-3 h-3" />
                  </button>
                  <a
                    href={`tel:${session.leadPhone}`}
                    className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full text-white ml-1"
                    style={{ backgroundColor: "#E8603C" }}
                  >
                    <PhoneIncoming className="w-3 h-3" /> Call
                  </a>
                </div>
              )}
            </div>
            {/* Stage badge */}
            <StageBadge stage={session.stage} />
            {getLanguageBadge(session.language)}
          </div>
          {/* Close */}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-3 shrink-0">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex border-b shrink-0" style={{ borderColor: "#F0D8D0" }}>
          {(["conversation", "flow", "performance"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setDrawerTab(tab)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                drawerTab === tab
                  ? "border-[#E8603C] text-[#E8603C]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab === "flow" ? "Flow View" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 min-h-0">
          {/* ── CONVERSATION TAB ── */}
          {drawerTab === "conversation" && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* AI context phrase */}
              {closingRecAny?.contextPhrase && (
                <div className="px-4 pt-3 pb-0 shrink-0">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                    <Sparkles className="w-3 h-3" />
                    {closingRecAny.contextPhrase}
                  </span>
                </div>
              )}
              {/* Staff note */}
              {loadedNotes && (
                <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 shrink-0">
                  <span className="font-semibold">Staff note:</span> {loadedNotes}
                </div>
              )}
              {/* Messages */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-2">
                {localMessages.length === 0 && (
                  <div className="text-center text-gray-400 text-sm py-8">No messages yet</div>
                )}
                {(() => {
                  let lastRenderedTs: number | null = null;
                  return localMessages.map((msg, i) => {
                    const curTs = (msg as any).ts ?? null;
                    const showSeparator = curTs != null && (lastRenderedTs == null || isDifferentDay(lastRenderedTs, curTs));
                    if (showSeparator && curTs != null) lastRenderedTs = curTs;
                    const timeLabel = curTs != null
                      ? new Date(curTs).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                      : null;
                    const isAI = msg.role === "assistant";
                    const senderName = (msg as any).senderName;
                    return (
                      <div key={i}>
                        {showSeparator && curTs != null && <MessageDateSeparator label={formatMsgDate(curTs)} />}
                        <div className={`flex ${isAI ? "justify-end" : "justify-start"}`}>
                          <div className="max-w-[80%]">
                            {/* Label row */}
                            <div className={`flex items-center gap-1.5 mb-0.5 ${isAI ? "justify-end" : "justify-start"}`}>
                              {!isAI && <User className="w-3 h-3 text-gray-400" />}
                              {isAI && <Bot className="w-3 h-3 text-white opacity-80" style={{ display: "none" }} />}
                              {senderName && isAI && (
                                <span className="text-[10px] text-gray-400 font-medium">{senderName}</span>
                              )}
                              {timeLabel && <span className="text-xs text-gray-400">{timeLabel}</span>}
                            </div>
                            <div
                              className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                                isAI
                                  ? "text-white rounded-tr-sm"
                                  : "bg-gray-100 text-gray-800 rounded-tl-sm"
                              }`}
                              style={isAI ? { backgroundColor: "#E8603C" } : {}}
                            >
                              {msg.content}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
                {typingData?.typingAgentName && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-gray-500 italic">
                      {typingData.typingAgentName} is typing…
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* AI suggestions */}
              {closingRec && !isLoadingRec && (
                <div className="px-4 pb-2 shrink-0">
                  <div className="flex gap-1.5 flex-wrap">
                    {closingRec.alternativeMessages?.slice(0, 3).map((alt, i) => (
                      <button
                        key={i}
                        onClick={() => applySuggestion(i)}
                        className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-[#E8603C] hover:text-[#E8603C] transition-colors bg-white"
                      >
                        {alt.length > 40 ? alt.slice(0, 40) + "…" : alt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Compose box */}
              <div className="px-4 pb-4 pt-2 shrink-0 border-t" style={{ borderColor: "#F0D8D0" }}>
                {showNoteInput ? (
                  <div className="space-y-2">
                    <Textarea
                      autoFocus
                      placeholder="Internal note (not sent to lead)..."
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      rows={2}
                      className="resize-none text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-3 text-xs"
                        onClick={() => {
                          updateNotes.mutate({ sessionId: session.id, notes });
                          setShowNoteInput(false);
                        }}
                        disabled={updateNotes.isPending}
                      >
                        {updateNotes.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Note"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-3 text-xs text-gray-500" onClick={() => setShowNoteInput(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Type a message..."
                      value={replyText}
                      onChange={e => {
                        setReplyText(e.target.value);
                        handleTypingChange(e.target.value.length > 0);
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      onBlur={() => handleTypingChange(false)}
                      rows={3}
                      className="resize-none text-sm"
                    />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowNoteInput(true)}
                          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 transition-colors"
                        >
                          <StickyNote className="w-3.5 h-3.5" /> Add Note
                        </button>
                        <button
                          onClick={() => setAiModeMutation.mutate({ sessionId: session.id, aiMode: session.aiMode === 1 ? 0 : 1 })}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                            session.aiMode === 1
                              ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                              : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                          }`}
                        >
                          <Bot className="w-3 h-3" />
                          {session.aiMode === 1 ? "AI on" : "AI off"}
                        </button>
                        <button
                          onClick={() => { refetchRec(); }}
                          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-[#E8603C] transition-colors"
                          title="Refresh AI suggestion"
                        >
                          {isLoadingRec ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSend}
                        disabled={!replyText.trim() || sendMessageMutation.isPending}
                        className="h-8 px-4 text-xs text-white"
                        style={{ backgroundColor: "#E8603C" }}
                      >
                        {sendMessageMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Send →"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── FLOW VIEW TAB ── */}
          {drawerTab === "flow" && (
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4 bg-white">
              {/* Pipeline Stage */}
              {(() => {
                const currentIdx = stageToIndex[session.stage] ?? 0;
                return (
                  <div className="bg-gray-50 rounded-2xl p-4">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Pipeline Stage</div>
                    <div className="flex items-center gap-1">
                      {pipelineStages.map((stage, idx) => (
                        <div key={stage} className="flex items-center flex-1">
                          <div className={`flex-1 text-center py-2 px-1 rounded-lg text-xs font-medium ${
                            idx === currentIdx ? "bg-gray-900 text-white" :
                            idx < currentIdx ? "bg-orange-100 text-orange-700" :
                            "bg-white text-gray-400 border border-gray-200"
                          }`}>
                            {stage}
                          </div>
                          {idx < pipelineStages.length - 1 && (
                            <div className={`w-3 h-0.5 shrink-0 ${idx < currentIdx ? "bg-orange-300" : "bg-gray-200"}`} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Move Stage — visible to all agents */}
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-2">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Move Stage</div>
                <div className="flex items-center gap-2">
                  <Select
                    value={session.stage}
                    onValueChange={handleStageSelect}
                    disabled={updateStageMutation.isPending || markAsLostMutation.isPending}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OUTCOME_STAGES.map(s => (
                        <SelectItem key={s} value={s} className="text-xs">
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ backgroundColor: STAGE_CONFIG[s]?.bgColor, color: STAGE_CONFIG[s]?.textColor }}
                          >
                            {STAGE_CONFIG[s]?.label ?? s}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {updateStageMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                </div>
              </div>

              {/* AI Playbook */}
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">AI Playbook</div>
                <div className="space-y-2">
                  {[
                    { done: true, text: "Intro quote sent" },
                    { done: true, text: "Availability question sent" },
                    { done: session.stage !== "WIDGET_SIZING" && session.stage !== "QUOTE_SENT", text: "Slot confirmed or date captured" },
                    { done: !!session.followUpDate, text: "Follow-up scheduled" },
                    { done: session.stage === "BOOKED", text: "Booking confirmed" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-sm">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${item.done ? "bg-green-500" : "bg-gray-200"}`}>
                        {item.done && <CheckCircle2 className="w-3 h-3 text-white" />}
                      </div>
                      <span className={item.done ? "text-gray-700" : "text-gray-400"}>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lead details */}
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-2">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Lead Details</div>
                {session.quotedPrice && (() => {
                  const total = computeTotalQuote(session.quotedPrice, session.extras);
                  const hasExtras = total !== session.quotedPrice;
                  return (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Quote</span>
                      <span className="font-semibold" style={{ color: "#E8603C" }}>
                        ${total}
                        {hasExtras && <span className="text-xs text-gray-400 ml-1">(base ${session.quotedPrice})</span>}
                      </span>
                    </div>
                  );
                })()}
                {session.serviceType && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Service</span>
                    <span className="font-medium">{session.serviceType}</span>
                  </div>
                )}
                {(session.bedrooms || session.bathrooms) && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Size</span>
                    <span className="font-medium">
                      {[session.bedrooms && `${session.bedrooms} bed`, session.bathrooms && `${session.bathrooms} bath`].filter(Boolean).join(" / ")}
                    </span>
                  </div>
                )}
                {session.selectedSlot && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Slot</span>
                    <span className="font-medium text-xs">{session.selectedSlot}</span>
                  </div>
                )}
                {session.address && (
                  <div className="flex justify-between text-sm gap-2">
                    <span className="text-gray-500 shrink-0">Address</span>
                    <span className="font-medium text-xs text-right">{session.address}</span>
                  </div>
                )}
                {session.leadSource && (
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-gray-500">Source</span>
                    {getSourceBadge(session.leadSource)}
                  </div>
                )}
                {(session.jobFrequency || session.lastJobDate || session.lastJobPrice) && (
                  <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Previous Job</div>
                    {session.jobFrequency && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Frequency</span>
                        <span className="font-medium capitalize">{session.jobFrequency}</span>
                      </div>
                    )}
                    {session.lastJobDate && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Last Job</span>
                        <span className="font-medium">{new Date(session.lastJobDate).toLocaleDateString()}</span>
                      </div>
                    )}
                    {session.lastJobPrice && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Last Price</span>
                        <span className="font-medium">${session.lastJobPrice}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Booked Amount */}
              {session.isBooked === 1 && (
                <div className="bg-white rounded-2xl border border-green-200 p-4 shadow-sm space-y-2" style={{ backgroundColor: "#f0fdf4" }}>
                  <div className="text-xs font-semibold text-green-700 uppercase tracking-wide">Booked Amount</div>
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                      <Input
                        type="number"
                        min={0}
                        placeholder={computeTotalQuote(session.quotedPrice, session.extras) ?? "0"}
                        value={bookedAmountInput}
                        onChange={e => setBookedAmountInput(e.target.value)}
                        className="pl-5 h-8 text-xs bg-white"
                      />
                    </div>
                    {bookedAmountSaved && <span className="text-xs text-green-600 font-medium shrink-0">✓</span>}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 text-xs shrink-0 bg-white"
                      disabled={setBookedAmountMutation.isPending}
                      onClick={() => {
                        const val = bookedAmountInput.trim();
                        const parsed = val === "" ? null : parseInt(val, 10);
                        if (val !== "" && (isNaN(parsed!) || parsed! < 0)) {
                          toast.error("Enter a valid dollar amount");
                          return;
                        }
                        setBookedAmountMutation.mutate({ sessionId: session.id, bookedAmount: parsed });
                      }}
                    >
                      {setBookedAmountMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Follow-up scheduler */}
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Follow-Up</div>
                  <button
                    onClick={() => setShowFollowUpPicker(v => !v)}
                    className="text-xs text-[#E8603C] hover:underline font-medium"
                  >
                    {session.followUpDate ? "Edit" : "Schedule"}
                  </button>
                </div>
                {session.followUpDate ? (
                  <div className="text-sm">
                    <span className={`font-medium ${new Date(session.followUpDate) < new Date() ? "text-red-600" : "text-gray-800"}`}>
                      {new Date(session.followUpDate) < new Date() ? "⚠ Overdue: " : ""}
                      {new Date(session.followUpDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </span>
                    {session.followUpMessage && (
                      <p className="text-xs text-gray-500 mt-0.5 italic">"{session.followUpMessage}"</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No follow-up scheduled</p>
                )}
                {showFollowUpPicker && (
                  <div className="space-y-2 pt-2 border-t border-gray-100">
                    <Input
                      type="date"
                      value={followUpDate}
                      min={toLocalDateInput(new Date())}
                      onChange={e => setFollowUpDate(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Textarea
                      placeholder="Optional note (e.g. 'Call back Friday, price objection')"
                      value={followUpMessage}
                      onChange={e => setFollowUpMessage(e.target.value)}
                      rows={2}
                      className="resize-none text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 px-3 text-xs text-white"
                        style={{ backgroundColor: "#E8603C" }}
                        onClick={() => setFollowUpMutation.mutate({ sessionId: session.id, followUpDate: followUpDate || null, followUpMessage: followUpMessage || null })}
                        disabled={setFollowUpMutation.isPending}
                      >
                        {setFollowUpMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                      </Button>
                      {session.followUpDate && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-3 text-xs"
                          onClick={() => setFollowUpMutation.mutate({ sessionId: session.id, followUpDate: null, followUpMessage: null })}
                          disabled={setFollowUpMutation.isPending}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Agent assignment — admin only */}
              {isAdmin && agentList.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-2">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Assign Agent</div>
                  <Select
                    value={session.assignedAgentId ? String(session.assignedAgentId) : "unassigned"}
                    onValueChange={val => assignAgentMutation.mutate({ sessionId: session.id, agentId: val === "unassigned" ? null : parseInt(val) })}
                    disabled={assignAgentMutation.isPending}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned" className="text-xs">Unassigned</SelectItem>
                      {agentList.filter(a => a.isActive).map(a => (
                        <SelectItem key={a.id} value={String(a.id)} className="text-xs">{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Call recordings */}
              {callRecordings && callRecordings.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-3">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Call Recordings</div>
                  {callRecordings.map(rec => {
                    const recTs = rec.callStartedAt ? new Date(rec.callStartedAt).getTime() : null;
                    const timeLabel = recTs ? new Date(recTs).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : null;
                    const mins = rec.durationSeconds ? Math.floor(rec.durationSeconds / 60) : 0;
                    const secs = rec.durationSeconds ? rec.durationSeconds % 60 : 0;
                    const durLabel = rec.durationSeconds ? `${mins}m ${secs}s` : null;
                    const speakerLabel = (id: string) => {
                      if (id === "customer") return "Customer";
                      return currentAgentName ?? "Agent";
                    };
                    return (
                      <div key={rec.id} className="border border-gray-100 rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-700">
                              {timeLabel ?? "Call"}
                            </span>
                            {durLabel && <span className="font-normal text-gray-400 text-xs">· {durLabel}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {rec.callScore !== null && rec.callScore !== undefined && (
                              <button
                                onClick={() => setScorePanelSessionId(prev => prev === session.id ? null : session.id)}
                                className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
                                style={{
                                  backgroundColor: rec.callScore >= 80 ? "#dcfce7" : rec.callScore >= 60 ? "#fef3c7" : "#fee2e2",
                                  color: rec.callScore >= 80 ? "#14532d" : rec.callScore >= 60 ? "#92400e" : "#991b1b",
                                }}
                              >
                                <BarChart2 className="w-3 h-3" />
                                {rec.callScore}
                              </button>
                            )}
                          </div>
                        </div>
                        {rec.recordingUrl && (
                          <div className="px-3 py-2">
                            <audio controls src={rec.recordingUrl} className="w-full h-8" style={{ height: "32px" }} />
                          </div>
                        )}
                        {rec.transcript && (
                          <div className="px-3 pb-3 space-y-1 max-h-48 overflow-y-auto">
                            {(() => {
                              try {
                                const turns = JSON.parse(rec.transcript) as { identifier: string; content: string }[];
                                return turns.map((turn, ti) => (
                                  <div key={ti} className={`flex gap-2 text-xs ${turn.identifier === "customer" ? "justify-start" : "justify-end"}`}>
                                    <div className={`max-w-[85%] px-2.5 py-1.5 rounded-xl ${turn.identifier === "customer" ? "bg-gray-100 text-gray-700" : "text-white"}`} style={turn.identifier !== "customer" ? { backgroundColor: "#E8603C" } : {}}>
                                      <div className="font-semibold mb-0.5 text-[10px] opacity-70">{speakerLabel(turn.identifier)}</div>
                                      {turn.content}
                                    </div>
                                  </div>
                                ));
                              } catch {
                                return <p className="text-xs text-gray-500 italic">{rec.transcript}</p>;
                              }
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Voice calls */}
              {voiceCalls.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-2">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">AI Voice Calls</div>
                  {voiceCalls.map((call: any) => (
                    <div key={call.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg px-3 py-2">
                      <span className="text-gray-600">{call.status}</span>
                      <span className="text-gray-400">{call.createdAt ? timeAgo(call.createdAt) : ""}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Internal Notes */}
              <AdminNotesSection
                session={session}
                notes={notes}
                setNotes={setNotes}
                loadedNotes={loadedNotes}
                notesSaved={notesSaved}
                updateNotes={updateNotes}
              />
            </div>
          )}

          {/* ── PERFORMANCE TAB ── */}
          {drawerTab === "performance" && (
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Conversation Stats</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-gray-800">{localMessages.filter(m => m.role === "user").length}</div>
                    <div className="text-xs text-gray-500 mt-0.5">Inbound msgs</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-gray-800">{localMessages.filter(m => m.role === "assistant").length}</div>
                    <div className="text-xs text-gray-500 mt-0.5">Outbound msgs</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-gray-800">{timeAgo(session.createdAt)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">Lead age</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold" style={{ color: session.stage === "BOOKED" ? "#16a34a" : "#E8603C" }}>
                      {STAGE_CONFIG[session.stage as Stage]?.label ?? session.stage}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">Current stage</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Score Panel */}
      {scorePanelSessionId !== null && (
        <Dialog open onOpenChange={() => setScorePanelSessionId(null)}>
          <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-base font-bold">AI Call Score</DialogTitle>
            </DialogHeader>
            {scorePanel.isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            )}
            {scorePanel.data && (
              <div className="space-y-4">
                <div className="flex items-center justify-center">
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white"
                    style={{ backgroundColor: scorePanel.data.score >= 80 ? "#16a34a" : scorePanel.data.score >= 60 ? "#d97706" : "#dc2626" }}
                  >
                    {scorePanel.data.score}
                  </div>
                </div>
                <div className="space-y-2">
                  {scorePanel.data.categories?.map((cat: any, i: number) => {
                    const scoreColor = cat.score >= 80 ? "#16a34a" : cat.score >= 60 ? "#d97706" : "#dc2626";
                    return (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100">
                        <span className="text-sm text-gray-700">{cat.name}</span>
                        <span className="text-sm font-bold" style={{ color: scoreColor }}>{cat.score}</span>
                      </div>
                    );
                  })}
                </div>
                {scorePanel.data.strengths?.length > 0 && (
                  <div className="py-3 border-b border-gray-100">
                    <div className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">✓ Strengths</div>
                    <ul className="space-y-1">
                      {scorePanel.data.strengths.map((s: string, si: number) => (
                        <li key={si} className="flex gap-2 text-sm text-gray-600">
                          <span className="text-green-500 shrink-0">•</span>{s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {scorePanel.data.improvements?.length > 0 && (
                  <div className="py-3 border-b border-gray-100">
                    <div className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2">↑ Areas to Improve</div>
                    <ul className="space-y-1">
                      {scorePanel.data.improvements.map((s: string, si: number) => (
                        <li key={si} className="flex gap-2 text-sm text-gray-600">
                          <span className="text-amber-500 shrink-0">•</span>{s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {scorePanel.data.coachingTips?.length > 0 && (
                  <div className="py-3">
                    <div className="text-xs font-bold text-purple-700 uppercase tracking-wide mb-2">💡 Coaching Tips</div>
                    <ul className="space-y-2">
                      {scorePanel.data.coachingTips.map((s: string, si: number) => (
                        <li key={si} className="flex gap-2 text-sm text-gray-600 bg-purple-50 rounded-lg px-3 py-2">
                          <span className="text-purple-500 shrink-0 font-bold">{si + 1}.</span>{s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Lost Reason Picker */}
      {pendingLostSession && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPendingLostSession(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 w-80 max-w-[90vw]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-bold text-gray-800">Mark as Lost</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Why is <span className="font-semibold text-gray-700">{pendingLostSession.name ?? "this lead"}</span> not moving forward?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "price" as const, label: "Price", color: "#ef4444", bg: "bg-red-50 hover:bg-red-100 border-red-200" },
                { key: "timing" as const, label: "Timing", color: "#f97316", bg: "bg-orange-50 hover:bg-orange-100 border-orange-200" },
                { key: "no_response" as const, label: "No Response", color: "#6b7280", bg: "bg-gray-50 hover:bg-gray-100 border-gray-200" },
                { key: "competitor" as const, label: "Competitor", color: "#8b5cf6", bg: "bg-violet-50 hover:bg-violet-100 border-violet-200" },
              ]).map(r => (
                <button
                  key={r.key}
                  onClick={() => {
                    markAsLostMutation.mutate(
                      { sessionId: pendingLostSession.id, lostReason: r.key },
                      { onSettled: () => setPendingLostSession(null) }
                    );
                  }}
                  disabled={markAsLostMutation.isPending}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${r.bg}`}
                  style={{ color: r.color }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                markAsLostMutation.mutate(
                  { sessionId: pendingLostSession.id, lostReason: "other" },
                  { onSettled: () => setPendingLostSession(null) }
                );
              }}
              disabled={markAsLostMutation.isPending}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-500 transition-colors"
            >
              Other
            </button>
            <button
              onClick={() => setPendingLostSession(null)}
              className="mt-2 w-full text-xs text-gray-400 hover:text-gray-600 transition-colors py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

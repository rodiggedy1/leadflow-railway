/**
 * OperationsPanel.tsx
 * The Operations Center — right panel of the CS Inbox.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import type { CsMissionStage } from "../../../drizzle/schema";
import { EXTRAS_LIST, calculateExtrasTotal } from "../../../shared/extras";
import {
  CheckCircle2,
  Clock,
  Zap,
  Circle,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Phone,
  Link2,
  StickyNote,
  History,
  Loader2,
  Copy,
  Send,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CsMissionRow {
  id: number;
  sessionId: number;
  agentId: number;
  agentName: string | null;
  title: string;
  emoji: string | null;
  status: "active" | "waiting" | "ready" | "sending" | "completed" | "cancelled" | "needs_attention";
  failureReason?: string | null;
  stages: CsMissionStage[];
  sortOrder: number;
  createdAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  cleanerName?: string | null;
  customerName?: string | null;
}

interface OperationsPanelProps {
  sessionId: number | null;
  customerName: string;
  initials: string;
  agentId: number;
  agentName: string;
  isTeams?: boolean;
  onCallClick?: () => void;
  onShareLinkClick?: () => void;
  onNotesClick?: () => void;
  onTimelineClick?: () => void;
  notesCount?: number;
  sseRefetchKey?: number;
}

// ── Stage helpers ──────────────────────────────────────────────────────────────

const STAGE_STYLES: Record<CsMissionStage["status"], {
  border: string;
  bg: string;
  icon: React.ReactNode;
  labelColor: string;
}> = {
  done: {
    border: "border-l-emerald-400",
    bg: "bg-emerald-50/60",
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />,
    labelColor: "text-emerald-700",
  },
  waiting: {
    border: "border-l-amber-400",
    bg: "bg-amber-50/60",
    icon: <Loader2 className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 animate-spin" />,
    labelColor: "text-amber-700",
  },
  ready: {
    border: "border-l-violet-500",
    bg: "bg-violet-50/60",
    icon: <Zap className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />,
    labelColor: "text-violet-700",
  },
  pending: {
    border: "border-l-slate-300",
    bg: "bg-slate-50/60",
    icon: <Circle className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />,
    labelColor: "text-slate-400",
  },
};

const STATUS_BADGE: Record<CsMissionRow["status"], { label: string; className: string }> = {
  active:          { label: "Active",          className: "bg-violet-100 text-violet-700" },
  waiting:         { label: "Waiting",         className: "bg-amber-100 text-amber-700" },
  ready:           { label: "Ready — Send Now", className: "bg-emerald-100 text-emerald-700" },
  sending:         { label: "Sending…",        className: "bg-blue-100 text-blue-700" },
  completed:       { label: "Done",            className: "bg-slate-100 text-slate-500" },
  cancelled:       { label: "Cancelled",       className: "bg-slate-100 text-slate-400" },
  needs_attention: { label: "Needs Attention", className: "bg-red-100 text-red-700" },
};

// ── Stage templates keyed by mission title ─────────────────────────────────────

function buildStages(title: string, teamName: string | null, customerName?: string | null): CsMissionStage[] {
  const team = teamName ?? "the team";
  const customer = customerName ?? "customer";
  const now = Date.now();
  switch (title) {
    case "Get ETA":
      return [
        { id: `${now}-1`, label: `Text ${team} for ETA`, status: "pending" },
        { id: `${now}-2`, label: `Waiting on ${team}`, status: "pending" },
        { id: `${now}-3`, label: `Reply to ${customer} with ETA`, status: "pending" },
      ];
    case "Book Appointment":
      return [
        { id: `${now}-1`, label: "Check schedule for availability", status: "pending" },
        { id: `${now}-2`, label: `Confirm service type, property details & price with ${customer}`, status: "pending" },
        { id: `${now}-3`, label: "Create booking & send confirmation", status: "pending" },
      ];
    case "Send Quote":
      return [
        { id: `${now}-1`, label: `Gather details from ${customer} (beds, baths, scope)`, status: "pending" },
        { id: `${now}-2`, label: "Calculate price & note inclusions", status: "pending" },
        { id: `${now}-3`, label: `Send written quote to ${customer}`, status: "pending" },
      ];
    case "Update Scope & Extras":
      return [
        { id: `${now}-1`, label: `Clarify what ${customer} wants added or changed`, status: "pending" },
        { id: `${now}-2`, label: "Update the job in Launch27", status: "pending" },
        { id: `${now}-3`, label: `Notify ${team} of the scope change`, status: "pending" },
        { id: `${now}-4`, label: `Confirm updated details with ${customer}`, status: "pending" },
      ];
    case "Save Access Details":
      return [
        { id: `${now}-1`, label: `Record door code / key / parking from ${customer}`, status: "pending" },
        { id: `${now}-2`, label: `Share access instructions with ${team}`, status: "pending" },
        { id: `${now}-3`, label: "Confirm access plan before arrival", status: "pending" },
      ];
    case "Reschedule Visit":
      return [
        { id: `${now}-1`, label: "Locate existing booking & check constraints", status: "pending" },
        { id: `${now}-2`, label: `Offer alternative dates/times to ${customer}`, status: "pending" },
        { id: `${now}-3`, label: `Update system, notify ${team} & send new confirmation`, status: "pending" },
      ];
    case "Cancel Booking":
      return [
        { id: `${now}-1`, label: "Find & cancel appointment per policy", status: "pending" },
        { id: `${now}-2`, label: `Inform ${customer} of any fees/refunds`, status: "pending" },
        { id: `${now}-3`, label: `Update ${team} schedule & send cancellation confirmation`, status: "pending" },
      ];
    case "Payment / Invoice":
      return [
        { id: `${now}-1`, label: `Confirm payment method & verify card on file for ${customer}`, status: "pending" },
        { id: `${now}-2`, label: "Send invoice or payment link", status: "pending" },
        { id: `${now}-3`, label: "Confirm payment receipt", status: "pending" },
      ];
    case "Fix Service Issue":
      return [
        { id: `${now}-1`, label: `Apologize & log quality issue from ${customer} (get specifics/photos)`, status: "pending" },
        { id: `${now}-2`, label: `Schedule re-clean & arrange access with ${team}`, status: "pending" },
        { id: `${now}-3`, label: `Follow up with ${customer} after re-clean to confirm satisfaction`, status: "pending" },
      ];
    case "Call Customer":
      return [
        { id: `${now}-1`, label: `Call ${customer} at requested time`, status: "pending" },
        { id: `${now}-2`, label: "Discuss details & agree next steps", status: "pending" },
        { id: `${now}-3`, label: "Log call outcome & send text summary", status: "pending" },
      ];
    case "Send Gate Code":
      return [
        { id: `${now}-1`, label: `Get gate code from ${team}`, status: "pending" },
        { id: `${now}-2`, label: "Send gate code to customer", status: "pending" },
      ];
    case "Follow-up Needed":
      return [
        { id: `${now}-1`, label: "Review customer message", status: "pending" },
        { id: `${now}-2`, label: `Follow up with ${customer}`, status: "pending" },
      ];
    case "Payment Question":
      return [
        { id: `${now}-1`, label: "Review payment issue", status: "pending" },
        { id: `${now}-2`, label: `Resolve with ${customer}`, status: "pending" },
      ];
    case "Room Change Request":
      return [
        { id: `${now}-1`, label: `Notify ${team} of room change`, status: "pending" },
        { id: `${now}-2`, label: `Confirm change with ${customer}`, status: "pending" },
      ];
    case "Special Instructions":
      return [
        { id: `${now}-1`, label: `Forward instructions to ${team}`, status: "pending" },
        { id: `${now}-2`, label: `Confirm receipt with ${customer}`, status: "pending" },
      ];
    default:
      return [
        { id: `${now}-1`, label: "Action needed", status: "pending" },
        { id: `${now}-2`, label: "Follow up", status: "pending" },
      ];
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StageRow({ stage, missionId, onSendReply }: {
  stage: CsMissionStage;
  missionId: number;
  onSendReply?: (text: string, missionId: number) => void;
}) {
  const s = STAGE_STYLES[stage.status];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6 }}
      transition={{ duration: 0.2 }}
      className={`border-l-4 ${s.border} ${s.bg} rounded-r-lg px-3 py-2 flex flex-col gap-1`}
    >
      <div className="flex items-center gap-1.5">
        {s.icon}
        <span className={`text-xs font-semibold ${s.labelColor}`}>{stage.label}</span>
      </div>
      {stage.content && (
        <p className="text-xs text-slate-600 leading-relaxed pl-5">{stage.content}</p>
      )}
      {stage.status === "ready" && stage.suggestedReply && onSendReply && (
        <div className="pl-5 mt-1">
          <p className="text-xs text-slate-500 italic mb-1.5">"{stage.suggestedReply}"</p>
          <button
            onClick={() => onSendReply(stage.suggestedReply!, missionId)}
            className="w-full text-xs font-bold py-2 px-3 rounded-lg text-white transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg, #7C5CFF, #6B4FE0)" }}
          >
            Send to Customer
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ── Pricing helpers (mirrors server/engine/pricing.ts) ────────────────────────

const BEDROOM_BASE: Record<number, number> = {
  1: 119, 2: 209, 3: 229, 4: 279, 5: 319, 6: 379, 7: 419,
};
const BATH_PRICE = 30;
const SERVICE_SURCHARGES: Record<string, number> = {
  "Standard Cleaning": 0,
  "Deep Cleaning": 60,
  "Move-In/Move-Out": 60,
  "Post-Construction Cleaning": 60,
};
const SERVICE_TYPES = ["Standard Cleaning", "Deep Cleaning", "Move-In/Move-Out", "Post-Construction Cleaning"];
const BATH_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4];

// Top extras to show in the widget (most common ones)
const WIDGET_EXTRAS = [
  "clean_inside_oven",
  "clean_inside_cabinets",
  "clean_inside_full_fridge",
  "clean_interior_windows",
  "clean_finished_basement",
  "move_in_move_out",
  "i_have_pets",
  "same_day_booking",
];

interface SessionContext {
  teamName: string | null;
  leadPhone: string | null;
  leadName: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  serviceType: string | null;
}

function SendQuoteWidget({
  mission,
  sessionContext,
  customerName,
}: {
  mission: CsMissionRow;
  sessionContext: SessionContext | null;
  customerName: string;
}) {
  // Parse pre-filled beds/baths from session context
  const initBeds = useMemo(() => {
    const raw = sessionContext?.bedrooms ?? "";
    const m = String(raw).match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : 1;
    return Math.min(Math.max(n, 1), 7);
  }, [sessionContext?.bedrooms]);

  const initBaths = useMemo(() => {
    const raw = sessionContext?.bathrooms ?? "";
    const m = String(raw).match(/(\d+\.?\d*)/);
    const n = m ? parseFloat(m[1]) : 1;
    return BATH_OPTIONS.includes(n) ? n : 1;
  }, [sessionContext?.bathrooms]);

  const initServiceType = useMemo(() => {
    const s = sessionContext?.serviceType ?? "";
    return SERVICE_TYPES.find(t => t.toLowerCase().includes(s.toLowerCase().split(" ")[0])) ?? "Standard Cleaning";
  }, [sessionContext?.serviceType]);

  const [beds, setBeds] = useState(initBeds);
  const [baths, setBaths] = useState(initBaths);
  const [serviceType, setServiceType] = useState(initServiceType);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [smsText, setSmsText] = useState("");
  const [step, setStep] = useState<"configure" | "compose">("configure");
  const [notes, setNotes] = useState("");
  const [finalPriceInput, setFinalPriceInput] = useState("");

  const basePrice = (BEDROOM_BASE[beds] ?? 119) + baths * BATH_PRICE + (SERVICE_SURCHARGES[serviceType] ?? 0);
  const extrasTotal = calculateExtrasTotal(selectedExtras);
  const calculatedPrice = basePrice + extrasTotal;
  const finalPrice = finalPriceInput !== "" ? Math.max(0, Number(finalPriceInput) || 0) : calculatedPrice;
  const discount = calculatedPrice - finalPrice;
  const totalPrice = finalPrice;

  const firstName = (sessionContext?.leadName ?? customerName).split(" ")[0] || "there";
  const welcomeUrl = (() => {
    const base = `https://quote.maidinblack.com/welcome/${encodeURIComponent(firstName)}`;
    const p = new URLSearchParams();
    p.set("beds", String(beds));
    p.set("baths", String(baths));
    p.set("type", serviceType);
    p.set("price", String(calculatedPrice));
    if (finalPriceInput !== "") p.set("finalPrice", String(finalPrice));
    if (discount > 0) p.set("discount", String(discount));
    if (notes.trim()) p.set("notes", encodeURIComponent(notes.trim()));
    if (selectedExtras.length > 0) p.set("extras", selectedExtras.join(","));
    return `${base}?${p.toString()}`;
  })();

  const sendQuoteSms = trpc.csMissions.sendQuoteSms.useMutation({
    onSuccess: () => {
      toast.success("Quote sent to customer! ✨");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to send SMS");
    },
  });

  function handleGenerate() {
    const extrasLines = selectedExtras.length > 0
      ? `\n🧹 Extras: ${EXTRAS_LIST.filter(e => selectedExtras.includes(e.key)).map(e => e.label).join(", ")}`
      : "";
    const serviceLabel = serviceType === "Standard Cleaning" ? "Standard" : serviceType.replace(" Cleaning", "");
    const discountLine = discount > 0 ? `\n🎁 Special discount for ${firstName}: -$${discount}` : "";
    const notesLine = notes.trim() ? `\n\n📝 Note: ${notes.trim()}` : "";
    setSmsText(
      `Hi ${firstName}! 🖤✨ Here's your custom quote:\n\n🏠 ${beds} bed / ${baths} bath — ${serviceLabel}${extrasLines}${discountLine}\n💰 Total: $${finalPrice}${notesLine}\n\nReply to this message or text us to get scheduled! 🧹✨`
    );
    setStep("compose");
  }

  function handleSend() {
    if (!smsText.trim()) return;
    sendQuoteSms.mutate({
      missionId: mission.id,
      sessionId: mission.sessionId,
      text: smsText.trim(),
    });
  }

  function toggleExtra(key: string) {
    setSelectedExtras(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      {step === "configure" ? (
        <>
          {/* Beds / Baths / Service Type */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Beds</label>
              <select
                value={beds}
                onChange={e => setBeds(Number(e.target.value))}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300"
              >
                {[1,2,3,4,5,6,7].map(n => (
                  <option key={n} value={n}>{n} {n === 1 ? "Bed" : "Beds"}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Baths</label>
              <select
                value={baths}
                onChange={e => setBaths(Number(e.target.value))}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300"
              >
                {BATH_OPTIONS.map(n => (
                  <option key={n} value={n}>{n} {n === 1 ? "Bath" : "Baths"}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Type</label>
              <select
                value={serviceType}
                onChange={e => setServiceType(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300"
              >
                {SERVICE_TYPES.map(t => (
                  <option key={t} value={t}>{t.replace(" Cleaning", "").replace("Post-Construction", "Post-Const.")}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Extras */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Extras</label>
            <div className="grid grid-cols-2 gap-1.5">
              {WIDGET_EXTRAS.map(key => {
                const extra = EXTRAS_LIST.find(e => e.key === key);
                if (!extra) return null;
                const selected = selectedExtras.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleExtra(key)}
                    className={`text-[11px] px-2 py-1 rounded-full border transition-all ${
                      selected
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
                    }`}
                  >
                    {extra.label} +${extra.price}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Price row: calculated + final price inline */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-between flex-1 px-3 py-2 rounded-xl bg-violet-50 border border-violet-100">
              <span className="text-xs font-semibold text-violet-700">Price</span>
              <span className="text-sm font-bold text-violet-900">${calculatedPrice}</span>
            </div>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">Final $</span>
              <input
                type="number"
                min="0"
                placeholder={String(calculatedPrice)}
                value={finalPriceInput}
                onChange={e => setFinalPriceInput(e.target.value)}
                className="w-full text-xs pl-14 pr-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300"
              />
            </div>
          </div>
          {discount > 0 && (
            <p className="text-[11px] text-emerald-600 font-semibold -mt-1 pl-1">🎁 Special discount for {firstName}: -${discount}</p>
          )}

          {/* Notes */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. First visit includes oven cleaning"
              rows={2}
              className="text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-violet-300 resize-none leading-relaxed"
            />
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            className="w-full text-xs font-bold py-2.5 rounded-xl text-white transition-all active:scale-95 flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #7C5CFF, #6B4FE0)" }}
          >
            <Link2 className="w-3.5 h-3.5" /> Build Welcome Message
          </button>
        </>
      ) : (
        <>
          {/* Welcome link display */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-100">
            <span className="text-[11px] text-emerald-700 font-medium truncate flex-1">{welcomeUrl}</span>
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(welcomeUrl); toast.success("Link copied!"); }}
              className="flex-shrink-0 text-emerald-600 hover:text-emerald-800"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Editable SMS */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Message to Customer</label>
            <textarea
              value={smsText}
              onChange={e => setSmsText(e.target.value)}
              rows={6}
              className="text-xs px-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none leading-relaxed"
            />
          </div>

          {/* Send + Back */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSend}
              disabled={sendQuoteSms.isPending || !smsText.trim()}
              className="flex-1 text-xs font-bold py-2.5 rounded-xl text-white disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #7C5CFF, #6B4FE0)" }}
            >
              {sendQuoteSms.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending...</>
              ) : (
                <><Send className="w-3.5 h-3.5" /> Send Quote</>
              )}
            </button>
            <button
              type="button"
              onClick={() => setStep("configure")}
              className="text-xs font-semibold py-2 px-3 rounded-xl bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
            >
              ← Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SaveAccessWidget({
  mission,
  sessionContext,
  customerName,
}: {
  mission: CsMissionRow;
  sessionContext: SessionContext | null;
  customerName: string;
}) {
  const utils = trpc.useUtils();
  const sendTeamSms = trpc.csMissions.sendTeamSms.useMutation({
    onSuccess: () => utils.csMissions.listBySession.invalidate({ sessionId: mission.sessionId }),
  });

  const teamPhone = (sessionContext as any)?.teamPhone ?? null;
  const teamName = sessionContext?.teamName ?? "the team";
  const firstName = (sessionContext?.leadName ?? customerName).split(" ")[0] || "the customer";

  const defaultMsg = `Hi! Just a heads up — ${firstName} has provided access details for today's job:\n\n[Paste access details here]\n\nPlease make note before you arrive. Thanks!`;
  const [smsText, setSmsText] = useState(defaultMsg);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!teamPhone) return;
    await sendTeamSms.mutateAsync({
      missionId: mission.id,
      sessionId: mission.sessionId,
      text: smsText,
      teamPhone,
    });
    setSent(true);
  };

  if (sent) {
    return (
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center">
        <p className="text-emerald-700 font-semibold text-sm">Access details sent to {teamName}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
        <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Text to {teamName}</p>
        {!teamPhone && (
          <p className="text-xs text-amber-600 mb-2">No team phone found for today's job — check Launch27</p>
        )}
        <textarea
          className="w-full text-sm rounded-lg border border-amber-300 bg-white p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
          rows={5}
          value={smsText}
          onChange={e => setSmsText(e.target.value)}
        />
        <button
          type="button"
          disabled={!teamPhone || sendTeamSms.isPending}
          onClick={handleSend}
          className="mt-2 w-full py-2 rounded-xl text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sendTeamSms.isPending ? "Sending..." : `Send to ${teamName}`}
        </button>
      </div>
    </div>
  );
}

function MissionCard({
  mission,
  agentId,
  agentName,
  onSendReply,
  onComplete,
  onCancel,
  sessionContext,
  customerName,
}: {
  mission: CsMissionRow;
  agentId: number;
  agentName: string;
  onSendReply?: (text: string, missionId: number) => void;
  onComplete: (missionId: number) => void;
  onCancel: (missionId: number) => void;
  sessionContext?: SessionContext | null;
  customerName?: string;
}) {
  const [expanded, setExpanded] = useState(mission.status !== "completed");
  const badge = STATUS_BADGE[mission.status];
  const isCompleted = mission.status === "completed";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: isCompleted ? 0.6 : 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={`rounded-2xl overflow-hidden transition-shadow duration-200 ${
        isCompleted
          ? "shadow-none"
          : expanded
          ? "shadow-lg shadow-violet-200/70"
          : (mission.status === "ready" || mission.status === "sending")
          ? "ring-2 ring-violet-400 shadow-lg shadow-violet-100"
          : mission.status === "needs_attention"
          ? "ring-2 ring-red-300 shadow-lg shadow-red-50"
          : "shadow-sm"
      }`}
      style={{
        background: "#FFFFFF",
        border: isCompleted
          ? "1px solid rgba(16,24,40,.06)"
          : expanded
          ? "2px solid rgba(124,92,255,0.65)"
          : "1.5px solid rgba(124,92,255,.15)",
      }}
    >
      {/* Colored left accent bar — visible when expanded */}
      {expanded && !isCompleted && (
        <div style={{ height: 3, background: "linear-gradient(90deg, #7C5CFF, #a78bfa)" }} />
      )}
      {/* Card header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors cursor-pointer select-none active:bg-violet-100/60 ${
          expanded && !isCompleted
            ? "bg-violet-50/50 hover:bg-violet-50/70"
            : "hover:bg-slate-50/60"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {mission.emoji && (
            <span className="text-base leading-none flex-shrink-0">{mission.emoji}</span>
          )}
          <span className="text-sm font-bold text-slate-800 truncate">{mission.title}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>
            {badge.label}
          </span>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          }
        </div>
      </button>

      {/* Expandable body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 flex flex-col gap-2">
                            {/* Send Quote interactive widget */}
              {mission.title === "Send Quote" && !isCompleted && (
                <SendQuoteWidget
                  mission={mission}
                  sessionContext={sessionContext ?? null}
                  customerName={customerName ?? ""}
                />
              )}
              {/* Save Access Details — SMS widget to text the team */}
              {mission.title === "Save Access Details" && !isCompleted && (
                <SaveAccessWidget
                  mission={mission}
                  sessionContext={sessionContext ?? null}
                  customerName={customerName ?? ""}
                />
              )}
              {/* Stage pipeline — shown for non-widget missions */}
              {mission.title !== "Send Quote" && mission.title !== "Save Access Details" && (
                mission.stages.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <AnimatePresence mode="popLayout">
                      {mission.stages.map(stage => (
                        <StageRow
                          key={stage.id}
                          stage={stage}
                          missionId={mission.id}
                          onSendReply={onSendReply}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No stages yet.</p>
                )
              )}
              {/* Failure reason for needs_attention missions */}
              {mission.status === "needs_attention" && mission.failureReason && (
                <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-red-50 border border-red-100">
                  <span className="text-red-500 text-xs mt-0.5">⚠</span>
                  <p className="text-xs text-red-700 font-medium">{mission.failureReason}</p>
                </div>
              )}

              {/* Action row — hide for Send Quote (it has its own Send button) */}
              {!isCompleted && mission.title !== "Send Quote" && (
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => onComplete(mission.id)}
                    className="flex-1 text-xs font-semibold py-1.5 px-3 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    ✓ Mark Done
                  </button>
                  <button
                    onClick={() => onCancel(mission.id)}
                    className="text-xs font-semibold py-1.5 px-3 rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              {/* For completed Send Quote missions, show a summary */}
              {isCompleted && mission.title === "Send Quote" && (
                <p className="text-xs text-slate-400 italic">Quote was sent to customer.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── New Mission Form ───────────────────────────────────────────────────────────

const QUICK_TEMPLATES = [
  { emoji: "🚕", title: "Get ETA", missionType: "GET_ETA" },
  { emoji: "📅", title: "Book Appointment", missionType: "MANUAL" },
  { emoji: "🧾", title: "Send Quote", missionType: "MANUAL" },
  { emoji: "🧰", title: "Update Scope & Extras", missionType: "MANUAL" },
  { emoji: "🔑", title: "Save Access Details", missionType: "MANUAL" },
  { emoji: "🔁", title: "Reschedule Visit", missionType: "MANUAL" },
  { emoji: "❌", title: "Cancel Booking", missionType: "MANUAL" },
  { emoji: "💳", title: "Payment / Invoice", missionType: "MANUAL" },
  { emoji: "⚠️", title: "Fix Service Issue", missionType: "MANUAL" },
  { emoji: "📞", title: "Call Customer", missionType: "MANUAL" },
  { emoji: "💬", title: "Follow-up Needed", missionType: "MANUAL" },
  { emoji: "🛏", title: "Room Change Request", missionType: "MANUAL" },
  { emoji: "📋", title: "Special Instructions", missionType: "MANUAL" },
  { emoji: "🔒", title: "Send Gate Code", missionType: "MANUAL" },
];

function NewMissionForm({
  onSubmit,
  onCancel,
  isLoading,
  teamName,
}: {
  onSubmit: (title: string, emoji: string, missionType: string) => void;
  onCancel: () => void;
  isLoading: boolean;
  teamName: string | null;
}) {
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("📌");
  const [missionType, setMissionType] = useState("MANUAL");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: "#F8F6FF", border: "1.5px solid rgba(124,92,255,.25)" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-violet-700 uppercase tracking-wide">New Mission</p>
        {teamName && (
          <span className="text-[10px] text-slate-400 font-medium">
            Team: <span className="text-slate-600 font-semibold">{teamName}</span>
          </span>
        )}
      </div>

      {/* Quick templates */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_TEMPLATES.map(t => (
          <button
            key={t.title}
            type="button"
            onClick={() => { setEmoji(t.emoji); setTitle(t.title); setMissionType(t.missionType); }}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
              title === t.title
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
            }`}
          >
            {t.emoji} {t.title}
          </button>
        ))}
      </div>

      {/* Custom title input */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && title.trim()) onSubmit(title.trim(), emoji, missionType);
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Custom mission title..."
          className="flex-1 text-sm px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!title.trim() || isLoading}
          onClick={() => title.trim() && onSubmit(title.trim(), emoji, missionType)}
          className="flex-1 text-sm font-bold py-2 rounded-xl text-white disabled:opacity-50 transition-all active:scale-95"
          style={{ background: "linear-gradient(135deg, #7C5CFF, #6B4FE0)" }}
        >
          {isLoading ? "Creating..." : "Create Mission"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-semibold py-2 px-4 rounded-xl bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function OperationsPanel({
  sessionId,
  customerName,
  initials,
  agentId,
  agentName,
  isTeams = false,
  onCallClick,
  onShareLinkClick,
  onNotesClick,
  onTimelineClick,
  notesCount = 0,
  sseRefetchKey = 0,
}: OperationsPanelProps) {
  const [showNewForm, setShowNewForm] = useState(false);
  const utils = trpc.useUtils();

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: missions = [], isLoading } = trpc.csMissions.listBySession.useQuery(
    { sessionId: sessionId! },
    {
      enabled: !!sessionId,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    }
  );

  // Session context — team name for stage templates
  const { data: sessionContext } = trpc.csMissions.getSessionContext.useQuery(
    { sessionId: sessionId! },
    {
      enabled: !!sessionId,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    }
  );
  const teamName = sessionContext?.teamName ?? null;

  // Refetch when SSE fires a cs_mission_update for this session
  const prevRefetchKey = useRef(sseRefetchKey);
  useEffect(() => {
    if (sseRefetchKey !== prevRefetchKey.current && sessionId) {
      prevRefetchKey.current = sseRefetchKey;
      utils.csMissions.listBySession.invalidate({ sessionId });
    }
  }, [sseRefetchKey, sessionId, utils]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMission = trpc.csMissions.create.useMutation({
    onSuccess: (data) => {
      setShowNewForm(false);
      if (sessionId) utils.csMissions.listBySession.invalidate({ sessionId });
    },
    onError: (err) => {
      toast.error(err.message || "Could not create mission");
    },
  });
  const completeMission = trpc.csMissions.complete.useMutation({
    onSuccess: () => {
      if (sessionId) utils.csMissions.listBySession.invalidate({ sessionId });
    },
  });
  const cancelMission = trpc.csMissions.cancel.useMutation({
    onSuccess: () => {
      if (sessionId) utils.csMissions.listBySession.invalidate({ sessionId });
    },
  });
  const sendSuggestedReply = trpc.csMissions.sendSuggestedReply.useMutation({
    onSuccess: () => {
      if (sessionId) utils.csMissions.listBySession.invalidate({ sessionId });
      toast.success("Reply sent to customer");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to send reply");
    },
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeMissions = missions.filter(m => m.status !== "completed" && m.status !== "cancelled");
  const completedMissions = missions
    .filter(m => m.status === "completed")
    .sort((a, b) => (b.completedAt ?? b.updatedAt ?? 0) - (a.completedAt ?? a.updatedAt ?? 0));

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleCreate(title: string, emoji: string, missionType: string) {
    if (!sessionId) {
      toast.error("Select a customer conversation before creating a mission");
      return;
    }
    const stages = buildStages(title, teamName, customerName);
    createMission.mutate({ sessionId, title, emoji, stages, missionType });
  }

  function handleSendReply(text: string, missionId: number) {
    sendSuggestedReply.mutate({ missionId, text });
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  const isEmpty = !isLoading && activeMissions.length === 0 && !showNewForm;
  const hasValidContext = !!sessionId;

  return (
    <div
      className="h-full rounded-[28px] overflow-hidden flex flex-col"
      style={{
        background: "#FBFBFC",
        border: "1px solid rgba(16,24,40,.06)",
        boxShadow: "0 10px 28px rgba(15,23,42,.05)",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "24px 24px 20px",
          background: "#FFFFFF",
          borderBottom: "1px solid rgba(16,24,40,.06)",
          flexShrink: 0,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar */}
            <div
              className="flex-shrink-0 flex items-center justify-center text-white font-black text-sm rounded-2xl"
              style={{
                width: 44,
                height: 44,
                background: isTeams
                  ? "linear-gradient(135deg,#14b8a6,#10b981)"
                  : "linear-gradient(135deg,#7C5CFF,#A78BFA)",
                boxShadow: isTeams
                  ? "0 6px 16px rgba(16,185,129,.22)"
                  : "0 6px 16px rgba(124,92,255,.22)",
              }}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <div
                className="font-black text-slate-900 truncate"
                style={{ fontSize: 17, letterSpacing: "-0.03em", lineHeight: 1.2 }}
              >
                {customerName}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: "#7C5CFF" }}
                >
                  Operations
                </span>
                {activeMissions.length > 0 && (
                  <span
                    className="text-[10px] font-black px-1.5 py-0.5 rounded-full text-white"
                    style={{ background: "#7C5CFF" }}
                  >
                    {activeMissions.length}
                  </span>
                )}
                {teamName && (
                  <span className="text-[10px] text-slate-400 font-medium">
                    · {teamName}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* New mission button */}
          {!showNewForm && (
            <button
              type="button"
              disabled={!hasValidContext}
              onClick={() => hasValidContext && setShowNewForm(true)}
              className="flex-shrink-0 flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg,#7C5CFF,#6B4FE0)" }}
              title={!hasValidContext ? "Select a customer conversation first" : undefined}
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          )}
        </div>
      </div>

      {/* ── Mission list (scrollable) ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* No session selected */}
        {!hasValidContext && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
              style={{ background: "rgba(124,92,255,.08)" }}
            >
              💬
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">No conversation selected</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Select a customer conversation to view and create missions
              </p>
            </div>
          </div>
        )}

        {/* New mission form */}
        <AnimatePresence>
          {showNewForm && (
            <NewMissionForm
              key="new-form"
              onSubmit={handleCreate}
              onCancel={() => setShowNewForm(false)}
              isLoading={createMission.isPending}
              teamName={teamName}
            />
          )}
        </AnimatePresence>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="flex flex-col gap-3">
            {[1, 2].map(i => (
              <div
                key={i}
                className="h-16 rounded-2xl animate-pulse"
                style={{ background: "rgba(124,92,255,.06)" }}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {isEmpty && hasValidContext && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center gap-3 py-10 text-center"
          >
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
              style={{ background: "rgba(124,92,255,.08)" }}
            >
              🎯
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">No active operations</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Create a mission to track work for this conversation
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewForm(true)}
              className="text-xs font-bold px-4 py-2 rounded-xl text-white transition-all hover:opacity-90"
              style={{ background: "linear-gradient(135deg,#7C5CFF,#6B4FE0)" }}
            >
              + Create Mission
            </button>
          </motion.div>
        )}

        {/* Active missions */}
        <AnimatePresence mode="popLayout">
          {activeMissions.map(mission => (
            <MissionCard
              key={mission.id}
              mission={mission as CsMissionRow}
              agentId={agentId}
              agentName={agentName}
              onSendReply={handleSendReply}
              onComplete={id => completeMission.mutate({ missionId: id })}
              onCancel={id => cancelMission.mutate({ missionId: id })}
              sessionContext={sessionContext ?? null}
              customerName={customerName}
            />
          ))}
        </AnimatePresence>

        {/* Completed missions */}
        {completedMissions.length > 0 && (
          <details className="group" open>
            <summary className="text-xs font-semibold text-slate-400 cursor-pointer select-none hover:text-slate-600 transition-colors list-none flex items-center gap-1.5 py-1">
              <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
              {completedMissions.length} completed
            </summary>
            <div className="flex flex-col gap-2 mt-2">
              <AnimatePresence>
                {completedMissions.map(mission => (
                  <MissionCard
                    key={mission.id}
                    mission={mission as CsMissionRow}
                    agentId={agentId}
                    agentName={agentName}
                    onComplete={id => completeMission.mutate({ missionId: id })}
                    onCancel={id => cancelMission.mutate({ missionId: id })}
                    sessionContext={sessionContext ?? null}
                    customerName={customerName}
                  />
                ))}
              </AnimatePresence>
            </div>
          </details>
        )}
      </div>

      {/* ── Reference footer ────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex flex-col gap-0"
        style={{
          borderTop: "1px solid rgba(16,24,40,.06)",
          background: "#FFFFFF",
        }}
      >
        <div className="flex divide-x divide-slate-100">
          <button
            type="button"
            onClick={onNotesClick}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
          >
            <StickyNote className="w-3.5 h-3.5" />
            Notes{notesCount > 0 ? ` (${notesCount})` : ""}
          </button>
          <button
            type="button"
            onClick={onTimelineClick}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
          >
            <History className="w-3.5 h-3.5" />
            Timeline
          </button>
        </div>

        <div
          className="flex divide-x"
          style={{ borderTop: "1px solid rgba(16,24,40,.06)", divideColor: "rgba(16,24,40,.06)" }}
        >
          {onCallClick && (
            <button
              type="button"
              onClick={onCallClick}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Phone className="w-3.5 h-3.5 text-emerald-500" />
              Call
            </button>
          )}
          {onShareLinkClick && (
            <button
              type="button"
              onClick={onShareLinkClick}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Link2 className="w-3.5 h-3.5 text-violet-500" />
              Share Link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OperationsPanel;

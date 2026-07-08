/**
 * SmsCampaigns — /admin/sms-campaigns
 *
 * SMS Campaign Command Center: 5-step wizard for building a safe audience,
 * composing a personalized message, and sending a bulk SMS campaign.
 *
 * UI-only for now — logic will be wired in a subsequent phase.
 */
import { useState, useEffect } from "react";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Users,
  ShieldCheck,
  MessageSquare,
  FlaskConical,
  Send,
  MapPin,
  Sparkles,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Ban,
  Copy,
  ChevronRight,
  ChevronLeft,
  Zap,
  Phone,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5;
type LastBookingFilter = "30d" | "90d" | "6mo" | "1yr" | "any";
type FrequencyFilter = "one-time" | "former-recurring" | "active-recurring";
type RadiusFilter = "3mi" | "5mi" | "10mi" | "15mi";

interface AudienceState {
  lastBooking: LastBookingFilter;
  frequencies: Set<FrequencyFilter>;
  radius: RadiusFilter;
  location: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5 text-amber-400 text-sm">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ opacity: i <= rating ? 1 : 0.25 }}>★</span>
      ))}
    </div>
  );
}

function randomCount() {
  const vals = [184, 92, 137, 221, 156, 203];
  return vals[Math.floor(Math.random() * vals.length)];
}

// ── WorkflowBar ───────────────────────────────────────────────────────────────

function WorkflowBar({ step, onStep }: { step: Step; onStep: (s: Step) => void }) {
  const steps: { id: Step; label: string; icon: React.ReactNode }[] = [
    { id: 1, label: "Audience",  icon: <Users className="w-3.5 h-3.5" /> },
    { id: 2, label: "Safety",    icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { id: 3, label: "Message",   icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: 4, label: "Test",      icon: <FlaskConical className="w-3.5 h-3.5" /> },
    { id: 5, label: "Type SEND", icon: <Send className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex items-center gap-1.5 my-4">
      {steps.map((s, idx) => {
        const done = s.id < step;
        const active = s.id === step;
        return (
          <div key={s.id} className="flex items-center gap-1.5 flex-1 min-w-0">
            <button
              onClick={() => onStep(s.id)}
              className={[
                "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold transition-all w-full justify-center truncate",
                active
                  ? "bg-gray-900 text-white shadow-md"
                  : done
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-gray-100 text-gray-400",
              ].join(" ")}
            >
              {done ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : s.icon}
              <span className="hidden sm:inline truncate">{s.label}</span>
              <span className="sm:hidden">{s.id}</span>
            </button>
            {idx < steps.length - 1 && (
              <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── HeroCard ──────────────────────────────────────────────────────────────────

function HeroCard({
  count,
  excluded,
  expectedReplies,
}: {
  count: number;
  excluded: number;
  expectedReplies: number;
}) {
  return (
    <div
      className="rounded-3xl p-7 text-center text-white mb-4"
      style={{ background: "linear-gradient(180deg,#111827 0%,#1f2937 100%)" }}
    >
      <div className="text-xs font-black uppercase tracking-widest text-gray-400 mb-1">
        Recipients
      </div>
      <div
        className="font-black text-white leading-none mb-1 tabular-nums"
        style={{ fontSize: 72 }}
      >
        {count}
      </div>
      <div className="text-sm text-gray-300 mb-5">eligible customers</div>
      <div className="grid grid-cols-2 gap-3">
        <div
          className="rounded-2xl p-3"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div className="text-xl font-black">{excluded}</div>
          <div className="text-xs text-gray-400 mt-0.5">excluded</div>
        </div>
        <div
          className="rounded-2xl p-3"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div className="text-xl font-black">{expectedReplies}</div>
          <div className="text-xs text-gray-400 mt-0.5">expected replies</div>
        </div>
      </div>
    </div>
  );
}

// ── Chip ──────────────────────────────────────────────────────────────────────

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-3 py-2 rounded-full text-xs font-bold border transition-all mr-1.5 mb-1.5",
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-700 border-gray-300 hover:border-gray-500",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

// ── MapPlaceholder ────────────────────────────────────────────────────────────

function MapPlaceholder({ location }: { location: string }) {
  return (
    <div
      className="rounded-2xl flex flex-col items-center justify-center my-3 relative overflow-hidden"
      style={{
        height: 160,
        background:
          "radial-gradient(circle at center, #dbeafe 0% 34%, #eef2ff 35% 55%, #f8fafc 56%)",
        border: "1px solid #e5e7eb",
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="rounded-full border border-blue-200 opacity-50"
          style={{ width: 120, height: 120 }}
        />
        <div
          className="absolute rounded-full border border-blue-300 opacity-40"
          style={{ width: 80, height: 80 }}
        />
      </div>
      <div className="relative z-10 flex flex-col items-center">
        <div
          className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center"
          style={{ boxShadow: "0 0 0 10px rgba(239,68,68,0.12)" }}
        >
          <MapPin className="w-3 h-3 text-white" />
        </div>
        <div className="mt-2 text-xs font-semibold text-gray-600 bg-white/80 px-2 py-0.5 rounded-full shadow-sm">
          {location || "Set location"}
        </div>
      </div>
    </div>
  );
}

// ── StepAudience ──────────────────────────────────────────────────────────────

function StepAudience({
  audience,
  setAudience,
  setRecipientCount,
}: {
  audience: AudienceState;
  setAudience: React.Dispatch<React.SetStateAction<AudienceState>>;
  setRecipientCount: (n: number) => void;
}) {
  const lastBookingOptions: { value: LastBookingFilter; label: string }[] = [
    { value: "30d",  label: "30 days" },
    { value: "90d",  label: "90 days" },
    { value: "6mo",  label: "6 months" },
    { value: "1yr",  label: "1 year" },
    { value: "any",  label: "Any" },
  ];
  const frequencyOptions: { value: FrequencyFilter; label: string }[] = [
    { value: "one-time",         label: "One-time" },
    { value: "former-recurring", label: "Former recurring" },
    { value: "active-recurring", label: "Active recurring" },
  ];
  const radiusOptions: { value: RadiusFilter; label: string }[] = [
    { value: "3mi",  label: "3 mi" },
    { value: "5mi",  label: "5 mi" },
    { value: "10mi", label: "10 mi" },
    { value: "15mi", label: "15 mi" },
  ];

  const toggleFrequency = (f: FrequencyFilter) => {
    setAudience((prev) => {
      const next = new Set(prev.frequencies);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return { ...prev, frequencies: next };
    });
    setRecipientCount(randomCount());
  };

  const useAiRecommendation = () => {
    setAudience({
      lastBooking: "90d",
      frequencies: new Set<FrequencyFilter>(["one-time", "former-recurring"]),
      radius: "10mi",
      location: audience.location,
    });
    setRecipientCount(137);
    toast.success("AI recommended audience applied — 90 days, 10 mi radius");
  };

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm">
      <h2 className="font-bold text-gray-900 text-base mb-4">Audience Filters</h2>

      <div className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">
        Last booking
      </div>
      <div className="flex flex-wrap mb-4">
        {lastBookingOptions.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            active={audience.lastBooking === o.value}
            onClick={() => {
              setAudience((p) => ({ ...p, lastBooking: o.value }));
              setRecipientCount(randomCount());
            }}
          />
        ))}
      </div>

      <div className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">
        Frequency
      </div>
      <div className="flex flex-wrap mb-4">
        {frequencyOptions.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            active={audience.frequencies.has(o.value)}
            onClick={() => toggleFrequency(o.value)}
          />
        ))}
      </div>

      <div className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">
        Target radius
      </div>
      <Input
        value={audience.location}
        onChange={(e) => setAudience((p) => ({ ...p, location: e.target.value }))}
        placeholder="e.g. Arlington, VA 22201"
        className="mb-0 rounded-xl border-gray-300"
      />
      <MapPlaceholder location={audience.location} />
      <div className="flex flex-wrap">
        {radiusOptions.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            active={audience.radius === o.value}
            onClick={() => {
              setAudience((p) => ({ ...p, radius: o.value }));
              setRecipientCount(randomCount());
            }}
          />
        ))}
      </div>

      {/* AI Recommendation */}
      <div
        className="mt-4 rounded-2xl p-4"
        style={{ background: "#eef4ff", border: "1px solid #b2ccff" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-blue-700" />
          <span className="font-bold text-blue-900 text-sm">AI Recommendation</span>
        </div>
        <p className="text-sm text-blue-800 mb-3">
          Best segment: customers 90–180 days since last clean within 7 miles. Expected reply
          rate: <strong>17%</strong>.
        </p>
        <Button
          size="sm"
          className="bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-bold"
          onClick={useAiRecommendation}
        >
          Use Recommendation
        </Button>
      </div>
    </div>
  );
}

// ── SafetySummary ─────────────────────────────────────────────────────────────

function SafetySummary() {
  const stats = [
    { icon: <Ban className="w-4 h-4 text-red-500" />,           label: "STOP / opt-out",  value: 8,  color: "text-red-600" },
    { icon: <AlertTriangle className="w-4 h-4 text-amber-500" />, label: "Open issues",    value: 11, color: "text-amber-600" },
    { icon: <Clock className="w-4 h-4 text-blue-500" />,         label: "Recently texted", value: 22, color: "text-blue-600" },
    { icon: <Copy className="w-4 h-4 text-gray-400" />,          label: "Duplicates",      value: 0,  color: "text-gray-500" },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm">
      <h2 className="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-600" />
        Safety Summary
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-gray-50 border border-gray-100 rounded-2xl p-3">
            <div className="flex items-center gap-1.5 mb-1">{s.icon}</div>
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── LiveAudiencePreview ───────────────────────────────────────────────────────

const PREVIEW_PEOPLE = [
  { name: "Jennifer Smith", rating: 5, lastClean: "42 days ago",  distance: "3.1 miles", type: "Former recurring" },
  { name: "Alex Grant",     rating: 5, lastClean: "8 months ago", distance: "2.4 miles", type: "One-time" },
  { name: "Nina Lee",       rating: 4, lastClean: "92 days ago",  distance: "4.4 miles", type: "Former recurring" },
];

function LiveAudiencePreview() {
  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
        <Users className="w-4 h-4 text-gray-600" />
        Live Audience Preview
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PREVIEW_PEOPLE.map((p) => (
          <div key={p.name} className="border border-gray-100 rounded-2xl p-3 bg-white">
            <div className="font-bold text-gray-900 text-sm mb-1">{p.name}</div>
            <StarRating rating={p.rating} />
            <div className="text-xs text-gray-500 mt-2 leading-relaxed">
              Last clean: {p.lastClean}
              <br />
              {p.distance} · {p.type}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MessageEditor ─────────────────────────────────────────────────────────────

const DEFAULT_MESSAGE =
  "Hi {{first_name}}, this is Madison from Maid in Black 😊 We have a few openings near {{area}} this week and wanted to see if you'd like help with a cleaning. Want me to send available times?";

function MessageEditor({
  message,
  setMessage,
}: {
  message: string;
  setMessage: (m: string) => void;
}) {
  const insertVar = (v: string) => setMessage(message + v);
  const charCount = message.length;
  const smsCount = Math.ceil(charCount / 160) || 1;

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-3 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-gray-600" />
        Message
      </h2>
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => insertVar("{{first_name}}")}
          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
        >
          + first_name
        </button>
        <button
          onClick={() => insertVar("{{area}}")}
          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-colors"
        >
          + area
        </button>
      </div>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="min-h-[110px] rounded-xl border-gray-300 text-sm leading-relaxed resize-none"
        placeholder="Write your message…"
      />
      <div className="flex justify-between items-center mt-2 text-xs text-gray-400">
        <span>{charCount} chars</span>
        <span>
          {smsCount} SMS segment{smsCount > 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// ── PersonalizedPreviews ──────────────────────────────────────────────────────

function PersonalizedPreviews({ message }: { message: string }) {
  const previews = [
    { name: "Jennifer", firstName: "Jennifer", area: "Arlington" },
    { name: "Alex",     firstName: "Alex",     area: "Arlington" },
    { name: "Nina",     firstName: "Nina",     area: "Arlington" },
  ];

  const personalize = (tpl: string, firstName: string, area: string) =>
    tpl.replace(/\{\{first_name\}\}/g, firstName).replace(/\{\{area\}\}/g, area);

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
        <Phone className="w-4 h-4 text-gray-600" />
        Personalized Previews
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {previews.map((p) => (
          <div
            key={p.name}
            className="rounded-3xl p-4 min-h-[200px]"
            style={{ background: "#101828" }}
          >
            <div className="text-white font-bold text-sm mb-1">{p.name}</div>
            <div
              className="text-white text-xs leading-relaxed mt-3 p-3"
              style={{
                background: "#2563eb",
                borderRadius: "18px 18px 4px 18px",
              }}
            >
              {personalize(message, p.firstName, p.area)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── StepTest ──────────────────────────────────────────────────────────────────

function StepTest({
  onTestSent,
}: {
  message: string;
  onTestSent: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    if (!phone.trim()) {
      toast.error("Enter a phone number");
      return;
    }
    setSending(true);
    setTimeout(() => {
      setSending(false);
      setSent(true);
      onTestSent();
      toast.success("Test SMS sent! (UI-only — logic not wired yet)");
    }, 1200);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-3 flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-gray-600" />
        Send Test SMS
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Send yourself a preview before the real campaign goes out. The message will be
        personalized with your name.
      </p>
      <div className="flex gap-2">
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 (555) 000-0000"
          className="rounded-xl border-gray-300"
        />
        <Button
          onClick={handleSend}
          disabled={sending || sent}
          className={[
            "rounded-xl font-bold px-5 flex-shrink-0",
            sent
              ? "bg-emerald-600 hover:bg-emerald-600"
              : "bg-gray-900 hover:bg-gray-800",
          ].join(" ")}
        >
          {sending ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Sending…
            </span>
          ) : sent ? (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Sent!
            </span>
          ) : (
            "Send Test"
          )}
        </Button>
      </div>
      {sent && (
        <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          <CheckCircle2 className="w-4 h-4" />
          Test SMS sent — check your phone and verify the message looks right.
        </div>
      )}
    </div>
  );
}

// ── StepFinalApproval ─────────────────────────────────────────────────────────

function StepFinalApproval({
  recipientCount,
  testSent,
}: {
  recipientCount: number;
  testSent: boolean;
  message: string;
}) {
  const [confirmText, setConfirmText] = useState("");
  const expectedConfirm = `SEND ${recipientCount}`;
  const isReady = testSent && confirmText.trim() === expectedConfirm;

  const checks = [
    { label: "Audience reviewed",    status: "passed",                                         note: "" },
    { label: "Test SMS sent",        status: testSent ? "passed" : "pending",                  note: "" },
    { label: "Quiet hours protected", status: "passed",                                         note: "9am–8pm local time" },
    { label: "Opt-outs excluded",    status: "passed",                                         note: "8 contacts excluded" },
    {
      label: "Type confirmation",
      status: confirmText === expectedConfirm ? "passed" : "required",
      note: `Type: ${expectedConfirm}`,
    },
  ];

  const handleSchedule = () => {
    if (!isReady) {
      toast.error("Complete all checks first");
      return;
    }
    toast.success("Campaign scheduled! (UI-only — logic not wired yet)");
  };

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
        <Send className="w-4 h-4 text-gray-600" />
        Final Approval
      </h2>

      <table className="w-full border-collapse mb-4">
        <thead>
          <tr>
            <th className="text-left text-xs font-black uppercase tracking-widest text-gray-400 pb-2 border-b border-gray-100">
              Check
            </th>
            <th className="text-left text-xs font-black uppercase tracking-widest text-gray-400 pb-2 border-b border-gray-100">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.label} className="border-b border-gray-50">
              <td className="py-3 text-sm text-gray-700">{c.label}</td>
              <td className="py-3">
                {c.status === "passed" ? (
                  <span className="flex items-center gap-1 text-emerald-600 text-sm font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Passed
                  </span>
                ) : c.status === "pending" ? (
                  <span className="flex items-center gap-1 text-amber-500 text-sm font-semibold">
                    <Clock className="w-3.5 h-3.5" /> Pending
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-gray-500">
                    Required:{" "}
                    <strong className="text-gray-900">{c.note}</strong>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Type confirmation */}
      <div className="mb-5">
        <div className="text-xs font-bold text-gray-500 mb-1.5">
          Type{" "}
          <span className="font-black text-gray-900">{expectedConfirm}</span> to unlock
          sending
        </div>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={`Type "${expectedConfirm}" here`}
          className={[
            "rounded-xl font-mono",
            confirmText === expectedConfirm
              ? "border-emerald-400 bg-emerald-50 text-emerald-800"
              : "border-gray-300",
          ].join(" ")}
        />
      </div>

      <div className="flex justify-between items-center gap-3">
        <Button
          variant="outline"
          className="rounded-xl font-bold border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          onClick={() => toast.info("Draft saved (UI-only)")}
        >
          Save Draft
        </Button>
        <Button
          onClick={handleSchedule}
          disabled={!isReady}
          className={[
            "rounded-xl font-bold px-6",
            isReady
              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          <Zap className="w-4 h-4 mr-1.5" />
          Schedule Campaign
        </Button>
      </div>
    </div>
  );
}

// ── Main content ──────────────────────────────────────────────────────────────

function SmsCampaignsContent() {
  const [step, setStep] = useState<Step>(1);
  const [recipientCount, setRecipientCount] = useState(184);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [testSent, setTestSent] = useState(false);
  const [audience, setAudience] = useState<AudienceState>({
    lastBooking: "90d",
    frequencies: new Set<FrequencyFilter>(["one-time", "former-recurring"]),
    radius: "5mi",
    location: "Arlington, VA 22201",
  });

  const goNext = () => setStep((s) => (Math.min(s + 1, 5) as Step));
  const goPrev = () => setStep((s) => (Math.max(s - 1, 1) as Step));

  return (
    <>
      {/* Page header */}
      <div className="flex items-start justify-between mb-1 gap-4">
        <div>
          <h1
            className="text-2xl font-black text-gray-900"
            style={{ letterSpacing: "-0.03em" }}
          >
            SMS Campaign Command Center
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Build the safest possible audience before anyone can send anything.
          </p>
        </div>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 flex-shrink-0 mt-1">
          <ShieldCheck className="w-3.5 h-3.5" />
          Draft · Send locked
        </span>
      </div>

      {/* Workflow progress bar */}
      <WorkflowBar step={step} onStep={setStep} />

      {/* 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[390px_1fr] gap-4 mt-2">
        {/* LEFT: Hero + Audience */}
        <div>
          <HeroCard count={recipientCount} excluded={41} expectedReplies={24} />
          <StepAudience
            audience={audience}
            setAudience={setAudience}
            setRecipientCount={setRecipientCount}
          />
        </div>

        {/* RIGHT: All other panels */}
        <div>
          <SafetySummary />
          <LiveAudiencePreview />
          <MessageEditor message={message} setMessage={setMessage} />
          <PersonalizedPreviews message={message} />
          <StepTest message={message} onTestSent={() => setTestSent(true)} />
          <StepFinalApproval
            recipientCount={recipientCount}
            testSent={testSent}
            message={message}
          />
        </div>
      </div>

      {/* Bottom step navigation */}
      <div className="flex justify-between items-center mt-6 pb-8">
        <Button
          variant="outline"
          onClick={goPrev}
          disabled={step === 1}
          className="rounded-xl font-bold gap-1.5"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </Button>
        <span className="text-xs text-gray-400 font-medium">Step {step} of 5</span>
        <Button
          onClick={goNext}
          disabled={step === 5}
          className="bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-bold gap-1.5"
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </>
  );
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function SmsCampaigns() {
  const { isAdmin } = useAgentPermissions();

  return (
    <AdminPageGuard pageId="sms-campaigns">
      <AdminHeader activeTab="sms-campaigns" isAdmin={isAdmin} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <SmsCampaignsContent />
      </main>
    </AdminPageGuard>
  );
}

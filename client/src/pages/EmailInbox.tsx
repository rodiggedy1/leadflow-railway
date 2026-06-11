/**
 * EmailInbox — Shared Gmail inbox for all agents
 * Wired to real Gmail data via tRPC gmail.* procedures.
 * Real-time refresh via SSE gmail_new_messages event.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import DOMPurify from "dompurify";
import {
  Mail, Search, Paperclip, Link2, Send, RefreshCw,
  Loader2, AlertCircle, Archive, MailOpen, MailCheck, Plus, Sparkles, Flag, X, FileText,
  UserCheck, ChevronDown, CheckCircle2, ChevronRight,
} from "lucide-react";
import { useOpsStream } from "@/hooks/useOpsStream";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ---------------------------------------------------------------------------
// Canned reply templates
// ---------------------------------------------------------------------------
const CANNED_TEMPLATES = [
  {
    id: 1,
    label: "Confirm Booking",
    subject: "Your Cleaning is Confirmed! 🎉",
    body: `Hi {{first_name}},

You're all set! Your cleaning has been confirmed for {{date}} at {{time}}.

Our team will arrive within the scheduled arrival window and will come fully equipped with supplies unless otherwise requested.

If you have any special instructions, parking information, or entry details, simply reply to this email.

We look forward to making your home shine!

Thanks,
The Maid in Black Team`,
  },
  {
    id: 2,
    label: "Request Address",
    subject: "Quick Question Before We Finalize Your Quote",
    body: `Hi {{first_name}},

Thanks for reaching out!

Before we can provide an accurate quote, could you please send us the full service address for the property?

Once we have that, we'll get pricing over to you right away.

Thanks,
The Maid in Black Team`,
  },
  {
    id: 3,
    label: "Send Quote Link",
    subject: "Your Cleaning Quote is Ready",
    body: `Hi {{first_name}},

Great news! Your personalized cleaning quote is ready.

You can review your pricing and book online here:

{{quote_link}}

If you have any questions or would like to make changes before booking, simply reply to this email and we're happy to help.

Thanks,
The Maid in Black Team`,
  },
  {
    id: 4,
    label: "Follow Up (No Response)",
    subject: "Just Checking In",
    body: `Hi {{first_name}},

Just wanted to follow up in case you were still looking for a cleaning service.

Your quote is still available, and we'd be happy to get you on the schedule.

You can view and book here:

{{quote_link}}

Let us know if you have any questions!

Thanks,
The Maid in Black Team`,
  },
  {
    id: 5,
    label: "Need Entry Instructions",
    subject: "",
    body: `Hi {{first_name}},

Before your appointment, could you let us know how our team should access the property?

Examples include:
• Door code
• Lockbox
• Concierge
• Someone will be home
• Key under mat

Thanks!`,
  },
  {
    id: 6,
    label: "Running Late",
    subject: "",
    body: `Hi {{first_name}},

Just a quick update—our team is running a little behind due to the previous appointment taking longer than expected.

Our estimated arrival time is now approximately {{arrival_time}}.

We appreciate your patience and apologize for the inconvenience.`,
  },
  {
    id: 7,
    label: "Team On The Way",
    subject: "",
    body: `Hi {{first_name}},

Our cleaning team is officially on the way and should arrive shortly.

If you have any last-minute instructions, feel free to reply here.

See you soon!`,
  },
  {
    id: 8,
    label: "Payment Reminder",
    subject: "",
    body: `Hi {{first_name}},

Just a friendly reminder that we still need a card on file before your appointment.

You can securely update your payment information here:

{{payment_link}}

If you have any questions, let us know!`,
  },
  {
    id: 9,
    label: "Thank You After Service",
    subject: "",
    body: `Hi {{first_name}},

Thank you for choosing Maid in Black!

We hope you loved your cleaning. If everything looks great, we'd really appreciate a quick review—it helps our small business tremendously.

If there's anything that isn't perfect, please reply directly and we'll make it right.

Thanks again!`,
  },
  {
    id: 10,
    label: "Recurring Cleaning Offer",
    subject: "",
    body: `Hi {{first_name}},

Many of our customers save both time and money by switching to recurring cleanings.

Weekly, bi-weekly, and monthly services receive discounted pricing and priority scheduling.

If you'd like a recurring quote, just let us know and we'll set it up for you.`,
  },
  {
    id: 11,
    label: "Quote Expiring",
    subject: "",
    body: `Hi {{first_name}},

Just a heads up—your quote will expire soon.

If you'd still like to book at the current rate, you can reserve your appointment here:

{{quote_link}}

Hope to see you soon!`,
  },
  {
    id: 12,
    label: "Unable to Reach",
    subject: "",
    body: `Hi {{first_name}},

We tried reaching you regarding your upcoming cleaning but haven't been able to connect.

Please reply or give us a call at your earliest convenience so we can finalize your appointment.

We look forward to hearing from you!`,
  },
  {
    id: 13,
    label: "Cancellation Confirmed",
    subject: "",
    body: `Hi {{first_name}},

We've successfully canceled your scheduled cleaning for {{date}}.

If you'd like to reschedule for another day, simply reply to this email and we'd be happy to help.

Thank you!`,
  },
  {
    id: 14,
    label: "Request Photos for Quote",
    subject: "",
    body: `Hi {{first_name}},

To provide the most accurate estimate, could you send us a few photos of the areas you'd like cleaned?

Photos of the kitchen, bathrooms, living areas, and any areas of concern are especially helpful.

Once we receive them, we'll get your quote over as quickly as possible.

Thanks!`,
  },
  {
    id: 15,
    label: "Deep Cleaning Explanation",
    subject: "",
    body: `Hi {{first_name}},

A deep cleaning includes everything in our standard cleaning plus extra attention to buildup and hard-to-reach areas.

Typical deep cleaning tasks include:
• Baseboards
• Doors and door frames
• Window sills
• Cabinet fronts
• Detailed bathroom scrubbing
• Detailed kitchen cleaning
• Dusting reachable vents and fixtures
• Extra attention to buildup throughout the home

It's the perfect option for first-time customers or homes that haven't been professionally cleaned in a while.

Let us know if you have any questions!`,
  },
] as const;
import { senderColorClass, senderHex } from "@/lib/senderColor";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type RouterOutput = inferRouterOutputs<AppRouter>;
type GmailThread = RouterOutput["gmail"]["listThreads"]["threads"][number];
type GmailMessage = GmailThread["messages"][number] & {
  sentBy?: { name: string; photoUrl: string | null } | null;
};

function getInitials(name: string): string {
  return name.split(/\s+/).map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase();
}

function formatDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function NotConnectedBanner() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-black text-slate-800 mb-2">Gmail not connected</h2>
        <p className="text-sm text-slate-500 mb-6">
          An admin needs to complete the one-time OAuth flow to connect the shared inbox.
        </p>
        <a
          href="/api/gmail/oauth/start"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-colors"
        >
          Connect Gmail Account
        </a>
      </div>
    </div>
  );
}

function ThreadItem({ thread, active, onClick, isIssue, issueSummary, assignedToName, assignedToPhotoUrl, aiCategory }: { thread: GmailThread; active: boolean; onClick: () => void; isIssue?: boolean; issueSummary?: string | null; assignedToName?: string | null; assignedToPhotoUrl?: string | null; aiCategory?: string | null }) {
  const senderName = thread.from || thread.fromEmail || "?";
  const accentColor = isIssue ? "#dc2626" : senderHex(senderName);
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3.5 border-b transition-colors group relative",
        isIssue ? "border-red-100" : "border-slate-100",
        active
          ? isIssue ? "bg-red-50/80" : "bg-blue-50/70"
          : isIssue
          ? "bg-red-50/40 hover:bg-red-50/70"
          : thread.isUnread
          ? "bg-white hover:bg-slate-50/80"
          : "bg-white hover:bg-slate-50/60"
      )}
    >
      {/* Left accent bar */}
      {(active || isIssue) && (
        <span className={cn(
          "absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full",
          isIssue ? "bg-red-500" : "bg-blue-500"
        )} />
      )}
      <div className="flex items-start gap-2.5">
        {/* Sender avatar */}
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5",
            isIssue ? "bg-red-100 text-red-700" : senderColorClass(senderName)
          )}
        >
          {isIssue ? <Flag className="w-3.5 h-3.5" /> : getInitials(senderName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span
              className={cn("text-sm leading-snug truncate font-bold")}
              style={{ color: accentColor }}
            >
              {senderName}
            </span>
            <span className="text-[11px] text-slate-400 shrink-0">{formatDate(thread.date)}</span>
          </div>
          <p className={cn("text-xs leading-snug truncate mb-1", thread.isUnread ? "text-slate-700 font-medium" : "text-slate-500")}>
            {thread.subject}
          </p>
          {isIssue && issueSummary ? (
            <p className="text-[11px] text-red-500 line-clamp-1 leading-relaxed font-medium">
              {issueSummary}
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 line-clamp-1 leading-relaxed">
              {thread.snippet?.slice(0, 80)}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {isIssue && (
              <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
                ISSUE
              </span>
            )}
            {thread.isUnread && (
              <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                UNREAD
              </span>
            )}
            {aiCategory && aiCategory !== "general" && GLANCE_CATEGORY_LABELS[aiCategory] && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                <span className="text-[10px] leading-none">{GLANCE_CATEGORY_LABELS[aiCategory].emoji}</span>
                {GLANCE_CATEGORY_LABELS[aiCategory].label}
              </span>
            )}
            {assignedToName && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
                {assignedToPhotoUrl ? (
                  <img src={assignedToPhotoUrl} alt={assignedToName} className="w-3.5 h-3.5 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full bg-violet-200 flex items-center justify-center text-[8px] font-black text-violet-700 shrink-0">
                    {assignedToName[0]?.toUpperCase()}
                  </span>
                )}
                {assignedToName.split(" ")[0]}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

/** Renders a single attachment — image thumbnail or file download chip */
function AttachmentItem({ messageId, att }: {
  messageId: string;
  att: { filename: string; mimeType: string; attachmentId: string };
}) {
  const isImage = att.mimeType.startsWith("image/");
  const attachmentQuery = trpc.gmail.getAttachment.useQuery(
    { messageId, attachmentId: att.attachmentId, mimeType: att.mimeType },
    { staleTime: Infinity, retry: false }
  );
  if (isImage) {
    return (
      <div className="mt-2">
        {attachmentQuery.isLoading ? (
          <div className="w-48 h-32 rounded-xl bg-slate-100 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : attachmentQuery.data ? (
          <a href={attachmentQuery.data.dataUrl} download={att.filename} target="_blank" rel="noreferrer">
            <img
              src={attachmentQuery.data.dataUrl}
              alt={att.filename}
              className="max-w-sm max-h-64 rounded-xl border border-slate-100 object-contain cursor-pointer hover:opacity-90 transition-opacity"
            />
          </a>
        ) : (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5" /> Failed to load image
          </div>
        )}
      </div>
    );
  }
  // Non-image: download chip
  return (
    <div className="mt-2">
      {attachmentQuery.data ? (
        <a
          href={attachmentQuery.data.dataUrl}
          download={att.filename}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors"
        >
          <FileText className="w-3.5 h-3.5 text-slate-400" />
          <span className="truncate max-w-[180px]">{att.filename}</span>
        </a>
      ) : attachmentQuery.isLoading ? (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {att.filename}
        </div>
      ) : (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-100 bg-red-50 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" /> {att.filename}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: GmailMessage }) {
  const sanitizedHtml = msg.bodyHtml ? DOMPurify.sanitize(msg.bodyHtml, { USE_PROFILES: { html: true } }) : null;
  const senderName = msg.from || msg.fromEmail || "?";
  const accentColor = senderHex(senderName);
  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(15,23,42,0.06)] p-6 mb-4">
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
        <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0", senderColorClass(senderName))}>
          {getInitials(senderName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-900 truncate" style={{ color: accentColor }}>{senderName}</p>
          <p className="text-xs text-slate-400 truncate">
            {msg.fromEmail !== msg.from && msg.fromEmail ? `${msg.fromEmail} · ` : ""}
            {formatDate(msg.date)}
          </p>
        </div>
      </div>
      {sanitizedHtml ? (
        <div
          className="text-[14px] text-slate-700 leading-relaxed prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      ) : (
        <div className="text-[14px] text-slate-700 leading-relaxed whitespace-pre-wrap">
          {msg.bodyText || msg.snippet}
        </div>
      )}
      {/* Attachments */}
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {msg.attachments.map((att) => (
            <AttachmentItem key={att.attachmentId} messageId={msg.id} att={att} />
          ))}
        </div>
      )}
      {msg.sentBy && (
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
          {msg.sentBy.photoUrl ? (
            <img
              src={msg.sentBy.photoUrl}
              alt={msg.sentBy.name}
              className="w-5 h-5 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className={cn("w-5 h-5 rounded-full flex items-center justify-center font-bold text-[9px] shrink-0", senderColorClass(msg.sentBy.name))}>
              {getInitials(msg.sentBy.name)}
            </div>
          )}
          <span className="text-[11px] text-slate-400">Sent by <span className="font-semibold text-slate-500">{msg.sentBy.name}</span></span>
        </div>
      )}
    </div>
  );
}

function ComposeModal({ onClose }: { onClose: () => void }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const utils = trpc.useUtils();
  const composeMutation = trpc.gmail.composeNew.useMutation({
    onSuccess: () => { toast.success("Email sent!"); utils.gmail.listThreads.invalidate(); onClose(); },
    onError: (err) => toast.error(err.message || "Failed to send email"),
  });
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-6" style={{ paddingRight: "280px" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <p className="font-bold text-sm text-slate-800">New Email</p>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-xs">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <Input placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} className="text-sm" />
          <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="text-sm" />
          <Textarea
            placeholder="Write your message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[200px] text-sm resize-none"
          />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
          <div className="flex items-center gap-3 text-slate-400">
            <button className="hover:text-slate-600"><Paperclip className="w-4 h-4" /></button>
            <button className="hover:text-slate-600"><Link2 className="w-4 h-4" /></button>
          </div>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs gap-1.5"
            disabled={composeMutation.isPending || !to || !subject || !body}
            onClick={() => composeMutation.mutate({ to, subject, bodyHtml: body.replace(/\n/g, "<br>") })}
          >
            {composeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

const GLANCE_CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
  refund_request:       { label: "Refund request",       emoji: "🔴" },
  quote_request:        { label: "Quote request",        emoji: "🟠" },
  booking_confirmation: { label: "Booking confirmation", emoji: "🟢" },
  payroll_issue:        { label: "Payroll issue",        emoji: "⚠️" },
  upset_customer:       { label: "Upset customer",       emoji: "☕" },
  revenue_opportunity:       { label: "Revenue opportunity",  emoji: "📈" },
  recurring_cancellation:    { label: "Recurring cancellation", emoji: "🚫" },
  general:                   { label: "General",              emoji: "📧" },
};

function CustomerContextPanel({
  threadFromEmail,
  threadFrom,
  threadId,
  aiCategory,
  aiSummary,
  aiUrgency,
  aiProcessedAt,
  onProcessThread,
  isProcessing,
  onResolveGlance,
}: {
  threadFromEmail: string | null;
  threadFrom?: string | null;
  threadId?: string | null;
  aiCategory?: string | null;
  aiSummary?: string | null;
  aiUrgency?: string | null;
  aiProcessedAt?: Date | null;
  onProcessThread?: () => void;
  isProcessing?: boolean;
  onResolveGlance?: () => void;
}) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validEmail = threadFromEmail && emailRegex.test(threadFromEmail) ? threadFromEmail : null;

  const contextQuery = trpc.gmail.getCustomerContext.useQuery(
    { email: validEmail! },
    { enabled: Boolean(validEmail), staleTime: 60_000, retry: false }
  );

  const { customerName, customerPhone, completedJobs: jobs, stats } = contextQuery.data ?? {};

  const stageBadgeColor: Record<string, string> = {
    BOOKED: "bg-green-100 text-green-700",
    DONE: "bg-slate-100 text-slate-600",
    NOT_INTERESTED: "bg-red-100 text-red-600",
    UNHANDLED: "bg-amber-100 text-amber-700",
    COLD: "bg-slate-100 text-slate-500",
    LOST: "bg-red-50 text-red-500",
    QUOTE_SENT: "bg-blue-50 text-blue-600",
  };

  const displayName = customerName ?? threadFrom ?? validEmail ?? "Unknown";
  const firstName = displayName.split(" ")[0];

  // Frequency color coding
  const freqColor = (freq: string | null) => {
    if (!freq) return "bg-slate-200";
    const f = freq.toLowerCase();
    if (f.includes("week")) return "bg-green-400";
    if (f.includes("bi") || f.includes("every 2")) return "bg-emerald-400";
    if (f.includes("month")) return "bg-teal-400";
    return "bg-blue-400";
  };

  const formatJobDate = (d: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    } catch { return d; }
  };

  const customerSince = stats?.firstJobDate
    ? new Date(stats.firstJobDate + "T12:00:00").getFullYear()
    : null;

  const isLongTimeCustomer = customerSince !== null && new Date().getFullYear() - customerSince >= 2;

  return (
    <aside className="w-[272px] shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {!validEmail ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
              <Mail className="w-5 h-5 text-slate-300" />
            </div>
            <p className="text-xs text-slate-400">Select a thread to see customer details</p>
          </div>
        </div>
      ) : contextQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
        </div>
      ) : (
        <div className="flex flex-col">
          {/* ── Customer header ─────────────────────────────── */}
          <div className="px-4 pt-5 pb-4 bg-gradient-to-b from-slate-50 to-white border-b border-slate-100">
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center font-black text-base shrink-0 shadow-sm",
                senderColorClass(displayName)
              )}>
                {getInitials(displayName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-black text-sm text-slate-900 leading-tight">{displayName}</p>
                  {isLongTimeCustomer && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shrink-0">⭐ LOYAL</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">{validEmail}</p>
                {customerPhone && <p className="text-[11px] text-slate-400 mt-0.5">{customerPhone}</p>}
                {customerSince && (
                  <p className="text-[10px] text-slate-400 mt-1">Customer since {customerSince}</p>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 space-y-5">

          {/* ── AI Thread Summary ────────────────────────────────── */}
          {threadId && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AI Summary</p>
                {!aiSummary && (
                  <button
                    onClick={onProcessThread}
                    disabled={isProcessing}
                    className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {isProcessing ? "Analyzing…" : "Analyze"}
                  </button>
                )}
              </div>
              {aiSummary ? (
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  {aiCategory && GLANCE_CATEGORY_LABELS[aiCategory] && (
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                        <span>{GLANCE_CATEGORY_LABELS[aiCategory].emoji}</span>
                        {GLANCE_CATEGORY_LABELS[aiCategory].label}
                      </span>
                      {aiUrgency === "high" && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">URGENT</span>
                      )}
                      {aiUrgency === "medium" && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">MEDIUM</span>
                      )}
                    </div>
                  )}
                  <ul className="space-y-1">
                    {(() => {
                      try {
                        const bullets: string[] = JSON.parse(aiSummary);
                        return bullets.map((b, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-700">
                            <span className="text-slate-300 mt-0.5 shrink-0">•</span>
                            <span>{b}</span>
                          </li>
                        ));
                      } catch {
                        return <li className="text-[11px] text-slate-500">{aiSummary}</li>;
                      }
                    })()}
                  </ul>
                  <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-100">
                    <p className="text-[9px] text-slate-300">
                      {aiProcessedAt ? new Date(aiProcessedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={onProcessThread}
                        disabled={isProcessing}
                        className="text-[9px] font-semibold text-slate-400 hover:text-blue-600 disabled:opacity-50 transition-colors"
                      >
                        {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : "↻ refresh"}
                      </button>
                      {aiCategory && aiCategory !== "general" && (
                        <button
                          onClick={onResolveGlance}
                          className="text-[9px] font-semibold text-slate-400 hover:text-green-600 transition-colors"
                        >
                          ✓ resolve
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl p-3 border border-dashed border-slate-200 text-center">
                  <Sparkles className="w-4 h-4 text-slate-300 mx-auto mb-1" />
                  <p className="text-[10px] text-slate-400">No AI summary yet</p>
                  <p className="text-[9px] text-slate-300 mt-0.5">Will auto-process in background</p>
                </div>
              )}
            </div>
          )}

          {/* ── Lifetime Value Stats ────────────────── */}
          {stats && stats.jobCount > 0 && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">Lifetime Value</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-2.5 text-center border border-green-100">
                  <p className="text-sm font-black text-green-700">
                    {stats.lifetimeValue >= 1000
                      ? `$${(stats.lifetimeValue / 1000).toFixed(1)}k`
                      : `$${stats.lifetimeValue}`}
                  </p>
                  <p className="text-[9px] text-green-600 font-semibold mt-0.5">Total Spent</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
                  <p className="text-sm font-black text-slate-700">{stats.jobCount}</p>
                  <p className="text-[9px] text-slate-400 font-semibold mt-0.5">Cleanings</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100">
                  <p className="text-sm font-black text-slate-700">${stats.avgJobPrice}</p>
                  <p className="text-[9px] text-slate-400 font-semibold mt-0.5">Avg/Visit</p>
                </div>
              </div>
              {stats.lastJobDate && (
                <p className="text-[10px] text-slate-400 mt-2 text-center">
                  Last cleaned {formatJobDate(stats.lastJobDate)}
                </p>
              )}
            </div>
          )}

          {/* ── No customer record ──────────────────────────── */}
          {(!jobs || jobs.length === 0) && (
            <div className="rounded-xl p-3 border border-dashed border-slate-200 text-center">
              <p className="text-xs text-slate-400 italic">No booking history found</p>
            </div>
          )}



          {/* ── Home Profile (from most recent job) ──────────────── */}
          {jobs && jobs.length > 0 && (jobs[0].bedrooms || jobs[0].bathrooms) && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Home Profile</p>
              <div className="flex items-center gap-2 flex-wrap">
                {jobs[0].bedrooms && (
                  <span className="text-[11px] bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1 text-slate-600 font-medium">
                    🛏 {jobs[0].bedrooms} bed{jobs[0].bedrooms !== 1 ? "s" : ""}
                  </span>
                )}
                {jobs[0].bathrooms && (
                  <span className="text-[11px] bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1 text-slate-600 font-medium">
                    🚿 {jobs[0].bathrooms} bath{jobs[0].bathrooms !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── Booking History Timeline ─────────────────────── */}
          {jobs && jobs.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">Recent Bookings</p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {jobs.map((job) => (
                  <div key={job.id} className="flex items-center gap-2.5 py-1.5 border-b border-slate-50 last:border-0">
                    <span className={cn("w-2 h-2 rounded-full shrink-0", freqColor(job.frequency ?? null))} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-[11px] font-semibold text-slate-700 truncate">
                          {job.frequency ?? "One-time"}
                        </p>
                        {job.lastBookingPrice ? (
                          <p className="text-[11px] font-bold text-slate-800 shrink-0">${job.lastBookingPrice}</p>
                        ) : null}
                      </div>
                      <p className="text-[10px] text-slate-400">{formatJobDate(job.jobDate ?? null)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Automation ──────────────────────────────────── */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Quick Actions</p>
            <div className="flex flex-col gap-1.5">
              <button
                className="text-left text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                onClick={() => toast.info("Create follow-up — coming soon")}
              >
                + Create follow-up
              </button>
              <button
                className="text-left text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                onClick={() => toast.info("Send quote link — coming soon")}
              >
                + Send quote link
              </button>
            </div>
          </div>

          </div>
        </div>
      )}
    </aside>
  );
}

export default function EmailInbox() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyMode, setReplyMode] = useState<"reply" | "note">("reply");
  const [showCompose, setShowCompose] = useState(false);
  const [activeTab, setActiveTab] = useState<"conversations" | "unread" | "leads" | "all" | "mine">("conversations");
  const [extraThreads, setExtraThreads] = useState<GmailThread[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<{
    id: string; filename: string; mimeType: string; size: number;
    url?: string; key?: string; preview?: string; uploading: boolean; error?: string;
  }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utils = trpc.useUtils();

  // ---------------------------------------------------------------------------
  // Local read-state overlay (Gmail/HubSpot pattern)
  // ---------------------------------------------------------------------------
  // `localReadSet` tracks thread IDs the user has opened in this session.
  // It is the authoritative client-side override: a thread is "effectively unread"
  // only if the server says so AND the user hasn't opened it yet.
  // This gives instant UI feedback without any cache patching or query key juggling.
  // On the next server refetch the server truth reconciles naturally.
  // ---------------------------------------------------------------------------
  const localReadSet = useRef<Set<string>>(new Set());
  // Ref so mutation callbacks can read the current filtered list without closure staleness
  const filteredThreadsRef = useRef<GmailThread[]>([]);
  const [readTick, setReadTick] = useState(0); // increment to force re-render after set mutation

  /** Mark a thread as locally read and trigger a re-render. */
  function markLocallyRead(threadId: string) {
    if (!localReadSet.current.has(threadId)) {
      localReadSet.current.add(threadId);
      setReadTick((n) => n + 1);
    }
  }

  /**
   * Derived unread truth: server flag AND not locally read.
   * Use this everywhere instead of `thread.isUnread` directly.
   */
  function effectiveIsUnread(thread: GmailThread): boolean {
    return thread.isUnread && !localReadSet.current.has(thread.id);
  }

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  const statusQuery = trpc.gmail.getConnectionStatus.useQuery(undefined, { staleTime: 60_000, retry: false });
  const meQuery = trpc.agents.me.useQuery(undefined, { staleTime: 300_000, retry: false });
  const currentAgentId = meQuery.data?.id ?? null;
  const agentsQuery = trpc.gmail.listAgentsForAssignment.useQuery(undefined, { staleTime: 120_000, retry: false, enabled: statusQuery.data?.connected === true });
  const [assignDropdownOpen, setAssignDropdownOpen] = useState<string | null>(null); // threadId of open dropdown
  const [showTemplates, setShowTemplates] = useState(false);
  // Glance panel state: which category is active as a filter
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string | null>(null);
  const [glancePanelOpen, setGlancePanelOpen] = useState(true);

  // Insert a canned template into the reply box, substituting {{first_name}} with the contact's first name
  const insertTemplate = (template: typeof CANNED_TEMPLATES[number]) => {
    const firstName = selectedThread?.from
      ? selectedThread.from.split(" ")[0]
      : "there";
    const filled = template.body.replace(/\{\{first_name\}\}/g, firstName);
    setReplyText(filled);
    setReplyMode("reply");
    setShowTemplates(false);
  };
  // Today at a Glance — pure DB read, no LLM, stale after 60s
  const glanceQuery = trpc.gmail.getGlance.useQuery(undefined, {
    enabled: statusQuery.data?.connected === true,
    staleTime: 60_000,
    retry: false,
  });
  // Per-thread AI summary for the right panel
  const threadAiQuery = trpc.gmail.getThreadAiData.useQuery(
    { threadId: selectedThreadId! },
    { enabled: Boolean(selectedThreadId) && statusQuery.data?.connected === true, staleTime: 120_000, retry: false }
  );
  const processThreadMutation = trpc.gmail.processThread.useMutation({
    onSuccess: () => { utils.gmail.getThreadAiData.invalidate({ threadId: selectedThreadId! }); utils.gmail.getGlance.invalidate(); },
    onError: (err) => toast.error(err.message || "AI analysis failed"),
  });
  const recategorizeThreadMutation = trpc.gmail.recategorizeThread.useMutation({
    onSuccess: (_data, { threadId }) => {
      threadMetaQuery.refetch();
      utils.gmail.getThreadAiData.invalidate({ threadId });
      utils.gmail.getGlance.invalidate();
      toast.success("Category updated");
    },
    onError: (err) => toast.error(err.message || "Failed to update category"),
  });

  const resolveGlanceMutation = trpc.gmail.resolveGlanceItem.useMutation({
    onSuccess: (_data, { threadId: resolvedId }) => {
      // Advance to the next thread in the current list before the glance refreshes
      const currentIndex = filteredThreadsRef.current.findIndex((t) => t.id === resolvedId);
      const nextThread = filteredThreadsRef.current[currentIndex + 1] ?? filteredThreadsRef.current[currentIndex - 1] ?? null;
      if (nextThread && nextThread.id !== resolvedId) {
        setSelectedThreadId(nextThread.id);
      }
      utils.gmail.getGlance.invalidate();
      if (resolvedId) utils.gmail.getThreadAiData.invalidate({ threadId: resolvedId });
      toast.success("Resolved — removed from glance");
    },
    onError: (err) => toast.error(err.message || "Failed to resolve"),
  });

  // Accurate unread count from Gmail label API (not limited to the current page)
  const unreadCountQuery = trpc.gmail.getUnreadCount.useQuery(undefined, {
    enabled: statusQuery.data?.connected === true,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const trueUnreadCount = unreadCountQuery.data?.count ?? 0;

  // Track the last server count we saw so we can reset localReadSet when it syncs
  const lastServerUnreadCount = useRef<number | null>(null);
  useEffect(() => {
    if (unreadCountQuery.data !== undefined) {
      // Server just gave us a fresh count — reset local optimistic adjustments
      // so we don't permanently over-subtract from the badge
      localReadSet.current = new Set();
      setReadTick((n) => n + 1);
      lastServerUnreadCount.current = unreadCountQuery.data.count;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadCountQuery.dataUpdatedAt]);

  // Effective badge count: server total minus threads opened since last server sync.
  // Resets to server truth every 30s. `readTick` forces re-render after local reads.
  const effectiveUnreadCount = Math.max(0, trueUnreadCount - (readTick >= 0 ? localReadSet.current.size : 0));

  // Build the Gmail search query by composing tab filter + user search
  const TAB_QUERIES: Record<string, string> = {
    conversations: "-from:thumbtack.com",
    unread: "-from:thumbtack.com is:unread",
    leads: "from:thumbtack.com",
    all: "",
    mine: "-from:thumbtack.com", // same base as conversations, filtered client-side by assignedToId
  };
  const tabQuery = TAB_QUERIES[activeTab] ?? "";
  const composedQuery = [tabQuery, debouncedQuery].filter(Boolean).join(" ") || undefined;

  const threadsQuery = trpc.gmail.listThreads.useQuery(
    { maxResults: 100, query: composedQuery },
    { enabled: statusQuery.data?.connected === true, staleTime: 30_000, retry: false }
  );

  async function loadMore() {
    const nextToken = threadsQuery.data?.nextPageToken;
    if (!nextToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await utils.gmail.listThreads.fetch({
        maxResults: 100,
        pageToken: nextToken,
        query: composedQuery,
      });
      setExtraThreads((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const newOnes = result.threads.filter((t) => !existingIds.has(t.id));
        return [...prev, ...newOnes];
      });
    } catch {
      toast.error("Failed to load more threads");
    } finally {
      setLoadingMore(false);
    }
  }
  const threadQuery = trpc.gmail.getThread.useQuery(
    { threadId: selectedThreadId! },
    { enabled: Boolean(selectedThreadId) && statusQuery.data?.connected === true, staleTime: 30_000, retry: false }
  );

  const markReadMutation = trpc.gmail.markRead.useMutation({
    onSuccess: (_data, { threadId }) => {
      // Server confirmed read — invalidate to reconcile, but UI already updated
      // via localReadSet (set in selectThread before this mutation fires).
      utils.gmail.listThreads.invalidate();
      utils.gmail.getThread.invalidate({ threadId });
      utils.gmail.getUnreadCount.invalidate();
    },
  });
  const markUnreadMutation = trpc.gmail.markUnread.useMutation({
    onSuccess: () => {
      utils.gmail.listThreads.invalidate();
      if (selectedThreadId) utils.gmail.getThread.invalidate({ threadId: selectedThreadId });
      // Re-fetch unread count since we just marked something unread
      utils.gmail.getUnreadCount.invalidate();
    },
  });
  const archiveMutation = trpc.gmail.archiveThread.useMutation({
    onSuccess: () => { toast.success("Thread archived"); setSelectedThreadId(null); utils.gmail.listThreads.invalidate(); },
    onError: (err) => toast.error(err.message || "Failed to archive"),
  });
  const replyMutation = trpc.gmail.sendReply.useMutation({
    onSuccess: () => {
      toast.success("Reply sent!");
      setReplyText("");
      setPendingAttachments([]);
      if (selectedThreadId) { utils.gmail.getThread.invalidate({ threadId: selectedThreadId }); utils.gmail.listThreads.invalidate(); }
    },
    onError: (err) => toast.error(err.message || "Failed to send reply"),
  });
  const draftMutation = trpc.gmail.draftReply.useMutation({
    onSuccess: ({ draft }) => {
      setReplyText(draft);
      setReplyMode("reply");
      toast.success("AI draft ready — review and send!");
    },
    onError: (err) => toast.error(err.message || "AI draft failed"),
  });
  const uploadAttachmentMutation = trpc.gmail.uploadAttachment.useMutation();

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files);
    for (const file of newFiles) {
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`${file.name} exceeds the 25 MB limit.`);
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // Generate preview URL for images
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setPendingAttachments((prev) => [
        ...prev,
        { id, filename: file.name, mimeType: file.type, size: file.size, preview, uploading: true },
      ]);
      // Read file as base64 and upload
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = (reader.result as string).split(",")[1];
          const result = await uploadAttachmentMutation.mutateAsync({
            filename: file.name,
            mimeType: file.type,
            base64Data,
          });
          setPendingAttachments((prev) =>
            prev.map((a) => a.id === id
              ? { ...a, url: result.url, key: result.key, uploading: false }
              : a
            )
          );
        } catch (err: any) {
          setPendingAttachments((prev) =>
            prev.map((a) => a.id === id
              ? { ...a, uploading: false, error: err.message || "Upload failed" }
              : a
            )
          );
          toast.error(`Failed to upload ${file.name}`);
        }
      };
      reader.readAsDataURL(file);
    }
  }

  function removeAttachment(id: string) {
    setPendingAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.preview) URL.revokeObjectURL(att.preview);
      return prev.filter((a) => a.id !== id);
    });
  }

  function generateDraft() {
    if (!selectedThreadId || !threadQuery.data) return;
    const thread = threadQuery.data;
    draftMutation.mutate({
      threadId: selectedThreadId,
      customerEmail: thread.fromEmail || undefined,
      messages: thread.messages.map((m) => ({
        from: m.from,
        bodyText: m.bodyText || m.snippet || "",
        date: m.date,
        isOutbound: m.fromEmail?.toLowerCase().includes("maidinblack") ?? false,
      })),
    });
  }

  useOpsStream(
    {
      onGmailNewMessages: useCallback(() => {
        utils.gmail.listThreads.invalidate();
        if (selectedThreadId) utils.gmail.getThread.invalidate({ threadId: selectedThreadId });
        // New messages may be unread — refresh the badge count
        utils.gmail.getUnreadCount.invalidate();
        // Refresh glance counts (worker will have re-processed affected threads)
        utils.gmail.getGlance.invalidate();
        if (selectedThreadId) utils.gmail.getThreadAiData.invalidate({ threadId: selectedThreadId });
      }, [utils, selectedThreadId]),
    },
    { enabled: statusQuery.data?.connected === true }
  );

  function selectThread(threadId: string) {
    setSelectedThreadId(threadId);
    setReplyText("");
    setReplyMode("reply");
    const thread = threadsQuery.data?.threads.find((t) => t.id === threadId);
    if (effectiveIsUnread(thread ?? { isUnread: false } as any)) {
      // Mark locally read immediately — UI updates before API responds
      markLocallyRead(threadId);
      markReadMutation.mutate({ threadId });
    }
  }

  function sendReply() {
    if (!selectedThreadId || !replyText.trim()) return;
    const thread = threadQuery.data;
    if (!thread) return;
    // Block send if any attachment is still uploading
    const stillUploading = pendingAttachments.some((a) => a.uploading);
    if (stillUploading) { toast.warning("Please wait for attachments to finish uploading."); return; }
    const lastMsg = thread.messages[thread.messages.length - 1];
    const readyAttachments = pendingAttachments
      .filter((a) => a.url && !a.error)
      .map((a) => ({ url: a.url!, filename: a.filename, mimeType: a.mimeType }));
    // Find the correct 'to' address: the last message from someone other than the inbox.
    // This ensures we always reply to the customer, not ourselves.
    const inboxEmail = thread.inboxEmail?.toLowerCase();
    const otherPartyMsg = inboxEmail
      ? [...thread.messages].reverse().find((m) => m.fromEmail.toLowerCase() !== inboxEmail)
      : null;
    const toEmail = otherPartyMsg?.fromEmail ?? thread.fromEmail;
    replyMutation.mutate({
      threadId: selectedThreadId,
      to: toEmail,
      subject: thread.subject,
      bodyHtml: replyText.replace(/\n/g, "<br>"),
      inReplyToMessageId: lastMsg?.id,
      attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
    });
  }

  const baseThreads = threadsQuery.data?.threads ?? [];
  const allThreads = [
    ...baseThreads,
    ...extraThreads.filter((t) => !baseThreads.some((b) => b.id === t.id)),
  ].sort((a, b) => b.date - a.date);

  // Fetch thread meta (issue flags) for all visible threads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allThreadIds = useMemo(() => allThreads.map((t) => t.id), [allThreads.map((t) => t.id).join(",")]);
  const threadMetaQuery = trpc.gmail.listThreadMeta.useQuery(
    { threadIds: allThreadIds },
    { enabled: allThreadIds.length > 0 && statusQuery.data?.connected === true, staleTime: 30_000 }
  );
  const metaMap = new Map(
    (threadMetaQuery.data?.meta ?? []).map((m) => [m.threadId, m])
  );

  // Assign thread mutation
  const assignThreadMutation = trpc.gmail.assignThread.useMutation({
    onSuccess: (data) => {
      threadMetaQuery.refetch();
      toast.success(`Assigned to ${data.assignedToName}`);
      setAssignDropdownOpen(null);
    },
    onError: (err) => toast.error(err.message || "Failed to assign thread"),
  });
  const unassignThreadMutation = trpc.gmail.unassignThread.useMutation({
    onSuccess: () => {
      threadMetaQuery.refetch();
      toast.success("Assignment removed");
      setAssignDropdownOpen(null);
    },
    onError: (err) => toast.error(err.message || "Failed to unassign thread"),
  });

  // Flag issue mutation
  const flagIssueMutation = trpc.gmail.flagIssue.useMutation({
    onSuccess: (data, vars) => {
      threadMetaQuery.refetch();
      toast.success(vars.flag ? `Flagged as issue${data.issueSummary ? " — AI summary added" : ""}` : "Issue flag removed");
    },
    onError: (err) => toast.error(err.message || "Failed to update issue flag"),
  });

  function toggleIssue() {
    if (!selectedThreadId || !threadQuery.data) return;
    const currentMeta = metaMap.get(selectedThreadId);
    const isCurrentlyIssue = (currentMeta?.isIssue ?? 0) === 1;
    const thread = threadQuery.data;
    flagIssueMutation.mutate({
      threadId: selectedThreadId,
      flag: !isCurrentlyIssue,
      subject: thread.subject,
      messages: thread.messages.map((m) => ({
        from: m.from,
        bodyText: m.bodyText || m.snippet || "",
        date: m.date,
        isOutbound: m.fromEmail?.toLowerCase().includes("maidinblack") ?? false,
      })),
    });
  }

  // Sort: issues first, then by date
  const sortedThreads = [...allThreads].sort((a, b) => {
    const aIssue = (metaMap.get(a.id)?.isIssue ?? 0) === 1 ? 1 : 0;
    const bIssue = (metaMap.get(b.id)?.isIssue ?? 0) === 1 ? 1 : 0;
    if (bIssue !== aIssue) return bIssue - aIssue;
    return b.date - a.date;
  });
  // Mine tab: client-side filter by assignedToId matching current agent
  // Also apply glance category filter if one is active
  // Keep ref in sync so mutation callbacks can read the latest list
  const threads = (() => {
    let base = activeTab === "mine"
      ? sortedThreads.filter((t) => {
          const meta = metaMap.get(t.id);
          return meta?.assignedToId !== null && meta?.assignedToId !== undefined && meta.assignedToId === currentAgentId;
        })
      : sortedThreads;
    if (activeCategoryFilter) {
      const cat = glanceQuery.data?.categories.find((c) => c.category === activeCategoryFilter);
      const catThreadIds = new Set(cat?.threadIds ?? []);
      base = base.filter((t) => catThreadIds.has(t.id));
    }
    return base;
  })();
  filteredThreadsRef.current = threads;
  const selectedThread = threadQuery.data ?? null;

  // Reconcile localReadSet after every server refetch:
  // once the server confirms a thread is no longer unread, remove it from the
  // local set so it no longer inflates the optimistic decrement.
  useEffect(() => {
    let changed = false;
    for (const t of allThreads) {
      if (!t.isUnread && localReadSet.current.has(t.id)) {
        localReadSet.current.delete(t.id);
        changed = true;
      }
    }
    if (changed) setReadTick((n) => n + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allThreads]);
  const mineCount = sortedThreads.filter((t) => {
    const meta = metaMap.get(t.id);
    return meta?.assignedToId !== null && meta?.assignedToId !== undefined && meta.assignedToId === currentAgentId;
  }).length;

  // Auto-select the first thread when tab or category filter changes.
  // Uses setSelectedThreadId directly — NOT selectThread — so it does NOT call markRead.
  // The thread is displayed but stays unread until the user explicitly clicks it.
  const lastAutoSelectedKey = useRef<string | null>(null);
  useEffect(() => {
    if (threads.length === 0) return;       // nothing loaded yet
    const key = `${activeTab}::${activeCategoryFilter ?? ""}`;
    if (lastAutoSelectedKey.current === key) return; // already auto-selected for this tab+filter combo
    lastAutoSelectedKey.current = key;
    setSelectedThreadId(threads[0].id);
  }, [threads, activeTab, activeCategoryFilter]);

  return (
    <div className="h-screen flex overflow-hidden bg-[#f5f5f3] font-sans">
      {/* Thread sidebar */}
      <aside className="w-[280px] bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight">Maids Inbox</h1>
              <p className="text-[11px] text-slate-400">Shared Gmail inbox</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { utils.gmail.listThreads.invalidate(); utils.gmail.getConnectionStatus.invalidate(); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors"
                title="Refresh"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", threadsQuery.isFetching && "animate-spin")} />
              </button>
              <button
                onClick={() => setShowCompose(true)}
                className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center hover:bg-slate-800 transition-colors"
                title="Compose"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {/* Search */}
          <div className="relative mb-2.5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              placeholder="Search inbox…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 bg-slate-50 border-slate-200 rounded-lg text-xs h-8"
            />
          </div>
          {/* Tab filter — Row 1: primary tabs */}
          <div className="flex items-center gap-0.5">
            {([
              { key: "conversations" as const, label: "Inbox", badge: undefined as number | undefined },
              { key: "unread" as const, label: "Unread", badge: effectiveUnreadCount as number | undefined },
              { key: "leads" as const, label: "Leads", badge: undefined as number | undefined },
            ]).map(({ key, label, badge }) => (
              <button
                key={key}
                onClick={() => {
                  if (activeTab === key) return;
                  setActiveTab(key);
                  setExtraThreads([]);
                  setSelectedThreadId(null);
                }}
                className={cn(
                  "relative flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-md transition-all duration-150",
                  activeTab === key
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                )}
              >
                {label}
                {badge != null && badge > 0 && (
                  <span className={cn(
                    "inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold leading-none",
                    activeTab === key
                      ? "bg-white/20 text-white"
                      : "bg-blue-100 text-blue-700"
                  )}>
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>
          {/* Tab filter — Row 2: sub-filters */}
          <div className="flex items-center gap-0.5 mt-0.5">
            {([
              { key: "all" as const, label: "All", badge: undefined as number | undefined },
              { key: "mine" as const, label: "Mine", badge: mineCount as number | undefined },
            ]).map(({ key, label, badge }) => (
              <button
                key={key}
                onClick={() => {
                  if (activeTab === key) return;
                  setActiveTab(key);
                  setExtraThreads([]);
                  setSelectedThreadId(null);
                }}
                className={cn(
                  "flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-md transition-all duration-150",
                  activeTab === key
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                )}
              >
                {label}
                {badge != null && badge > 0 && (
                  <span className={cn(
                    "inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded-full text-[8px] font-bold leading-none",
                    activeTab === key
                      ? "bg-white/20 text-white"
                      : "bg-violet-100 text-violet-700"
                  )}>
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Today at a Glance panel — only on Inbox/Unread/All/Mine tabs, not Leads */}
        {activeTab !== "leads" && glanceQuery.data && glanceQuery.data.categories.length > 0 && (
          <div className="border-b border-slate-100">
            {/* Glance header */}
            <button
              onClick={() => setGlancePanelOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors"
            >
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Today at a Glance</span>
              <ChevronRight className={cn("w-3 h-3 text-slate-300 transition-transform", glancePanelOpen && "rotate-90")} />
            </button>
            {glancePanelOpen && (
              <div className="px-3 pb-3 space-y-1">
                {/* Clear filter row */}
                {activeCategoryFilter && (
                  <button
                    onClick={() => setActiveCategoryFilter(null)}
                    className="w-full flex items-center gap-1.5 text-[10px] font-semibold text-blue-600 hover:text-blue-700 px-2 py-1 rounded-md hover:bg-blue-50 transition-colors"
                  >
                    <X className="w-3 h-3" /> Clear filter
                  </button>
                )}
                {glanceQuery.data.categories.map((cat) => {
                  return (
                  <div
                    key={cat.category}
                    className={cn(
                      "group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150",
                      activeCategoryFilter === cat.category
                        ? "bg-slate-900 text-white"
                        : "hover:bg-slate-50"
                    )}
                    onClick={() => {
                      const newFilter = activeCategoryFilter === cat.category ? null : cat.category;
                      setActiveCategoryFilter(newFilter);
                      // Always reset selection and force auto-select to re-fire for the new filter
                      setSelectedThreadId(null);
                      lastAutoSelectedKey.current = null;
                      // Inject the category's full thread objects into extraThreads
                      // so they appear in the list even if not yet loaded via pagination
                      if (newFilter) {
                        const categoryData = glanceQuery.data?.categories.find((c) => c.category === newFilter);
                        if (categoryData?.threads?.length) {
                          setExtraThreads(categoryData.threads as any[]);
                        }
                      } else {
                        setExtraThreads([]);
                      }
                      // Switch to conversations tab so filter applies
                      if (activeTab === "unread" || activeTab === "all" || activeTab === "mine") {
                        setActiveTab("conversations");
                      }
                    }}
                  >
                    <span className="text-base leading-none shrink-0">{cat.emoji}</span>
                    <span className={cn(
                      "flex-1 text-[11px] font-semibold truncate",
                      activeCategoryFilter === cat.category ? "text-white" : "text-slate-700"
                    )}>
                      {cat.label}
                    </span>
                    <span className={cn(
                      "text-[11px] font-black shrink-0",
                      activeCategoryFilter === cat.category ? "text-white" : cat.urgentCount > 0 ? "text-red-500" : "text-slate-400"
                    )}>
                      {cat.count}
                    </span>
                    {/* Resolve button — only shown on hover */}
                    <button
                      className={cn(
                        "shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded",
                        activeCategoryFilter === cat.category ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-green-600"
                      )}
                      title="Mark all resolved"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Resolve all threads in this category
                        cat.threadIds.forEach((tid) => resolveGlanceMutation.mutate({ threadId: tid }));
                        if (activeCategoryFilter === cat.category) setActiveCategoryFilter(null);
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {statusQuery.isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
            </div>
          )}
          {statusQuery.data?.connected === false && (
            <div className="px-4 py-6 text-center">
              <AlertCircle className="w-7 h-7 text-amber-400 mx-auto mb-2" />
              <p className="text-xs text-slate-500">Gmail not connected</p>
            </div>
          )}
          {threadsQuery.isLoading && statusQuery.data?.connected && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
            </div>
          )}
          {threadsQuery.isError && (
            <div className="px-4 py-6 text-center">
              <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
              <p className="text-xs text-red-500">{threadsQuery.error.message}</p>
            </div>
          )}
          {threads
            // On the Unread tab, hide threads the user has already opened this session
            // (effectiveIsUnread = false). On all other tabs, show everything.
            .filter((t) => activeTab === "unread" ? effectiveIsUnread(t) : true)
            .map((t) => {
            const meta = metaMap.get(t.id);
            // Pass effective unread state so the UNREAD pill and bold text also clear instantly
            const threadWithEffectiveUnread: GmailThread = effectiveIsUnread(t)
              ? t
              : { ...t, isUnread: false };
            return (
              <ThreadItem
                key={t.id}
                thread={threadWithEffectiveUnread}
                active={t.id === selectedThreadId}
                onClick={() => selectThread(t.id)}
                isIssue={(meta?.isIssue ?? 0) === 1}
                issueSummary={meta?.issueSummary ?? null}
                assignedToName={meta?.assignedToName ?? null}
                assignedToPhotoUrl={meta?.assignedToPhotoUrl ?? null}
                aiCategory={meta?.aiCategory ?? null}
              />
            );
          })}
          {threads.length === 0 && !threadsQuery.isLoading && statusQuery.data?.connected && (
            <div className="text-center py-12 px-4">
              {activeCategoryFilter ? (
                <>
                  <span className="text-2xl block mb-2">
                    {glanceQuery.data?.categories.find((c) => c.category === activeCategoryFilter)?.emoji ?? "📭"}
                  </span>
                  <p className="text-xs font-semibold text-slate-500 mb-1">
                    {glanceQuery.data?.categories.find((c) => c.category === activeCategoryFilter)?.label ?? "Category"}
                  </p>
                  <p className="text-xs text-slate-400">No threads in this category right now</p>
                  <button
                    onClick={() => { setActiveCategoryFilter(null); lastAutoSelectedKey.current = null; }}
                    className="mt-3 text-[10px] font-semibold text-blue-500 hover:text-blue-700"
                  >
                    ← Back to inbox
                  </button>
                </>
              ) : (
                <p className="text-xs text-slate-400">
                  {debouncedQuery ? "No results" : activeTab === "leads" ? "No new leads" : activeTab === "conversations" ? "No conversations" : activeTab === "unread" ? "No unread messages" : activeTab === "mine" ? "No threads assigned to you" : "Inbox is empty"}
                </p>
              )}
            </div>
          )}
          {threadsQuery.data?.nextPageToken && (
            <div className="px-4 py-3 border-t border-slate-100">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full text-xs font-semibold text-slate-500 hover:text-slate-700 py-2 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Email viewer */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {statusQuery.data?.connected === false && <NotConnectedBanner />}
        {statusQuery.data?.connected && !selectedThreadId && (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <Mail className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm text-slate-400">Select a thread to read</p>
            </div>
          </div>
        )}
        {selectedThreadId && statusQuery.data?.connected && (
          <>
            {/* Thread header */}
            <div className="h-[60px] bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
              <h2 className="text-base font-bold text-slate-900 truncate mr-4">
                {selectedThread?.subject ?? "Loading…"}
              </h2>
              <div className="flex items-center gap-1.5 shrink-0">
                {(() => {
                  const isCurrentIssue = (metaMap.get(selectedThreadId)?.isIssue ?? 0) === 1;
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "text-xs font-semibold gap-1.5 h-8 transition-colors",
                        isCurrentIssue
                          ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
                          : "hover:border-red-200 hover:text-red-500"
                      )}
                      onClick={toggleIssue}
                      disabled={flagIssueMutation.isPending}
                      title={isCurrentIssue ? "Remove issue flag" : "Flag as issue"}
                    >
                      {flagIssueMutation.isPending
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Flag className={cn("w-3.5 h-3.5", isCurrentIssue && "fill-red-500")} />}
                      {isCurrentIssue ? "Issue" : "Flag"}
                    </Button>
                  );
                })()}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs font-semibold gap-1.5 h-8"
                  onClick={() => {
                    if (selectedThread?.isUnread) markReadMutation.mutate({ threadId: selectedThreadId });
                    else markUnreadMutation.mutate({ threadId: selectedThreadId });
                  }}
                  disabled={markReadMutation.isPending || markUnreadMutation.isPending}
                >
                  {selectedThread?.isUnread
                    ? <><MailCheck className="w-3.5 h-3.5" /> Mark read</>
                    : <><MailOpen className="w-3.5 h-3.5" /> Mark unread</>}
                </Button>
                {/* Resolve from glance — only shown when thread has an AI category */}
                {threadAiQuery.data?.aiCategory && threadAiQuery.data.aiCategory !== "general" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "text-xs font-semibold gap-1.5 h-8 transition-colors",
                      "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                    )}
                    onClick={() => {
                      if (!selectedThreadId) return;
                      resolveGlanceMutation.mutate({ threadId: selectedThreadId });
                      // Also mark as read if currently unread
                      if (effectiveIsUnread(selectedThread ?? { isUnread: false } as any)) {
                        markLocallyRead(selectedThreadId);
                        markReadMutation.mutate({ threadId: selectedThreadId });
                      }
                    }}
                    disabled={resolveGlanceMutation.isPending}
                    title="Resolve and mark as read"
                  >
                    {resolveGlanceMutation.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Resolve
                  </Button>
                )}
                {/* Categorize dropdown */}
                {selectedThreadId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "text-xs font-semibold gap-1.5 h-8 transition-colors",
                          threadAiQuery.data?.aiCategory && threadAiQuery.data.aiCategory !== "general"
                            ? "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                            : "hover:border-slate-300 text-slate-500"
                        )}
                        disabled={recategorizeThreadMutation.isPending}
                        title="Set or change AI category"
                      >
                        {threadAiQuery.data?.aiCategory && GLANCE_CATEGORY_LABELS[threadAiQuery.data.aiCategory]
                          ? <><span>{GLANCE_CATEGORY_LABELS[threadAiQuery.data.aiCategory].emoji}</span> {GLANCE_CATEGORY_LABELS[threadAiQuery.data.aiCategory].label}</>
                          : <>Categorize</>}
                        <ChevronDown className="w-3 h-3 opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[200px]">
                      <div className="px-3 py-2 border-b border-slate-100">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Set category</p>
                      </div>
                      {Object.entries(GLANCE_CATEGORY_LABELS)
                        .filter(([key]) => key !== "general")
                        .map(([key, meta]) => (
                          <DropdownMenuItem
                            key={key}
                            className={cn(
                              "text-xs gap-2 cursor-pointer",
                              threadAiQuery.data?.aiCategory === key && "bg-slate-50 font-semibold"
                            )}
                            onClick={() => recategorizeThreadMutation.mutate({
                              threadId: selectedThreadId,
                              category: key as any,
                            })}
                          >
                            <span>{meta.emoji}</span>
                            {meta.label}
                            {threadAiQuery.data?.aiCategory === key && (
                              <span className="ml-auto text-[9px] text-slate-400">current</span>
                            )}
                          </DropdownMenuItem>
                        ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-xs gap-2 cursor-pointer text-slate-400"
                        onClick={() => recategorizeThreadMutation.mutate({
                          threadId: selectedThreadId,
                          category: "general",
                        })}
                      >
                        <span>📧</span>
                        General (remove from glance)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* Assign button with dropdown */}
                <div className="relative">
                  {(() => {
                    const currentMeta = metaMap.get(selectedThreadId);
                    const isAssigned = currentMeta?.assignedToId !== null && currentMeta?.assignedToId !== undefined;
                    const isOpen = assignDropdownOpen === selectedThreadId;
                    return (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            "text-xs font-semibold gap-1.5 h-8 transition-colors",
                            isAssigned
                              ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
                              : "hover:border-violet-200 hover:text-violet-600"
                          )}
                          onClick={() => setAssignDropdownOpen(isOpen ? null : selectedThreadId)}
                        >
                          {isAssigned && currentMeta?.assignedToPhotoUrl ? (
                            <img src={currentMeta.assignedToPhotoUrl} alt={currentMeta.assignedToName ?? ""} className="w-3.5 h-3.5 rounded-full object-cover" />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5" />
                          )}
                          {isAssigned ? (currentMeta?.assignedToName?.split(" ")[0] ?? "Assigned") : "Assign"}
                          <ChevronDown className="w-3 h-3 opacity-60" />
                        </Button>
                        {isOpen && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setAssignDropdownOpen(null)} />
                            <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 min-w-[160px] overflow-hidden">
                              <div className="px-3 py-2 border-b border-slate-100">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Assign to</p>
                              </div>
                              {/* Assign to me shortcut */}
                              {currentAgentId && (
                                <button
                                  className="w-full text-left px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50 flex items-center gap-2 transition-colors"
                                  onClick={() => assignThreadMutation.mutate({ threadId: selectedThreadId, agentId: currentAgentId })}
                                  disabled={assignThreadMutation.isPending}
                                >
                                  <UserCheck className="w-3.5 h-3.5" />
                                  Assign to me
                                </button>
                              )}
                              {/* Agent list */}
                              {(agentsQuery.data?.agents ?? []).map((agent) => (
                                <button
                                  key={agent.id}
                                  className={cn(
                                    "w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2 transition-colors",
                                    currentMeta?.assignedToId === agent.id ? "bg-violet-50 text-violet-700 font-semibold" : "text-slate-700"
                                  )}
                                  onClick={() => assignThreadMutation.mutate({ threadId: selectedThreadId, agentId: agent.id })}
                                  disabled={assignThreadMutation.isPending}
                                >
                                  {agent.profilePhotoUrl ? (
                                    <img src={agent.profilePhotoUrl} alt={agent.name} className="w-5 h-5 rounded-full object-cover shrink-0" />
                                  ) : (
                                    <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[9px] font-black text-slate-600 shrink-0">
                                      {agent.name[0]?.toUpperCase()}
                                    </span>
                                  )}
                                  {agent.name}
                                  {currentMeta?.assignedToId === agent.id && <span className="ml-auto text-violet-500">✓</span>}
                                </button>
                              ))}
                              {/* Unassign option */}
                              {isAssigned && (
                                <>
                                  <div className="border-t border-slate-100" />
                                  <button
                                    className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:bg-slate-50 hover:text-red-500 transition-colors"
                                    onClick={() => unassignThreadMutation.mutate({ threadId: selectedThreadId })}
                                    disabled={unassignThreadMutation.isPending}
                                  >
                                    Remove assignment
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs font-semibold gap-1.5 h-8"
                  onClick={() => archiveMutation.mutate({ threadId: selectedThreadId })}
                  disabled={archiveMutation.isPending}
                >
                  {archiveMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Archive className="w-3.5 h-3.5" />}
                  Archive
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-[6%] py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="w-full">
                {threadQuery.isLoading && (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
                  </div>
                )}
                {threadQuery.isError && (
                  <div className="text-center py-12">
                    <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                    <p className="text-sm text-red-500">{threadQuery.error.message}</p>
                  </div>
                )}
                {selectedThread?.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}

                {/* Reply box */}
                {selectedThread && (
                  <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(15,23,42,0.06)] overflow-hidden mb-4">
                    <div className="flex border-b border-slate-100">
                      {(["reply", "note"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setReplyMode(mode)}
                          className={cn(
                            "px-5 py-3 text-sm font-semibold capitalize transition-colors border-b-2",
                            replyMode === mode
                              ? "text-blue-600 border-blue-600"
                              : "text-slate-400 border-transparent hover:text-slate-600"
                          )}
                        >
                          {mode === "note" ? "Internal note" : "Reply"}
                        </button>
                      ))}
                    </div>
                    {/* Attachment chips — shown when files are queued */}
                    {pendingAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
                        {pendingAttachments.map((att) => (
                          <div
                            key={att.id}
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg border text-xs font-medium pr-1.5 pl-2 py-1 max-w-[180px]",
                              att.error
                                ? "border-red-200 bg-red-50 text-red-600"
                                : att.uploading
                                ? "border-slate-200 bg-slate-50 text-slate-500"
                                : "border-blue-200 bg-blue-50 text-blue-700"
                            )}
                          >
                            {att.preview ? (
                              <img src={att.preview} alt={att.filename} className="w-5 h-5 rounded object-cover shrink-0" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span className="truncate max-w-[100px]">{att.filename}</span>
                            {att.uploading && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
                            {!att.uploading && (
                              <button
                                onClick={() => removeAttachment(att.id)}
                                className="ml-0.5 rounded hover:bg-blue-100 p-0.5 shrink-0"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      className="border-0 rounded-none resize-none min-h-[140px] text-[14px] leading-relaxed text-slate-700 focus-visible:ring-0 p-5"
                      placeholder={replyMode === "note" ? "Add an internal note…" : "Write a reply…"}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          if (replyMode === "reply") sendReply();
                        }
                      }}
                    />
                    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                      <div className="flex items-center gap-3">
                        {/* Hidden file input */}
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
                          className="hidden"
                          onChange={(e) => handleFileSelect(e.target.files)}
                          onClick={(e) => { (e.target as HTMLInputElement).value = ""; }}
                        />
                        <button
                          className="text-slate-400 hover:text-slate-600"
                          title="Attach files"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip className="w-4 h-4" />
                        </button>
                        <button className="text-slate-400 hover:text-slate-600"><Link2 className="w-4 h-4" /></button>
                        {replyMode === "reply" && (
                          <button
                            onClick={generateDraft}
                            disabled={draftMutation.isPending || !threadQuery.data}
                            className={cn(
                              "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors",
                              draftMutation.isPending
                                ? "text-violet-400 bg-violet-50 cursor-not-allowed"
                                : "text-violet-600 bg-violet-50 hover:bg-violet-100"
                            )}
                          >
                            {draftMutation.isPending
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Sparkles className="w-3.5 h-3.5" />}
                            {draftMutation.isPending ? "Drafting…" : "AI Draft"}
                          </button>
                        )}
                        {/* Template picker */}
                        <div className="relative">
                          <button
                            onClick={() => setShowTemplates((v) => !v)}
                            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                            title="Insert canned reply"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            Templates
                          </button>
                          {showTemplates && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setShowTemplates(false)} />
                              <div className="absolute bottom-full mb-2 left-0 bg-white border border-slate-200 rounded-xl shadow-xl z-20 w-72 overflow-hidden">
                                <div className="px-3 py-2 border-b border-slate-100">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Saved Replies</p>
                                </div>
                                <div className="max-h-72 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                  {CANNED_TEMPLATES.map((tpl) => (
                                    <button
                                      key={tpl.id}
                                      className="w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                                      onClick={() => insertTemplate(tpl)}
                                    >
                                      <p className="text-xs font-semibold text-slate-800">{tpl.label}</p>
                                      {tpl.subject && (
                                        <p className="text-[10px] text-slate-400 mt-0.5 truncate">Subject: {tpl.subject}</p>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      {replyMode === "reply" ? (
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs gap-1.5"
                          disabled={replyMutation.isPending || !replyText.trim()}
                          onClick={sendReply}
                        >
                          {replyMutation.isPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Send className="w-3.5 h-3.5" />}
                          Send ⌘+Enter
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="font-bold text-xs gap-1.5"
                          disabled={!replyText.trim()}
                          onClick={() => { toast.info("Internal notes are not yet saved to a backend."); setReplyText(""); }}
                        >
                          Save note
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Customer context panel */}
      <CustomerContextPanel
        threadFromEmail={selectedThread?.fromEmail ?? null}
        threadFrom={selectedThread?.from ?? null}
        threadId={selectedThreadId}
        aiCategory={threadAiQuery.data?.aiCategory ?? null}
        aiSummary={threadAiQuery.data?.aiSummary ?? null}
        aiUrgency={threadAiQuery.data?.aiUrgency ?? null}
        aiProcessedAt={threadAiQuery.data?.aiProcessedAt ?? null}
        onProcessThread={() => selectedThreadId && processThreadMutation.mutate({ threadId: selectedThreadId })}
        isProcessing={processThreadMutation.isPending}
        onResolveGlance={() => selectedThreadId && resolveGlanceMutation.mutate({ threadId: selectedThreadId })}
      />

      {showCompose && <ComposeModal onClose={() => setShowCompose(false)} />}
    </div>
  );
}

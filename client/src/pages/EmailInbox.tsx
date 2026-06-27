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
  UserCheck, ChevronDown, CheckCircle2, ChevronRight, ShieldOff, ShieldCheck, Settings,
  MoreHorizontal, UserPlus, Mic, Wand2,
} from "lucide-react";
import { useOpsStream } from "@/hooks/useOpsStream";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Framer Motion shared transition presets
// ---------------------------------------------------------------------------
const PANEL_TRANSITION = { duration: 0.13, ease: [0.22, 1, 0.36, 1] } as const;
const SPRING_TRANSITION = { type: "spring" as const, stiffness: 380, damping: 32 };
const SUMMARY_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

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

// Per-category color palette for badges
const CATEGORY_BADGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  refund_request:        { bg: "bg-red-50",     text: "text-red-600",    border: "border-red-200" },
  quote_request:         { bg: "bg-orange-50",  text: "text-orange-600", border: "border-orange-200" },
  booking_confirmation:  { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  payroll_issue:         { bg: "bg-yellow-50",  text: "text-yellow-700", border: "border-yellow-200" },
  upset_customer:        { bg: "bg-rose-50",    text: "text-rose-600",   border: "border-rose-200" },
  revenue_opportunity:   { bg: "bg-blue-50",    text: "text-blue-700",   border: "border-blue-200" },
  recurring_cancellation:{ bg: "bg-slate-100",  text: "text-slate-600",  border: "border-slate-200" },
  general:               { bg: "bg-slate-100",  text: "text-slate-500",  border: "border-slate-200" },
};

function ThreadItem({ thread, active, onClick, isIssue, issueSummary, assignedToName, assignedToPhotoUrl, aiCategory }: { thread: GmailThread; active: boolean; onClick: () => void; isIssue?: boolean; issueSummary?: string | null; assignedToName?: string | null; assignedToPhotoUrl?: string | null; aiCategory?: string | null }) {
  const senderName = thread.from || thread.fromEmail || "?";
  const accentColor = isIssue ? "#dc2626" : senderHex(senderName);
  const catStyle = aiCategory ? (CATEGORY_BADGE_STYLES[aiCategory] ?? CATEGORY_BADGE_STYLES.general) : null;
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      className={cn(
        "w-full text-left px-4 py-[18px] border-b transition-colors duration-150 group relative",
        isIssue ? "border-red-100" : "border-[#e8edf5]",
        active
          ? isIssue
            ? "bg-red-50/80"
            : "bg-[#eff6ff]"
          : isIssue
          ? "bg-red-50/40 hover:bg-red-50/70"
          : "bg-white hover:bg-slate-50"
      )}
    >
      {/* Left accent bar — Framer Motion layout animation for smooth slide-in */}
      <AnimatePresence initial={false}>
        {active && (
          <motion.span
            layoutId="thread-accent-bar"
            className={cn(
              "absolute left-0 top-4 bottom-4 w-[4px] rounded-r-full",
              isIssue ? "bg-red-500" : "bg-blue-500"
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING_TRANSITION}
          />
        )}
      </AnimatePresence>
      {/* Invisible placeholder to keep layout stable when bar is absent */}
      {!active && <span className="absolute left-0 top-4 bottom-4 w-[4px]" />}

      <div className="flex items-start gap-3 pl-1">
        {/* Sender avatar — 40px */}
        <div className="relative shrink-0">
          <div
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0",
              isIssue ? "bg-red-100 text-red-700" : senderColorClass(senderName)
            )}
            style={isIssue ? {} : {
              background: `linear-gradient(135deg, ${accentColor}22 0%, ${accentColor}44 100%)`,
              color: accentColor,
            }}
          >
            {isIssue ? <Flag className="w-4 h-4" /> : getInitials(senderName)}
          </div>
          {/* Unread dot on avatar */}
          {thread.isUnread && !isIssue && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Row 1: sender + time */}
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span
              className={cn(
                "text-[14px] leading-snug truncate",
                thread.isUnread ? "font-[900] text-[#0f172a]" : "font-[700] text-slate-700"
              )}
            >
              {senderName}
            </span>
            <span className="text-[11px] text-slate-400 shrink-0 font-semibold">{formatDate(thread.date)}</span>
          </div>

          {/* Row 2: subject */}
          <p className={cn(
            "text-[13px] leading-snug truncate mb-1",
            thread.isUnread ? "text-slate-800 font-[700]" : "text-slate-500 font-normal"
          )}>
            {thread.subject}
          </p>

          {/* Row 3: snippet or issue summary */}
          {isIssue && issueSummary ? (
            <p className="text-[12px] text-red-500 line-clamp-1 leading-relaxed font-medium mb-2">
              {issueSummary}
            </p>
          ) : (
            <p className="text-[12px] text-slate-400 line-clamp-1 leading-relaxed mb-2">
              {thread.snippet?.slice(0, 90)}
            </p>
          )}

          {/* Row 4: badges row + hover quick actions */}
          <div className="flex items-center justify-between gap-1">
            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {isIssue && (
                <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
                  ISSUE
                </span>
              )}
              {aiCategory && aiCategory !== "general" && GLANCE_CATEGORY_LABELS[aiCategory] && catStyle && (
                <motion.span
                  key={aiCategory}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 28 }}
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                    catStyle.bg, catStyle.text, catStyle.border
                  )}>
                  <span className="text-[10px] leading-none">{GLANCE_CATEGORY_LABELS[aiCategory].emoji}</span>
                  {GLANCE_CATEGORY_LABELS[aiCategory].label}
                </motion.span>
              )}
              {assignedToName && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
                  {assignedToPhotoUrl ? (
                    <img src={assignedToPhotoUrl} alt={assignedToName} className="w-3 h-3 rounded-full object-cover shrink-0" />
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-violet-200 flex items-center justify-center text-[7px] font-black text-violet-700 shrink-0">
                      {assignedToName[0]?.toUpperCase()}
                    </span>
                  )}
                  {assignedToName.split(" ")[0]}
                </span>
              )}
            </div>

            {/* Quick actions — visible only on hover, purely visual */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
              <span
                className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                title="Assign"
                onClick={(e) => e.stopPropagation()}
              >
                <UserPlus className="w-3 h-3" />
              </span>
              <span
                className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                title="Archive"
                onClick={(e) => e.stopPropagation()}
              >
                <Archive className="w-3 h-3" />
              </span>
              <span
                className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                title="More"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="w-3 h-3" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.button>
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
    <div className="bg-white rounded-[22px] border border-[#eef2f7] shadow-[0_8px_18px_rgba(16,24,40,0.05)] p-7 mb-[18px]">
      {/* Message header: avatar | sender+email | timestamp */}
      <div
        className="grid gap-3 mb-5 pb-5 border-b border-[#eef2f7]"
        style={{ gridTemplateColumns: "45px 1fr auto" }}
      >
        {/* Avatar — 45px, soft gradient */}
        <div
          className="w-[45px] h-[45px] rounded-full flex items-center justify-center font-bold text-sm shrink-0"
          style={{
            background: `linear-gradient(135deg, ${accentColor}22 0%, ${accentColor}44 100%)`,
            color: accentColor,
          }}
        >
          {getInitials(senderName)}
        </div>
        {/* Sender name + email */}
        <div className="min-w-0 flex flex-col justify-center">
          <p
            className="text-[16px] font-[800] leading-tight truncate"
            style={{ color: accentColor }}
          >
            {senderName}
          </p>
          {msg.fromEmail && msg.fromEmail !== msg.from && (
            <p className="text-[13px] text-slate-400 truncate mt-0.5">{msg.fromEmail}</p>
          )}
        </div>
        {/* Timestamp */}
        <div className="flex items-center shrink-0">
          <span className="text-[13px] font-[800] text-[#9aa8bc]">{formatDate(msg.date)}</span>
        </div>
      </div>

      {/* Body */}
      {sanitizedHtml ? (
        <div
          className="text-[16px] text-[#27364d] leading-[1.7] prose prose-sm max-w-none
            [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#dbe4f0] [&_blockquote]:pl-4 [&_blockquote]:text-slate-500 [&_blockquote]:not-italic
            [&_.gmail_quote]:border-l-[3px] [&_.gmail_quote]:border-[#dbe4f0] [&_.gmail_quote]:pl-4 [&_.gmail_quote]:text-slate-400"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      ) : (
        <div className="text-[16px] text-[#27364d] leading-[1.7] whitespace-pre-wrap">
          {msg.bodyText || msg.snippet}
        </div>
      )}

      {/* Attachments */}
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5">
          {msg.attachments.map((att) => (
            <AttachmentItem key={att.attachmentId} messageId={msg.id} att={att} />
          ))}
        </div>
      )}

      {/* Sent-by footer */}
      {msg.sentBy && (
        <div className="flex items-center gap-2 mt-[22px] pt-4 border-t border-[#eef2f7]">
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
          <span className="text-[12px] text-[#334155]">Sent by <span className="font-semibold">{msg.sentBy.name}</span></span>
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
    <aside className="w-[clamp(260px,22vw,330px)] shrink-0 bg-white border-l border-[#e8edf5] flex flex-col overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#dde3ee_transparent]">
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
        <AnimatePresence mode="wait">
          <motion.div
            key={validEmail}
            className="flex flex-col"
            initial={{ opacity: 0, x: 8, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 8, scale: 0.98 }}
            transition={{ delay: 0.03, ...PANEL_TRANSITION }}
          >
          {/* ── Customer header hero card ─────────────────────────────── */}
          <div style={{ padding: "26px 22px 20px" }} className="border-b border-[#e8edf5]">
            <div className="flex items-start gap-3">
              {/* 62px avatar, 20px radius, #dff2ff bg */}
              <div
                className="w-[62px] h-[62px] shrink-0 flex items-center justify-center font-black text-xl shadow-[0_4px_12px_rgba(16,24,40,0.10)]"
                style={{
                  borderRadius: "20px",
                  background: "#dff2ff",
                  color: "#1a6fa8",
                }}
              >
                {getInitials(displayName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p
                    className="font-[900] text-[17px] text-[#162033] leading-tight"
                    style={{ letterSpacing: "-0.2px" }}
                  >
                    {displayName}
                  </p>
                  {isLongTimeCustomer && (
                    <span
                      className="text-[11px] font-[900] shrink-0"
                      style={{
                        background: "#fff7d6",
                        color: "#a16207",
                        borderRadius: "999px",
                        padding: "4px 8px",
                      }}
                    >
                      ⭐ LOYAL
                    </span>
                  )}
                </div>
                <div className="mt-1.5 space-y-[3px]">
                  <p className="text-[13px] font-[700] text-[#8ba0bd] truncate">{validEmail}</p>
                  {customerPhone && <p className="text-[13px] font-[700] text-[#8ba0bd]">{customerPhone}</p>}
                  {customerSince && (
                    <p className="text-[13px] font-[700] text-[#8ba0bd]">Customer since {customerSince}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col divide-y divide-[#e8edf5]">

          {/* ── AI Thread Summary ──────────────────────────────────── */}
          {threadId && (
            <div style={{ padding: "20px 22px" }}>
              <div className="flex items-center justify-between mb-3">
                <p
                  className="text-[12px] font-[900] text-[#99a7bd] uppercase"
                  style={{ letterSpacing: "3px" }}
                >
                  AI Summary
                </p>
                {!aiSummary && (
                  <button
                    onClick={onProcessThread}
                    disabled={isProcessing}
                    className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {isProcessing ? "Analyzing…" : "Analyze"}
                  </button>
                )}
              </div>
              <AnimatePresence>
              {aiSummary ? (
                <motion.div
                  key={aiSummary.slice(0, 20)}
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={SUMMARY_TRANSITION}
                  style={{
                    background: "#f8faff",
                    border: "1px solid #eef3fb",
                    borderRadius: "20px",
                    padding: "17px 18px",
                  }}
                >
                  {aiCategory && GLANCE_CATEGORY_LABELS[aiCategory] && (
                    <div className="flex items-center justify-between mb-3">
                      {/* Color-coded category chip */}
                      <motion.span
                        key={aiCategory}
                        initial={{ scale: 0.75, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 28 }}
                        className="inline-flex items-center gap-1.5 text-[12px] font-[900] shrink-0"
                        style={{
                          padding: "5px 11px",
                          borderRadius: "999px",
                          ...(aiCategory === "booking" ? { background: "#dcfce7", color: "#15803d" }
                            : aiCategory === "revenue" ? { background: "#fff7ed", color: "#c2410c" }
                            : aiCategory === "upset" ? { background: "#fee2e2", color: "#dc2626" }
                            : aiCategory === "internal" ? { background: "#f3e8ff", color: "#7c3aed" }
                            : aiCategory === "refund" ? { background: "#fef9c3", color: "#a16207" }
                            : { background: "#eef5ff", color: "#52637c" }),
                        }}
                      >
                        <span>{GLANCE_CATEGORY_LABELS[aiCategory].emoji}</span>
                        {GLANCE_CATEGORY_LABELS[aiCategory].label}
                      </motion.span>
                      <div className="flex items-center gap-1.5">
                        {aiUrgency === "high" && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-600">URGENT</span>
                        )}
                        {aiUrgency === "medium" && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">MEDIUM</span>
                        )}
                        {/* Refresh icon top-right */}
                        <button
                          onClick={onProcessThread}
                          disabled={isProcessing}
                          className="text-slate-300 hover:text-blue-500 disabled:opacity-50 transition-colors"
                          title="Refresh AI summary"
                        >
                          {isProcessing
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <RefreshCw className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}
                  <ul className="space-y-1.5">
                    {(() => {
                      try {
                        const bullets: string[] = JSON.parse(aiSummary);
                        return bullets.map((b, i) => (
                          <li key={i} className="flex items-start gap-2 text-[13px] text-[#475569]" style={{ lineHeight: "1.6" }}>
                            <span className="text-slate-300 mt-0.5 shrink-0">•</span>
                            <span>{b}</span>
                          </li>
                        ));
                      } catch {
                        return <li className="text-[13px] text-[#475569]" style={{ lineHeight: "1.6" }}>{aiSummary}</li>;
                      }
                    })()}
                  </ul>
                  <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[#eef3fb]">
                    <p className="text-[10px] text-slate-300">
                      {aiProcessedAt ? new Date(aiProcessedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                    </p>
                    {aiCategory && aiCategory !== "general" && (
                      <button
                        onClick={onResolveGlance}
                        className="text-[10px] font-semibold text-slate-400 hover:text-green-600 transition-colors"
                      >
                        ✓ resolve
                      </button>
                    )}
                  </div>
                </motion.div>
              ) : (
                <div className="rounded-[20px] p-4 border border-dashed border-slate-200 text-center">
                  <Sparkles className="w-4 h-4 text-slate-300 mx-auto mb-1.5" />
                  <p className="text-[12px] text-slate-400">No AI summary yet</p>
                  <p className="text-[10px] text-slate-300 mt-0.5">Will auto-process in background</p>
                </div>
              )}
              </AnimatePresence>
            </div>
          )}

          {/* ── Lifetime Value Stats ────────────────── */}
          {stats && stats.jobCount > 0 && (
            <div style={{ padding: "20px 22px" }}>
              <p className="text-[11px] font-[900] text-[#99a7bd] uppercase mb-3" style={{letterSpacing:"3px"}}>Lifetime Value</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 rounded-[12px] py-2.5 px-1 text-center border border-slate-100">
                  <p className="text-[15px] font-[900] text-[#162033]">
                    {stats.lifetimeValue >= 1000
                      ? `$${(stats.lifetimeValue / 1000).toFixed(1)}k`
                      : `$${stats.lifetimeValue}`}
                  </p>
                  <p className="text-[10px] text-slate-400 font-[700] mt-0.5">Total spent</p>
                </div>
                <div className="bg-slate-50 rounded-[12px] py-2.5 px-1 text-center border border-slate-100">
                  <p className="text-[15px] font-[900] text-[#162033]">{stats.jobCount}</p>
                  <p className="text-[10px] text-slate-400 font-[700] mt-0.5">Cleanings</p>
                </div>
                <div className="bg-slate-50 rounded-[12px] py-2.5 px-1 text-center border border-slate-100">
                  <p className="text-[15px] font-[900] text-[#162033]">${stats.avgJobPrice}</p>
                  <p className="text-[10px] text-slate-400 font-[700] mt-0.5">Avg/visit</p>
                </div>
              </div>
              {stats.lastJobDate && (
                <p className="text-[11px] text-slate-400 mt-2.5 text-center font-[500]">
                  Last cleaned {formatJobDate(stats.lastJobDate)}
                </p>
              )}
            </div>
          )}

          {/* ── No customer record ──────────────────────────── */}
          {(!jobs || jobs.length === 0) && (
            <div style={{ padding: "20px 22px" }}>
              <div className="rounded-[20px] p-4 border border-dashed border-slate-200 text-center">
                <p className="text-[12px] text-slate-400 italic">No booking history found</p>
              </div>
            </div>
          )}



          {/* ── Home Profile (from most recent job) ──────────────── */}
          {jobs && jobs.length > 0 && (jobs[0].bedrooms || jobs[0].bathrooms) && (
            <div style={{ padding: "20px 22px" }}>
              <p
                className="text-[12px] font-[900] text-[#99a7bd] uppercase mb-3"
                style={{ letterSpacing: "3px" }}
              >
                Home Profile
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {jobs[0].bedrooms && (
                  <span
                    className="inline-flex items-center text-[12px] font-[700] text-slate-600"
                    style={{ height: "34px", padding: "0 12px", borderRadius: "999px", background: "#f8fafc", border: "1px solid #edf2f7" }}
                  >
                    🛏 {jobs[0].bedrooms} bed{jobs[0].bedrooms !== 1 ? "s" : ""}
                  </span>
                )}
                {jobs[0].bathrooms && (
                  <span
                    className="inline-flex items-center text-[12px] font-[700] text-slate-600"
                    style={{ height: "34px", padding: "0 12px", borderRadius: "999px", background: "#f8fafc", border: "1px solid #edf2f7" }}
                  >
                    🚿 {jobs[0].bathrooms} bath{jobs[0].bathrooms !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── Booking History Timeline ─────────────────────── */}
          {jobs && jobs.length > 0 && (
            <div style={{ padding: "20px 22px" }}>
              <p
                className="text-[12px] font-[900] text-[#99a7bd] uppercase mb-3"
                style={{ letterSpacing: "3px" }}
              >
                Recent Bookings
              </p>
              <div className="space-y-0 max-h-64 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {jobs.map((job) => (
                  <div key={job.id} className="flex items-center gap-3 py-2.5 border-b border-[#f0f4f8] last:border-0">
                    <span
                      className="shrink-0"
                      style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#22c55e", display: "block" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-[800] text-slate-700 truncate">
                        {job.frequency ?? "One-time"}
                      </p>
                      <p className="text-[12px] text-slate-400 mt-0.5">{formatJobDate(job.jobDate ?? null)}</p>
                    </div>
                    {job.lastBookingPrice ? (
                      <p className="text-[13px] font-[800] text-slate-800 shrink-0">${job.lastBookingPrice}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Quick Actions ──────────────────────────────────── */}
          <div style={{ padding: "20px 22px" }}>
            <p
              className="text-[12px] font-[900] text-[#99a7bd] uppercase mb-3"
              style={{ letterSpacing: "3px" }}
            >
              Quick Actions
            </p>
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
          </motion.div>
        </AnimatePresence>
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
  // Optimistic thread state — Map<threadId, true>
  // ---------------------------------------------------------------------------
  // Tracks threads with an in-flight mutation (e.g. markRead) so the unread dot
  // disappears immediately on click without waiting for the server round-trip.
  // The badge always reads trueUnreadCount directly from the server — no arithmetic.
  // Entries expire automatically when the server confirms the thread is no longer
  // unread (via the cleanup useEffect below), or immediately on mutation error.
  // ---------------------------------------------------------------------------
  const [optimisticThreadState, setOptimisticThreadState] =
    useState(() => new Map<string, true>());
  // Ref so mutation callbacks can read the current filtered list without closure staleness
  const filteredThreadsRef = useRef<GmailThread[]>([]);

  /**
   * Derived unread truth: server flag AND not in optimistic pending set.
   * Use this everywhere instead of `thread.isUnread` directly.
   */
  function effectiveIsUnread(thread: GmailThread): boolean {
    return thread.isUnread && !optimisticThreadState.has(thread.id);
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

  // ---------------------------------------------------------------------------
  // Voice-to-email state
  // ---------------------------------------------------------------------------
  const [voiceIsRecording, setVoiceIsRecording] = useState(false);
  const [voiceIsPressing, setVoiceIsPressing] = useState(false); // instant visual feedback before getUserMedia resolves
  const [voiceIsTranscribing, setVoiceIsTranscribing] = useState(false);
  const [voiceIsRewriting, setVoiceIsRewriting] = useState(false);
  const [voiceTone, setVoiceTone] = useState<"friendly" | "professional" | "casual">("friendly");
  const [showVoiceImprove, setShowVoiceImprove] = useState(false);
  const voiceMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceAudioChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const voiceIsPttRef = useRef(false);

  const transcribeVoiceMutation = trpc.opsChat.transcribeVoiceNote.useMutation();
  const rewriteEmailMutation = trpc.gmail.rewriteEmailDraft.useMutation();

  const startVoiceRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      voiceAudioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) voiceAudioChunksRef.current.push(e.data); };
      mr.start(100);
      voiceMediaRecorderRef.current = mr;
      setVoiceIsPressing(false);
      setVoiceIsRecording(true);
      setVoiceSeconds(0);
      voiceTimerRef.current = setInterval(() => setVoiceSeconds(s => s + 1), 1000);
    } catch {
      toast.error("Microphone access denied");
    }
  }, []);

  const stopVoiceRecording = useCallback(async () => {
    const mr = voiceMediaRecorderRef.current;
    if (!mr) return;
    if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
    setVoiceIsRecording(false);
    setVoiceIsPressing(false);
    voiceIsPttRef.current = false;
    setVoiceIsTranscribing(true);
    await new Promise<void>(resolve => {
      mr.onstop = () => resolve();
      // requestData() flushes any buffered audio into ondataavailable before stop fires
      // This prevents the race where the final chunk arrives after onstop resolves
      try { mr.requestData(); } catch { /* ignore if already stopping */ }
      mr.stop();
      mr.stream.getTracks().forEach(t => t.stop());
    });
    try {
      const blob = new Blob(voiceAudioChunksRef.current, { type: "audio/webm" });
      if (blob.size === 0) {
        toast.warning("No audio captured — try holding the button longer");
        return;
      }
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const { text } = await transcribeVoiceMutation.mutateAsync({ dataBase64, mimeType: "audio/webm" });
      if (text.trim()) {
        setReplyText(text.trim());
        setShowVoiceImprove(true);
        setVoiceTone("friendly");
      } else {
        toast.warning("No speech detected — try again");
      }
    } catch (err: any) {
      const msg = err?.message ?? "";
      // Surface the real Whisper error detail if available
      toast.error(msg.length > 0 && msg.length < 200 ? msg : "Transcription failed — try again");
    } finally {
      setVoiceIsTranscribing(false);
    }
  }, [transcribeVoiceMutation]);

  // Document-level PTT release — stops recording when mouse/touch is released anywhere on the page
  // This prevents the button losing its active state when the cursor drifts off it while holding
  useEffect(() => {
    const handleGlobalRelease = () => {
      if (voiceIsPttRef.current) stopVoiceRecording();
    };
    document.addEventListener("mouseup", handleGlobalRelease);
    document.addEventListener("touchend", handleGlobalRelease);
    return () => {
      document.removeEventListener("mouseup", handleGlobalRelease);
      document.removeEventListener("touchend", handleGlobalRelease);
    };
  }, [stopVoiceRecording]);

  // Glance panel state: which category is active as a filter
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string | null>(null);
  const [glancePanelOpen, setGlancePanelOpen] = useState(false);
  // Agent assignment filter state
  const [activeAgentFilter, setActiveAgentFilter] = useState<number | null>(null);
  const [agentPanelOpen, setAgentPanelOpen] = useState(true);
  // Sender policy state
  const [showIgnored, setShowIgnored] = useState(false);
  const [ignoreSenderModal, setIgnoreSenderModal] = useState<{ fromEmail: string; fromName: string } | null>(null);
  const [ignoreSenderType, setIgnoreSenderType] = useState<"email" | "domain">("domain");

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
  // Agent assignment buckets — refreshes every 60s
  const agentAssignmentsQuery = trpc.gmail.getAgentAssignments.useQuery(undefined, {
    enabled: statusQuery.data?.connected === true,
    staleTime: 60_000,
    retry: false,
  });

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
      // If we're in an agent filter and the resolved thread was the last one, clear the filter
      if (activeAgentFilter !== null) {
        const remaining = filteredThreadsRef.current.filter((t) => t.id !== resolvedId);
        if (remaining.length === 0) {
          setActiveAgentFilter(null);
          setExtraThreads([]);
        }
      }
      utils.gmail.getGlance.invalidate();
      utils.gmail.getAgentAssignments.invalidate();
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

  // Badge always shows server truth (trueUnreadCount) — no client arithmetic.

  // Build the Gmail search query — only the user's free-text search is passed to the server.
  // Tab filtering (unread, leads, mine) is done client-side after the server returns all threads.
  // showIgnored controls whether ignored-sender threads are included.
  const composedQuery = debouncedQuery || undefined;
  // Leads tab shows ignored-sender threads — must pass showIgnored=true to the server
  const effectiveShowIgnored = showIgnored || activeTab === "leads";

  const threadsQuery = trpc.gmail.listThreads.useQuery(
    { maxResults: 100, query: composedQuery, showIgnored: effectiveShowIgnored },
    { enabled: statusQuery.data?.connected === true, staleTime: 30_000, retry: false, refetchOnWindowFocus: false }
  );

  const upsertSenderPolicyMutation = trpc.gmail.upsertSenderPolicy.useMutation({
    onSuccess: (data) => {
      setIgnoreSenderModal(null);
      utils.gmail.listThreads.invalidate();
      utils.gmail.getUnreadCount.invalidate();
      toast.success(`Sender policy saved — ${data.threadsUpdated} thread(s) updated`);
    },
    onError: (err) => toast.error(err.message || "Failed to save sender policy"),
  });

  async function loadMore() {
    const nextToken = threadsQuery.data?.nextPageToken;
    if (!nextToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await utils.gmail.listThreads.fetch({
        maxResults: 100,
        pageToken: nextToken,
        query: debouncedQuery || undefined,
        showIgnored: effectiveShowIgnored,
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
      // Invalidate first (fire-and-forget) — optimistic entry expires naturally
      // via the cleanup useEffect once the refetched thread shows isUnread=false.
      utils.gmail.listThreads.invalidate();
      utils.gmail.getThread.invalidate({ threadId });
      utils.gmail.getUnreadCount.invalidate();
    },
    onError: (_err, { threadId }) => {
      // Mutation failed — unwind optimistic state immediately so UI doesn't get stuck
      setOptimisticThreadState((prev) => {
        const next = new Map(prev);
        next.delete(threadId);
        return next;
      });
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
    setShowVoiceImprove(false);
    const thread = threadsQuery.data?.threads.find((t) => t.id === threadId);
    // Only fire markRead if the thread is actually unread — mutation is idempotent
    // but no reason to do unnecessary work.
    if (!thread?.isUnread) return;
    // Atomic optimistic addition — guard is inside the updater (React-safe, no stale closure)
    setOptimisticThreadState((prev) => {
      if (prev.has(threadId)) return prev; // duplicate click, no-op
      return new Map(prev).set(threadId, true);
    });
    markReadMutation.mutate({ threadId });
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
      utils.gmail.getAgentAssignments.invalidate();
      toast.success(`Assigned to ${data.assignedToName}`);
      setAssignDropdownOpen(null);
    },
    onError: (err) => toast.error(err.message || "Failed to assign thread"),
  });
  const unassignThreadMutation = trpc.gmail.unassignThread.useMutation({
    onSuccess: (_data, { threadId: unassignedId }) => {
      threadMetaQuery.refetch();
      utils.gmail.getAgentAssignments.invalidate();
      // If we're filtering by an agent and this was their last thread, clear the filter
      if (activeAgentFilter !== null) {
        const remaining = filteredThreadsRef.current.filter((t) => t.id !== unassignedId);
        if (remaining.length === 0) {
          setActiveAgentFilter(null);
          setExtraThreads([]);
        }
      }
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
  // Also apply glance category filter or agent assignment filter if active
  // Keep ref in sync so mutation callbacks can read the latest list
  const threads = (() => {
    let base = activeTab === "mine"
      ? sortedThreads.filter((t) => {
          const meta = metaMap.get(t.id);
          return meta?.assignedToId !== null && meta?.assignedToId !== undefined && meta.assignedToId === currentAgentId;
        })
      : activeTab === "unread"
      ? sortedThreads.filter((t) => t.isUnread)
      : activeTab === "leads"
      ? sortedThreads.filter((t) => {
          // Leads = threads from ignored senders (e.g. Thumbtack) visible when showIgnored=true
          // When showIgnored=false the server already excludes them, so leads tab auto-enables showIgnored
          const meta = metaMap.get(t.id);
          return (meta?.isActionable ?? 1) === 0;
        })
      : sortedThreads;
    if (activeCategoryFilter) {
      const cat = glanceQuery.data?.categories.find((c) => c.category === activeCategoryFilter);
      const catThreadIds = new Set(cat?.threadIds ?? []);
      base = base.filter((t) => catThreadIds.has(t.id));
    }
    if (activeAgentFilter !== null) {
      const agentData = agentAssignmentsQuery.data?.agents.find((a) => a.agentId === activeAgentFilter);
      const agentThreadIds = new Set((agentData?.threads ?? []).map((t: any) => t.id));
      base = base.filter((t) => agentThreadIds.has(t.id));
    }
    return base;
  })();
  filteredThreadsRef.current = threads;
  const selectedThread = threadQuery.data ?? null;

  // Cleanup: expire optimistic entries once the server confirms the thread is no longer unread.
  // Iterates only the optimistic map (typically 0–2 entries), not the full thread list.
  // Returns prev unchanged if nothing changed, so React skips the re-render.
  useEffect(() => {
    if (optimisticThreadState.size === 0) return; // fast path — nothing pending
    const threadMap = new Map(allThreads.map((t) => [t.id, t]));
    setOptimisticThreadState((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const threadId of next.keys()) {
        const t = threadMap.get(threadId);
        if (!t || !t.isUnread) {
          next.delete(threadId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allThreads]);
  const mineCount = sortedThreads.filter((t) => {
    const meta = metaMap.get(t.id);
    return meta?.assignedToId !== null && meta?.assignedToId !== undefined && meta.assignedToId === currentAgentId;
  }).length;

  // Auto-select the first thread when tab or category/agent filter changes.
  // Uses setSelectedThreadId directly — NOT selectThread — so it does NOT call markRead.
  // The thread is displayed but stays unread until the user explicitly clicks it.
  const lastAutoSelectedKey = useRef<string | null>(null);
  // Deep-link: if ?thread=<threadId> is in the URL, select that thread on first load
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const params = new URLSearchParams(window.location.search);
    const threadParam = params.get("thread");
    if (!threadParam) return;
    // Wait until threads are loaded so we can find the thread
    if (threads.length === 0) return;
    deepLinkApplied.current = true;
    // Remove the param from the URL without a page reload
    const url = new URL(window.location.href);
    url.searchParams.delete("thread");
    window.history.replaceState({}, "", url.toString());
    // Select the thread (marks it read)
    selectThread(threadParam);
  }, [threads]);
  useEffect(() => {
    if (threads.length === 0) return;       // nothing loaded yet
    // Skip auto-select if a deep-link thread was already applied
    if (deepLinkApplied.current && selectedThreadId) return;
    const key = `${activeTab}::${activeCategoryFilter ?? ""}::${activeAgentFilter ?? ""}`;
    if (lastAutoSelectedKey.current === key) return; // already auto-selected for this tab+filter combo
    lastAutoSelectedKey.current = key;
    setSelectedThreadId(threads[0].id);
  }, [threads, activeTab, activeCategoryFilter, activeAgentFilter]);

  return (
    <div className="h-screen flex overflow-hidden bg-[#f5f5f3] font-sans min-w-[920px]">
      {/* Thread sidebar */}
      <aside className="w-[330px] bg-white border-r border-[#e8edf5] flex flex-col shrink-0 overflow-hidden" style={{boxShadow: '0 12px 30px rgba(16,24,40,0.07)'}}>
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-[#e8edf5]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight" style={{fontFamily: 'Georgia, serif'}}>Maids Inbox</h1>
              <p className="text-[13px] text-[#8fa1b8] mt-0.5">Shared Gmail Inbox</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { utils.gmail.listThreads.invalidate(); utils.gmail.getConnectionStatus.invalidate(); }}
                className="w-[42px] h-[42px] rounded-2xl flex items-center justify-center text-slate-400 bg-white hover:bg-slate-50 transition-all duration-150 hover:-translate-y-px"
                style={{boxShadow: '0 4px 10px rgba(15,23,42,0.04)', border: '1px solid #e8edf5'}}
                title="Refresh"
              >
                <RefreshCw className={cn("w-4 h-4", threadsQuery.isFetching && "animate-spin")} />
              </button>
              <button
                onClick={() => setShowCompose(true)}
                className="w-[42px] h-[42px] bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-slate-800 transition-all duration-150 hover:-translate-y-px"
                style={{boxShadow: '0 4px 10px rgba(15,23,42,0.04)'}}
                title="New email"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search inbox..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 bg-[#f8fafc] border-[#e6ebf2] rounded-2xl text-sm h-12 focus:ring-2 focus:ring-slate-200"
            />
          </div>
          {/* Tab filter — Row 1: primary tabs */}
          <div className="flex items-center gap-1.5 mb-2">
            {([
              { key: "conversations" as const, label: "Inbox", badge: undefined as number | undefined },
              { key: "unread" as const, label: "Unread", badge: trueUnreadCount as number | undefined },
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
                  "relative flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-2 rounded-full transition-all duration-150",
                  activeTab === key
                    ? "bg-[#0f172a] text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                )}
              >
                {label}
                {badge != null && badge > 0 && (
                  <span className={cn(
                    "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none",
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

          {/* Actionable segmented control */}
          <div className="rounded-2xl p-1 mb-1" style={{background: '#f1f4f9'}}>
            <div className="flex">
              <button
                onClick={() => {
                  if (showIgnored) {
                    setShowIgnored(false);
                    setExtraThreads([]);
                    setSelectedThreadId(null);
                  }
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 text-[13px] font-[700] h-[38px] rounded-xl transition-all duration-150",
                  !showIgnored
                    ? "bg-white text-[#162033] shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                )}
                title="Show actionable threads only"
              >
                Actionable{!showIgnored && allThreads.length > 0 && (
                  <span className="text-[11px] font-[600] text-slate-400">({allThreads.filter(t => (metaMap.get(t.id)?.isActionable ?? 1) === 1).length})</span>
                )}
              </button>
              <button
                onClick={() => {
                  if (!showIgnored) {
                    setShowIgnored(true);
                    setExtraThreads([]);
                    setSelectedThreadId(null);
                  }
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 text-[13px] font-[700] h-[38px] rounded-xl transition-all duration-150",
                  showIgnored
                    ? "bg-white text-[#162033] shadow-sm"
                    : "text-slate-400 hover:text-slate-600"
                )}
                title="Show all senders including ignored"
              >
                All{showIgnored && allThreads.length > 0 && (
                  <span className="text-[11px] font-[600] text-slate-400">({allThreads.length})</span>
                )}
              </button>
            </div>
          </div>
          {/* Status line + Policies link */}
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-[12px] font-[600] text-slate-400">
              {!showIgnored ? "Hiding ignored senders" : "Showing all senders"}
            </span>
            <Link href="/admin/inbox/sender-policies">
              <button className="flex items-center gap-1 text-[12px] text-violet-500 hover:text-violet-700 transition-colors font-[700]">
                <Settings className="w-3 h-3" />
                Policies
              </button>
            </Link>
          </div>
        </div>

        {/* Agent Assignment Buckets — show on all tabs */}
        {agentAssignmentsQuery.data && agentAssignmentsQuery.data.agents.length > 0 && (
          <div className="border-b border-[#e8edf5]">
            <button
              onClick={() => setAgentPanelOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
            >
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.12em]">Assignments</span>
              <ChevronRight className={cn("w-3.5 h-3.5 text-slate-300 transition-transform duration-150", agentPanelOpen && "rotate-90")} />
            </button>
            {agentPanelOpen && (
              <div className="px-5 pb-4">
                {/* Clear filter row */}
                {activeAgentFilter !== null && (
                  <button
                    onClick={() => {
                      setActiveAgentFilter(null);
                      setExtraThreads([]);
                      lastAutoSelectedKey.current = null;
                    }}
                    className="w-full flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 hover:text-violet-700 px-2 py-1 mb-2 rounded-lg hover:bg-violet-50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Clear filter
                  </button>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  {agentAssignmentsQuery.data.agents.map((agent) => {
                    const isActive = activeAgentFilter === agent.agentId;
                    const hasWork = agent.count > 0;
                    const firstName = agent.agentName.split(" ")[0];
                    return (
                      <button
                        key={agent.agentId}
                        title={`${agent.agentName} — ${agent.count} open assignment${agent.count !== 1 ? "s" : ""}`}
                        onClick={() => {
                          if (isActive) {
                            // Toggle off
                            setActiveAgentFilter(null);
                            setExtraThreads([]);
                            lastAutoSelectedKey.current = null;
                          } else {
                            setActiveAgentFilter(agent.agentId);
                            // Clear category filter — agent filter takes over
                            setActiveCategoryFilter(null);
                            setSelectedThreadId(null);
                            lastAutoSelectedKey.current = null;
                            // Inject this agent's threads into extraThreads so they appear
                            // even if not loaded via the current pagination
                            if (agent.threads?.length) {
                              setExtraThreads(agent.threads as any[]);
                            } else {
                              setExtraThreads([]);
                            }
                            // Switch to conversations tab so filter applies
                            if (activeTab === "unread" || activeTab === "all" || activeTab === "mine") {
                              setActiveTab("conversations");
                            }
                          }
                        }}
                        className={cn(
                          "relative flex flex-col items-center gap-1.5 transition-all duration-150 group hover:-translate-y-px",
                          !hasWork && "opacity-40"
                        )}
                      >
                        {/* Avatar circle + badge wrapper (relative, NOT overflow-hidden) */}
                        <div className="relative w-10 h-10">
                          {/* The image circle is overflow-hidden but the badge sits outside it */}
                          <div className={cn(
                            "w-10 h-10 rounded-full overflow-hidden ring-2 transition-all duration-150",
                            isActive
                              ? "ring-violet-500 ring-offset-1"
                              : hasWork
                              ? "ring-slate-200 group-hover:ring-violet-300"
                              : "ring-slate-100"
                          )}>
                            {agent.agentPhotoUrl ? (
                              <img
                                src={agent.agentPhotoUrl}
                                alt={agent.agentName}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className={cn(
                                "w-full h-full flex items-center justify-center font-black text-[11px]",
                                isActive ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600"
                              )}>
                                {getInitials(agent.agentName)}
                              </div>
                            )}
                          </div>
                          {/* Count badge — outside overflow-hidden so it's never clipped */}
                          {hasWork && (
                            <span className={cn(
                              "absolute -top-1 -right-1 min-w-[17px] h-[17px] px-0.5 rounded-full text-[9px] font-black leading-none flex items-center justify-center border-2 border-white shadow-sm",
                              isActive ? "bg-violet-600 text-white" : "bg-slate-700 text-white"
                            )}>
                              {agent.count}
                            </span>
                          )}
                        </div>
                        {/* Name label */}
                        <span className={cn(
                          "text-[10px] font-semibold leading-none max-w-[40px] truncate",
                          isActive ? "text-violet-600" : "text-slate-500"
                        )}>
                          {firstName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Today at a Glance panel — only on Inbox/Unread/All/Mine tabs, not Leads */}
        {activeTab !== "leads" && glanceQuery.data && glanceQuery.data.categories.length > 0 && (
          <div className="border-b border-[#e8edf5]">
            {/* Glance header */}
            <button
              onClick={() => setGlancePanelOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
            >
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.12em]">Today at a Glance</span>
              <span className={cn(
                "flex items-center justify-center w-7 h-7 rounded-full transition-all duration-200",
                glancePanelOpen
                  ? "bg-violet-100"
                  : "bg-violet-600 animate-pulse shadow-[0_0_8px_rgba(124,58,237,0.7)]"
              )}>
                <ChevronRight className={cn(
                  "w-3.5 h-3.5 transition-transform duration-200",
                  glancePanelOpen ? "text-violet-500 rotate-90" : "text-white"
                )} />
              </span>
            </button>
            {glancePanelOpen && (
              <div className="px-4 pb-4 space-y-1">
                {/* Clear filter row */}
                {activeCategoryFilter && (
                  <button
                    onClick={() => {
                      setActiveCategoryFilter(null);
                      lastAutoSelectedKey.current = null;
                    }}
                    className="w-full flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 hover:text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Clear filter
                  </button>
                )}
                {glanceQuery.data.categories.map((cat) => {
                  return (
                  <div
                    key={cat.category}
                    className={cn(
                      "group flex items-center gap-2.5 px-3 rounded-xl cursor-pointer transition-all duration-150",
                      "h-12",
                      activeCategoryFilter === cat.category
                        ? "bg-slate-900 text-white shadow-sm"
                        : "hover:bg-slate-100"
                    )}
                    onClick={() => {
                      const newFilter = activeCategoryFilter === cat.category ? null : cat.category;
                      setActiveCategoryFilter(newFilter);
                      // Clear agent filter — category filter takes over
                      setActiveAgentFilter(null);
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
                      "flex-1 text-[12px] font-semibold truncate",
                      activeCategoryFilter === cat.category ? "text-white" : "text-slate-700"
                    )}>
                      {cat.label}
                    </span>
                    <span className={cn(
                      "text-[15px] font-black shrink-0",
                      activeCategoryFilter === cat.category ? "text-white" : cat.urgentCount > 0 ? "text-red-500" : "text-slate-500"
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
                      <CheckCircle2 className="w-[18px] h-[18px]" />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#e2e8f0_transparent]">
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
          {/* Syncing banner: shown when DB has no rows yet (worker hasn't processed any threads) */}
          {!threadsQuery.isLoading && threadsQuery.data?.syncing && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400 mb-3" />
              <p className="text-xs font-semibold text-slate-500 mb-1">Inbox syncing…</p>
              <p className="text-xs text-slate-400">Your emails are being indexed. This usually takes less than a minute.</p>
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
          {threads.length === 0 && !threadsQuery.isLoading && statusQuery.data?.connected && !threadsQuery.data?.syncing && (
            <div className="text-center py-12 px-4">
              {activeCategoryFilter ? (
                <>
                  <span className="text-2xl block mb-2">
                    {glanceQuery.data?.categories.find((c) => c.category === activeCategoryFilter)?.emoji ?? "💭"}
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
              ) : activeAgentFilter !== null ? (
                <>
                  <span className="text-2xl block mb-2">📥</span>
                  <p className="text-xs font-semibold text-slate-500 mb-1">
                    {agentAssignmentsQuery.data?.agents.find((a) => a.agentId === activeAgentFilter)?.agentName ?? "Agent"}
                  </p>
                  <p className="text-xs text-slate-400">No open assignments</p>
                  <button
                    onClick={() => { setActiveAgentFilter(null); setExtraThreads([]); lastAutoSelectedKey.current = null; }}
                    className="mt-3 text-[10px] font-semibold text-violet-500 hover:text-violet-700"
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
            <div className="px-4 py-4 border-t border-[#e8edf5]">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full text-[12px] font-semibold text-slate-500 hover:text-slate-700 py-2.5 rounded-xl hover:bg-slate-50 transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Email viewer */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-[320px]">
        {statusQuery.data?.connected === false && <NotConnectedBanner />}
        {statusQuery.data?.connected && !selectedThreadId && (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <Mail className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm text-slate-400">Select a thread to read</p>
            </div>
          </div>
        )}
        <AnimatePresence mode="wait">
          {selectedThreadId && statusQuery.data?.connected && (
            <motion.div
              key={selectedThreadId}
                className="flex flex-col flex-1 overflow-hidden min-w-0"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ delay: 0.05, ...PANEL_TRANSITION }}
            >
            {/* Thread header */}
            <div className="bg-white border-b border-[#e8edf5] flex items-center justify-between shrink-0" style={{ height: "72px", padding: "0 28px", gap: "12px" }}>
              <div className="flex-1 min-w-0">
                <h2
                  className="text-[18px] font-[900] text-[#162033] truncate leading-tight"
                  style={{ letterSpacing: "-0.2px" }}
                >
                  {selectedThread?.subject ?? "Loading…"}
                </h2>
                {selectedThread && (
                  <p className="text-[13px] font-[700] text-[#8b98ad] truncate" style={{ marginTop: "4px", lineHeight: "1.4" }}>
                    {selectedThread.messages && selectedThread.messages.length > 1
                      ? `${selectedThread.messages.length} messages`
                      : "1 message"}
                    {threadAiQuery.data?.aiCategory && GLANCE_CATEGORY_LABELS[threadAiQuery.data.aiCategory]
                      ? ` · ${GLANCE_CATEGORY_LABELS[threadAiQuery.data.aiCategory].label}`
                      : " · General"}
                    {(metaMap.get(selectedThreadId)?.isActionable ?? 1) === 1 ? " · Actionable" : " · Ignored"}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto shrink-0 max-w-[calc(100%-240px)]">
                {(() => {
                  const isCurrentIssue = (metaMap.get(selectedThreadId)?.isIssue ?? 0) === 1;
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "text-[12px] font-[700] gap-[5px] rounded-[10px] border-[#e5eaf2] bg-white shadow-[0_2px_8px_rgba(16,24,40,0.04)] hover:bg-[#f8fafc] hover:border-[#d7e0ec] transition-all duration-150 active:scale-95 text-[#243247] shrink-0",
                        isCurrentIssue
                          ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
                          : "bg-white"
                      )}
                      style={{ height: "30px", padding: "0 10px" }}
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
                  className="text-[12px] font-[700] gap-[5px] rounded-[10px] border-[#e5eaf2] bg-white shadow-[0_2px_8px_rgba(16,24,40,0.04)] hover:bg-[#f8fafc] hover:border-[#d7e0ec] transition-all duration-150 active:scale-95 text-[#243247] shrink-0" style={{ height: "30px", padding: "0 10px" }}
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
                      "text-[12px] font-[700] gap-[5px] rounded-[10px] shadow-[0_2px_8px_rgba(16,24,40,0.04)] transition-all duration-150 active:scale-95 shrink-0",
                      "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                    )}
                    style={{ height: "30px", padding: "0 10px" }}
                    onClick={() => {
                      if (!selectedThreadId) return;
                      resolveGlanceMutation.mutate({ threadId: selectedThreadId });
                      // Also mark as read if currently unread
                      if (selectedThread?.isUnread) {
                        setOptimisticThreadState((prev) => {
                          if (prev.has(selectedThreadId)) return prev;
                          return new Map(prev).set(selectedThreadId, true);
                        });
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
                          "text-[12px] font-[700] gap-[5px] rounded-[10px] shadow-[0_2px_8px_rgba(16,24,40,0.04)] transition-all duration-150 shrink-0",
                          threadAiQuery.data?.aiCategory && threadAiQuery.data.aiCategory !== "general"
                            ? "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 active:scale-95"
                            : "bg-white border-[#e5eaf2] hover:bg-[#f8fafc] hover:border-[#d7e0ec] text-[#243247] active:scale-95"
                        )}
                        style={{ height: "30px", padding: "0 10px" }}
                        disabled={recategorizeThreadMutation.isPending}
                        title="Set or change AI category"
                      >
                        {threadAiQuery.data?.aiCategory && GLANCE_CATEGORY_LABELS[threadAiQuery.data.aiCategory]
                          ? <><span>{GLANCE_CATEGORY_LABELS[threadAiQuery.data.aiCategory].emoji}</span> {GLANCE_CATEGORY_LABELS[threadAiQuery.data.aiCategory].label}</>
                          : <>Categorize</>}
                        <ChevronDown className="w-[14px] h-[14px] opacity-50 ml-auto" />
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
                            "text-[12px] font-[700] gap-[5px] rounded-[10px] shadow-[0_2px_8px_rgba(16,24,40,0.04)] transition-all duration-150 active:scale-95 shrink-0",
                            isAssigned
                              ? "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100"
                              : "bg-white border-[#e5eaf2] hover:bg-[#f8fafc] hover:border-[#d7e0ec] text-[#243247]"
                          )}
                          style={{ height: "30px", padding: "0 10px" }}
                          onClick={() => setAssignDropdownOpen(isOpen ? null : selectedThreadId)}
                        >
                          {isAssigned && currentMeta?.assignedToPhotoUrl ? (
                            <img src={currentMeta.assignedToPhotoUrl} alt={currentMeta.assignedToName ?? ""} className="w-3.5 h-3.5 rounded-full object-cover" />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5" />
                          )}
                          {isAssigned ? (currentMeta?.assignedToName?.split(" ")[0] ?? "Assigned") : "Assign"}
                          <ChevronDown className="w-[14px] h-[14px] opacity-50 ml-auto" />
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
                  className="text-[12px] font-[700] gap-[5px] rounded-[10px] border-[#e5eaf2] bg-white shadow-[0_2px_8px_rgba(16,24,40,0.04)] hover:bg-[#f8fafc] hover:border-[#d7e0ec] transition-all duration-150 active:scale-95 text-[#243247] shrink-0"
                  style={{ height: "30px", padding: "0 10px" }}
                  onClick={() => archiveMutation.mutate({ threadId: selectedThreadId })}
                  disabled={archiveMutation.isPending}
                >
                  {archiveMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Archive className="w-3.5 h-3.5" />}
                  Archive
                </Button>
                {/* Ignore sender button */}
                {selectedThread && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[12px] font-[700] gap-[5px] rounded-[10px] border-[#e5eaf2] bg-white shadow-[0_2px_8px_rgba(16,24,40,0.04)] hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-all duration-150 active:scale-95 text-[#243247] shrink-0" style={{ height: "30px", padding: "0 10px" }}
                    onClick={() => {
                      const fromEmail = selectedThread.fromEmail ?? "";
                      const fromName = selectedThread.from ?? fromEmail;
                      setIgnoreSenderType("domain");
                      setIgnoreSenderModal({ fromEmail, fromName });
                    }}
                    title="Ignore this sender (hide from inbox)"
                  >
                    <ShieldOff className="w-3.5 h-3.5 text-red-500" />
                    Ignore
                  </Button>
                )}
              </div>
            </div>

            {/* Messages — staggered entrance per card */}
            <div className="flex-1 overflow-y-auto bg-[#f3f5f9] [scrollbar-width:thin] [scrollbar-color:#dde3ee_transparent]">
              <div style={{ padding: "28px 52px 80px" }}>
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
                {selectedThread?.messages.map((msg, i) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.28), ...PANEL_TRANSITION }}
                  >
                    <MessageBubble msg={msg} />
                  </motion.div>
                ))}

                {/* Reply box */}
                {selectedThread && (
                  <div className="relative bg-white rounded-[22px] border border-[#e7edf5] shadow-[0_12px_30px_rgba(16,24,40,0.07)] overflow-hidden mb-4">
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
                    {/* Voice recording indicator — absolute overlay so it never shifts layout */}
                    <AnimatePresence>
                      {(voiceIsRecording || voiceIsPressing) && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.12 }}
                          className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-4 py-1.5 bg-red-50/95 backdrop-blur-sm border-b border-red-100 pointer-events-none"
                        >
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-xs font-semibold text-red-600">{voiceIsRecording ? `Recording… ${voiceSeconds}s` : "Starting…"}</span>
                          {voiceIsRecording && <span className="text-xs text-red-400">Release to transcribe</span>}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {/* AI improve panel — shown after transcription */}
                    <AnimatePresence>
                      {showVoiceImprove && replyMode === "reply" && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                          className="border-b border-slate-100 px-4 py-3 bg-slate-50"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <Wand2 className="w-3.5 h-3.5 text-violet-500" />
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">AI Improve</span>
                            <button
                              onClick={() => setShowVoiceImprove(false)}
                              className="ml-auto text-slate-300 hover:text-slate-500 transition"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex gap-2">
                            {(["friendly", "professional", "casual"] as const).map(tone => (
                              <button
                                key={tone}
                                disabled={voiceIsRewriting}
                                onClick={async () => {
                                  if (!replyText.trim() || voiceIsRewriting) return;
                                  setVoiceTone(tone);
                                  setVoiceIsRewriting(true);
                                  try {
                                    const result = await rewriteEmailMutation.mutateAsync({
                                      rawDraft: replyText,
                                      recipientName: selectedThread?.from?.split(" ")[0] ?? undefined,
                                      tone,
                                      context: threadQuery.data?.subject ?? undefined,
                                    });
                                    setReplyText(result.message);
                                  } catch {
                                    toast.error("Rewrite failed");
                                  } finally {
                                    setVoiceIsRewriting(false);
                                  }
                                }}
                                className={cn(
                                  "flex-1 rounded-xl py-1.5 text-xs font-semibold transition border",
                                  voiceTone === tone && !voiceIsRewriting
                                    ? "bg-slate-900 text-white border-slate-900"
                                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-900"
                                )}
                              >
                                {voiceIsRewriting && voiceTone === tone ? (
                                  <span className="flex items-center justify-center gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Rewriting…
                                  </span>
                                ) : (
                                  tone === "friendly" ? "😊 Friendly" : tone === "professional" ? "👔 Professional" : "💬 Casual"
                                )}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <Textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      className="border-0 rounded-none resize-none min-h-[105px] text-[15px] leading-relaxed text-slate-700 focus-visible:ring-0 px-[16px] py-[12px]"
                      placeholder={replyMode === "note" ? "Add an internal note…" : "Write a reply…"}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          if (replyMode === "reply") sendReply();
                        }
                      }}
                    />
                    <div className="flex items-center justify-between border-t border-slate-100 px-[12px] py-[12px]">
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
                              "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all duration-150",
                              "shadow-[0_4px_10px_rgba(16,24,40,0.04)]",
                              draftMutation.isPending
                                ? "text-violet-400 bg-violet-50 border-violet-200 cursor-not-allowed"
                                : "text-violet-600 bg-white border-[#e6ebf2] hover:border-violet-300 hover:bg-violet-50"
                            )}
                          >
                            {draftMutation.isPending
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Sparkles className="w-3.5 h-3.5" />}
                            {draftMutation.isPending ? "Drafting…" : "AI Draft"}
                          </button>
                        )}
                        {/* Voice-to-email PTT button */}
                        {replyMode === "reply" && (
                          <button
                            className={cn(
                              "shrink-0 h-8 w-8 rounded-full border-2 flex items-center justify-center transition-all select-none",
                              (voiceIsRecording || voiceIsPressing)
                                ? "border-red-500 bg-red-500 text-white scale-110"
                                : voiceIsTranscribing
                                ? "border-violet-300 bg-violet-50 text-violet-400 cursor-wait"
                                : "border-slate-200 bg-white hover:border-violet-400 hover:text-violet-600 text-slate-400"
                            )}
                            title="Hold to record voice reply"
                            disabled={voiceIsTranscribing}
                            onMouseDown={(e) => { e.preventDefault(); if (!voiceIsPttRef.current && !voiceIsTranscribing) { voiceIsPttRef.current = true; setVoiceIsPressing(true); startVoiceRecording(); } }}
                            onTouchStart={(e) => { e.preventDefault(); if (!voiceIsPttRef.current && !voiceIsTranscribing) { voiceIsPttRef.current = true; setVoiceIsPressing(true); startVoiceRecording(); } }}
                          >
                            {(voiceIsRecording || voiceIsPressing) ? (
                              <span className="w-2.5 h-2.5 rounded-full bg-white" />
                            ) : voiceIsTranscribing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Mic className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        {/* Template picker */}
                        <div className="relative">
                          <button
                            onClick={() => setShowTemplates((v) => !v)}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border border-[#e6ebf2] bg-white shadow-[0_4px_10px_rgba(16,24,40,0.04)] transition-all duration-150 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
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
                          className="h-[42px] rounded-[14px] bg-[#0f172a] hover:bg-[#1e293b] text-white font-[900] text-[14px] gap-1.5 px-5 shadow-[0_4px_10px_rgba(15,23,42,0.18)] transition-all duration-150 active:scale-95"
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
            </motion.div>
          )}
        </AnimatePresence>
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

      {/* Ignore sender modal */}
      {ignoreSenderModal && (
        <Dialog open onOpenChange={(open) => { if (!open) setIgnoreSenderModal(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base font-bold">Ignore sender</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-xs text-slate-500">
                Threads from this sender will be hidden from the default inbox view and excluded from the unread badge.
                You can still see them by toggling &ldquo;Show all&rdquo; in the sidebar.
              </p>
              {/* Type selector */}
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Ignore scope</label>
                <div className="flex gap-2">
                  {(["domain", "email"] as const).map((t) => {
                    const email = ignoreSenderModal.fromEmail;
                    const domain = email.includes("@") ? email.split("@")[1] : email;
                    return (
                      <button
                        key={t}
                        onClick={() => setIgnoreSenderType(t)}
                        className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                          ignoreSenderType === t
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                        }`}
                      >
                        {t === "domain" ? `All of ${domain}` : "This email only"}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-600">
                <span className="font-semibold">Will ignore:</span>{" "}
                {ignoreSenderType === "domain"
                  ? `All emails from @${ignoreSenderModal.fromEmail.includes("@") ? ignoreSenderModal.fromEmail.split("@")[1] : ignoreSenderModal.fromEmail}`
                  : ignoreSenderModal.fromEmail}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setIgnoreSenderModal(null)} className="text-xs">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const email = ignoreSenderModal.fromEmail;
                  const domain = email.includes("@") ? email.split("@")[1] : email;
                  upsertSenderPolicyMutation.mutate({
                    senderEmail: ignoreSenderType === "email" ? email : undefined,
                    senderDomain: ignoreSenderType === "domain" ? domain : undefined,
                    isActionable: 0,
                    label: `Ignored: ${ignoreSenderModal.fromName}`,
                  });
                }}
                disabled={upsertSenderPolicyMutation.isPending}
                className="text-xs gap-1.5 bg-amber-600 hover:bg-amber-700"
              >
                {upsertSenderPolicyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-4 h-4 text-red-500" />}
                Ignore sender
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

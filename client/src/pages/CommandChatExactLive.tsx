import { Fragment, FormEvent, memo, type ReactNode, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CommandChatEmailDetail from "./CommandChatEmailDetail";
import {
  Activity,
  AlertTriangle,
  AudioLines,
  Bell,
  CalendarClock,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleDollarSign,
  ClipboardList,
  Copy,
  Eye,
  Heart,
  Headphones,
  Home,
  MapPin,
  Mail,
  MessageCircle,
  Loader2,
  Megaphone,
  MessageSquare,
  Mic,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Send,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Users,
  X,
  Zap,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { proxyRecordingUrl } from "@/lib/utils";
import { useOpsStream } from "@/hooks/useOpsStream";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { useTabLeader } from "@/hooks/useTabLeader";
import { IssueEngineOverlay } from "@/components/IssueEngineOverlay";
import AllThreadsPanel from "@/components/AllThreadsPanel";
import AiConcierge from "@/components/AiConcierge";
import { getCsInboxReplyPhoneNumberIdForSelectedConversation } from "@shared/csInboxPhoneNumberRouting";
import "./command-chat-crm-review.css";
import "./command-chat-left-cohesion.css";
import "./command-chat-lead-queue.css";
import "./command-chat-lead-portraits.css";
import "./command-chat-conversation-list.css";
import "./command-chat-palette-balance.css";
import "./command-chat-group-conversation.css";
import "./command-chat-bubble-composition.css";
import "./command-chat-reference-composition.css";
import "./command-chat-header-composition.css";
import "./command-chat-exact-live.css";

type ModalKind = "issue" | "reminder" | "pin" | "booking" | null;
type ChannelKey = "command" | "urgent" | "dispatch" | "general" | "cleaners";
type ChannelMessage = {
  id: number;
  ts: number;
  from: string;
  role: "office" | "agent" | "system";
  body: string;
  mediaUrl: string | null;
  quickAction: string | null;
  metadata: string | null;
  replyToId: number | null;
  replyToBody: string | null;
  replyToAuthor: string | null;
  threadParentId: number | null;
  threadParentBody: string | null;
  threadParentFrom: string | null;
  replyCount: number;
};

type QuoteReplyTarget = {
  id: number;
  body: string;
  author: string;
};

type CommandLead = {
  id: number;
  sessionId: number | null;
  name: string;
  sourceLabel: string;
  detail: string;
  phone: string | null;
  address: string | null;
  claimedBy: string | null;
  isBooked: boolean;
  bookedByAgentName: string | null;
  priceLabel: string | null;
  ts: number;
  queue: "web" | "incoming";
  serviceType: string | null;
  location: string | null;
  requestedDates: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  homeSize: string | null;
  rooms: string | null;
  propertyType: string | null;
  frequency: string | null;
  extras: string[];
  summary: string | null;
  description: string | null;
  negotiationId: string | null;
  requestId: string | null;
  customerId: string | null;
  category: string | null;
  categoryId: string | null;
  pets: string | null;
  travelPreferences: string[];
  nativeDetails: Array<{ question?: string; answer?: string }>;
  proposedTimes: Array<{ start?: string; end?: string }>;
  status: string | null;
  leadPrice: string | null;
  leadPriceBreakdown: unknown;
  estimate: unknown;
  createdAt: string | null;
  requestReviewLink: string | null;
  refundRequestLink: string | null;
  attachments: unknown[];
  messageId: number | null;
};

type NativeThumbtackLead = Omit<CommandLead, "id" | "sourceLabel" | "detail" | "priceLabel" | "ts" | "queue">;

type ConfirmationReplyAlert = {
  intent: "cancellation" | "unclear";
  customerName: string;
  serviceDate: string | null;
  replyText: string;
  replyUrl: string | null;
};

type IncomingCallHandoff = {
  vapiCallId: string | null;
  callerName: string;
  callerPhone: string | null;
  durationSeconds: number | null;
  outcome: string;
  recordingUrl: string | null;
};

type SmsInboxConversation = {
  id: number;
  leadName: string | null;
  leadPhone: string | null;
  leadSource: string | null;
  lastMessageText: string | null;
  lastMsgTs: number | null;
  lastMessageTs: number | null;
  lastSenderRole: string | null;
  hasUnanswered: boolean;
  aiSummary: string | null;
  personType: "team" | "customer";
  lastInboundPhoneNumberId: string | null;
};

type SmsInboxMessage = {
  role: string;
  content: string;
  ts?: number;
  senderName?: string;
};

type QuoteAssistantFields = {
  bedrooms: string | null;
  bathrooms: string | null;
  serviceType: string | null;
  condition: number | null;
  extras: Array<{ id: string; quantity: number }> | null;
  extrasConfirmed?: boolean;
};

const QUOTE_EXTRA_OPTIONS = [
  ["inside-cabinets", "Inside Cabinets"],
  ["inside-fridge", "Inside Fridge"],
  ["inside-oven", "Inside Oven"],
  ["interior-windows", "Interior Windows"],
  ["basement", "Basement"],
  ["organizing-hour", "Organizing"],
  ["laundry-load", "Laundry"],
  ["wipe-walls-room", "Wipe Walls"],
  ["sweep-garage", "Sweep Garage"],
] as const;

const QUOTE_EXTRA_ICONS: Record<string, string> = {
  "inside-cabinets": "🗄️",
  "inside-fridge": "🧊",
  "inside-oven": "🍳",
  "interior-windows": "🪟",
  basement: "🏠",
  "organizing-hour": "🧺",
  "laundry-load": "🧺",
  "wipe-walls-room": "🧽",
  "sweep-garage": "🚗",
};

type EmailInboxThread = {
  threadId: string;
  senderName: string | null;
  senderEmail: string | null;
  subject: string;
  snippet: string;
  lastMessageAt: number;
  messageCount: number;
  isUnread: boolean;
};


type TeamSmsStreamEvent = {
  id: string;
  sessionId: number;
  name: string;
  body: string;
  ts: number;
};

type CommandTimelineEntry =
  | { kind: "internal"; id: string; ts: number; message: ChannelMessage }
  | { kind: "team-sms"; id: string; ts: number; event: TeamSmsStreamEvent };

type VoiceCallerIdentity = {
  callerName: string | null;
  callerPhone: string | null;
};

const CHANNELS: Array<{ key: ChannelKey; label: string; icon: string; tone: string }> = [
  { key: "command", label: "MIB Command", icon: "✦", tone: "neutral" },
  { key: "urgent", label: "Urgent", icon: "!", tone: "amber" },
  { key: "dispatch", label: "Dispatch / Today", icon: "#", tone: "blue" },
  { key: "general", label: "General", icon: "#", tone: "neutral" },
  { key: "cleaners", label: "Team updates", icon: "#", tone: "teal" },
];

const ISSUE_TYPES = [
  ["internal_task", "Internal task"],
  ["access_problem", "Access problem"],
  ["late_team", "Team late"],
  ["refund_request", "Refund request"],
  ["payment_problem", "Payment problem"],
  ["other", "Other"],
] as const;

const AWAY_STATUSES = [
  { key: "away_sec", label: "Away for a sec", sub: "Quick break", emoji: "☕", tone: "amber" },
  { key: "lunch", label: "Lunch break", sub: "Quick munch", emoji: "🍔", tone: "green" },
  { key: "back15", label: "Back in 15", sub: "Short defined break", emoji: "⏰", tone: "indigo" },
  { key: "eod", label: "Signing off", sub: "End of day", emoji: "🌙", tone: "blue" },
] as const;
type AwayStatus = (typeof AWAY_STATUSES)[number]["key"] | null;
const HIDDEN_COMMAND_QUICK_ACTIONS = [
  "new_lead",
  "escalation_nudge",
  "call_summary",
  "call_ended",
  "call_debrief",
  "missed_call",
  "madison_sms_draft",
  "madison_email_draft",
  "madison_auto_sent",
] as const;
const CUSTOMER_PORTRAITS = [
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/gUCwvRBUvWDZUkGx.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ypcLWxzXhQzCCWcC.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/CucZtKJOfkDlJvMg.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bCfFsxIPapKjJReA.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bvdqcqtPZSJhgtqq.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/VjRgwvLUkGAKxnVA.png",
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/qRwiNDAHRQQTxPbz.png",
] as const;
const VOICE_HANDOFF_BARS = [42, 78, 57, 88, 49, 68, 91, 61, 76, 45, 70, 83, 54, 66, 79, 51, 87, 47, 72, 59, 82, 53, 74, 64, 46, 77, 55, 84, 50, 69, 80, 58, 73, 48, 86, 62, 75, 56, 81, 52, 67, 89, 60, 74, 44, 65, 78, 54, 71, 46, 63, 80, 52, 68, 43, 75, 57, 82, 48, 65] as const;

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "MI";
}

function formatTime(value: number) {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelative(value: number) {
  const delta = Math.max(0, Date.now() - value);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return dateLabel(value);
}

function formatPhoneDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10 ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : value;
}

function quoteAssistantLeadFacts(lead: CommandLead | null) {
  if (!lead) return "";
  return [
    `Name: ${lead.name}`,
    lead.serviceType && `Service: ${lead.serviceType}`,
    lead.bedrooms && `Bedrooms: ${lead.bedrooms}`,
    lead.bathrooms && `Bathrooms: ${lead.bathrooms}`,
    lead.propertyType && `Property type: ${lead.propertyType}`,
    lead.frequency && `Frequency: ${lead.frequency}`,
    lead.extras.length ? `Extras: ${lead.extras.join(", ")}` : null,
    lead.address && `Address: ${lead.address}`,
    lead.summary && `Summary: ${lead.summary}`,
    lead.description && `Description: ${lead.description}`,
    lead.detail && `Lead details: ${lead.detail}`,
  ].filter((value): value is string => Boolean(value)).join("\n");
}

function firstName(value: string | null) {
  return value?.trim().split(/\s+/)[0] || "Claimed";
}

function nextQuoteDate() {
  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function quoteServiceId(value: string | null): "standard" | "deep" | "moveout" {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("deep")) return "deep";
  if (normalized.includes("move")) return "moveout";
  return "standard";
}

function quoteHomeType(value: string | null): "House" | "Apartment" | "Townhome" | "Condo" {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("apartment") || normalized.includes("flat")) return "Apartment";
  if (normalized.includes("town")) return "Townhome";
  if (normalized.includes("condo")) return "Condo";
  return "House";
}

function quoteRequestedTime(lead: CommandLead | null) {
  const proposed = lead?.proposedTimes?.[0]?.start;
  if (proposed) {
    const parsed = new Date(proposed);
    if (!Number.isNaN(parsed.getTime())) {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(parsed);
      const hour = Number(parts.find((part) => part.type === "hour")?.value);
      if (Number.isFinite(hour) && hour >= 7 && hour < 20) {
        return new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(parsed);
      }
    }
  }
  return "10:30";
}

function dateLabel(value: number) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function bookingDateLabel(date: string, businessDate: string) {
  if (date === businessDate) return "Today";
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function scheduleTimeLabel(value: string | number | null) {
  if (value == null) return "Time pending";
  const time = typeof value === "number" ? value : new Date(value).getTime();
  if (!Number.isFinite(time)) return "Time pending";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(time));
}

function teamRouteStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "on_the_way": return "On the way";
    case "arrived": return "Arrived";
    case "running_late": return "Running late";
    case "in_progress": return "In progress";
    case "completed": return "Completed";
    case "issue_at_property": return "Issue at property";
    default: return "Scheduled";
  }
}

function teamRouteStatusClass(status: string | null | undefined) {
  switch (status) {
    case "on_the_way": return "is-on-the-way";
    case "arrived": return "is-arrived";
    case "running_late": return "is-running-late";
    case "in_progress": return "is-in-progress";
    case "completed": return "is-completed";
    case "issue_at_property": return "is-issue";
    default: return "is-scheduled";
  }
}

function TeamRouteStatusIcon({ status }: { status: string | null | undefined }) {
  switch (status) {
    case "on_the_way": return <CarFront aria-hidden="true" />;
    case "completed": return <CircleCheck aria-hidden="true" />;
    case "arrived": return <MapPin aria-hidden="true" />;
    case "running_late": return <AlertTriangle aria-hidden="true" />;
    case "in_progress": return <Activity aria-hidden="true" />;
    case "issue_at_property": return <AlertTriangle aria-hidden="true" />;
    default: return <CalendarClock aria-hidden="true" />;
  }
}

function teamRouteEtaLabel(status: string | null | undefined, etaTimestamp: number | null | undefined) {
  if (status !== "on_the_way" || etaTimestamp == null) return null;
  return `ETA ${scheduleTimeLabel(etaTimestamp)}`;
}

function mediaUrls(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [value];
  }
}

function commandAttachmentUrl(url: string) {
  return url.includes(".r2.dev/") ? `/api/media-proxy?url=${encodeURIComponent(url)}` : url;
}

function commandPresenceStatus(agent: { lastSeenAt: number | null; awayStatus: string | null; onCallSince: number | null }, now: number) {
  if (agent.onCallSince) return "on-call" as const;
  if (agent.awayStatus) return "away" as const;
  if (!agent.lastSeenAt) return "offline" as const;
  const inactiveMinutes = Math.floor((now - agent.lastSeenAt) / 60_000);
  if (inactiveMinutes <= 2) return "online" as const;
  if (inactiveMinutes <= 15) return "away" as const;
  return "offline" as const;
}

function customerPortraitFor(value: string) {
  const total = Array.from(value).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return CUSTOMER_PORTRAITS[Math.abs(total) % CUSTOMER_PORTRAITS.length];
}

function smsInboxTimestamp(conversation: SmsInboxConversation) {
  return conversation.lastMsgTs ?? conversation.lastMessageTs ?? 0;
}

function smsConversationName(conversation: SmsInboxConversation) {
  return conversation.leadName?.trim() || (conversation.personType === "team" ? "Team message" : "Customer conversation");
}

function emailThreadName(thread: Pick<EmailInboxThread, "senderName" | "senderEmail">) {
  return thread.senderName?.trim() || thread.senderEmail?.trim() || "Email conversation";
}

function emailThreadSubject(subject: string | null | undefined) {
  return (subject ?? "").replace(/^\[From:[^\]]*\]\s*/i, "").trim() || "(no subject)";
}

function confirmationReplyFromMessage(message: ChannelMessage): ConfirmationReplyAlert | null {
  if (message.role !== "system" || !message.from.includes("Customer SMS Reply")) return null;
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(message.metadata ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const intent = metadata.intent === "cancellation" ? "cancellation" : metadata.intent === "unclear" ? "unclear" : null;
  if (!intent) return null;
  const titleLine = message.body.split("\n").find((line) => /\*\*(?:Cancellation Request|Unclear SMS Reply)\*\*/i.test(line));
  const subject = titleLine?.match(/\*\*(?:Cancellation Request|Unclear SMS Reply)\*\*\s*—\s*(.*)$/i)?.[1]?.trim() || "Customer";
  const dateMatch = subject.match(/\s+\((\d{4}-\d{2}-\d{2})\)\s*$/);
  const customerName = (dateMatch ? subject.slice(0, dateMatch.index) : subject).trim() || "Customer";
  const replyText = message.body.split("\n").find((line) => line.trim().startsWith(">"))?.replace(/^\s*>\s*/, "").replace(/^"|"$/g, "").trim() || "No reply text recorded.";
  return { intent, customerName, serviceDate: dateMatch?.[1] ?? null, replyText, replyUrl: /^https?:\/\/\S+$/i.test(replyText) ? replyText : null };
}

function callHandoffFromMessage(message: ChannelMessage): IncomingCallHandoff | null {
  if (message.quickAction !== "madison_call_summary") return null;
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(message.metadata ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch {
    // The persisted stream entry remains available even when legacy metadata is malformed.
  }
  const firstBodyLine = message.body.split("\n").find(Boolean)?.trim();
  const bodyIdentity = firstBodyLine?.split(" · ").map((value) => value.trim()).filter(Boolean) ?? [];
  const bodyName = bodyIdentity[0] ?? null;
  const bodyPhone = bodyIdentity[1] ?? null;
  const callerName = typeof metadata.callerName === "string" && metadata.callerName.trim()
    ? metadata.callerName.trim()
    : bodyName || "Incoming caller";
  const callerPhone = typeof metadata.callerPhone === "string" && metadata.callerPhone.trim()
    ? metadata.callerPhone.trim()
    : bodyPhone;
  const vapiCallId = typeof metadata.vapiCallId === "string" && metadata.vapiCallId.trim()
    ? metadata.vapiCallId.trim()
    : null;
  const durationSeconds = typeof metadata.durationSeconds === "number" ? metadata.durationSeconds : null;
  const outcome = typeof metadata.outcome === "string" && metadata.outcome.trim() ? metadata.outcome : "completed";
  const recordingUrl = typeof metadata.recordingUrl === "string" ? metadata.recordingUrl : mediaUrls(message.mediaUrl)[0] ?? null;
  return { vapiCallId, callerName, callerPhone, durationSeconds, outcome, recordingUrl };
}

function leadFromCommandMessage(message: ChannelMessage): CommandLead | null {
  if (message.quickAction !== "new_lead") return null;
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(message.metadata ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch {
    // Retain the source message as a safe, generic incoming lead when legacy metadata is malformed.
  }
  const getText = (key: string) => typeof metadata[key] === "string" ? metadata[key] : "";
  const source = getText("source") || getText("utmSource");
  const sourceKey = source.trim().toLowerCase();
  const isWebOrQuoteForm = !sourceKey || ["widget", "widget-popup", "webform", "quoteform", "quote_form"].includes(sourceKey);
  const isIncoming = !isWebOrQuoteForm;
  const sourceLabel = isIncoming
    ? (source.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || message.from.replace(/^[^A-Za-z0-9]+/, "") || "Incoming lead")
    : (sourceKey === "widget" || sourceKey === "widget-popup" ? "Web form" : "Quote form");
  const name = getText("leadName") || "New lead";
  const rawPrice = metadata.price === undefined || metadata.price === null || metadata.price === "" ? "" : String(metadata.price);
  const priceLabel = rawPrice ? (rawPrice.startsWith("$") ? rawPrice : `$${rawPrice}`) : null;
  const detail = [getText("serviceType"), getText("size")].filter(Boolean).join(" · ") || "New inquiry";
  const phone = getText("leadPhone").trim() || null;
  const address = getText("serviceAddress").trim() || getText("address").trim() || null;
  const claimedBy = getText("claimedBy").trim() || null;
  const serviceType = getText("serviceType").trim() || null;
  const location = getText("location").trim() || address;
  const requestedDates = getText("requestedDates").trim() || getText("requestedDate").trim() || null;
  const bedrooms = getText("bedrooms").trim() || null;
  const bathrooms = getText("bathrooms").trim() || null;
  const rooms = getText("rooms").trim() || null;
  const propertyType = getText("propertyType").trim() || null;
  const frequency = getText("frequency").trim() || null;
  const extras = Array.isArray(metadata.extras) ? metadata.extras.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const summary = getText("summary").trim() || getText("description").trim() || null;
  const rawSessionId = metadata.sessionId;
  const parsedSessionId = typeof rawSessionId === "number" ? rawSessionId : typeof rawSessionId === "string" && /^\d+$/.test(rawSessionId) ? Number(rawSessionId) : null;
  const sessionId = parsedSessionId !== null && Number.isSafeInteger(parsedSessionId) && parsedSessionId > 0 ? parsedSessionId : null;
  return { id: message.id, sessionId, name, sourceLabel, detail, phone, address, claimedBy, isBooked: false, bookedByAgentName: null, priceLabel, ts: message.ts, queue: isIncoming ? "incoming" : "web", serviceType, location, requestedDates, bedrooms, bathrooms, homeSize: null, rooms, propertyType, frequency, extras, summary, description: null, negotiationId: null, requestId: null, customerId: null, category: null, categoryId: null, pets: null, travelPreferences: [], nativeDetails: [], proposedTimes: [], status: null, leadPrice: null, leadPriceBreakdown: null, estimate: null, createdAt: null, requestReviewLink: null, refundRequestLink: null, attachments: [], messageId: null };
}

function normalizedLeadPhone(value: string | null) {
  return value?.replace(/\D/g, "").slice(-10) || "";
}

function displayLeadSource(source: string | null | undefined) {
  const normalized = source?.trim().toLowerCase() ?? "";
  if (!normalized || ["form", "quote", "quoteform", "quote_form", "widget", "widget-popup", "webform"].includes(normalized)) return "Quote";
  if (normalized.includes("thumbtack")) return "Thumbtack";
  if (normalized === "bark") return "Bark.com";
  if (normalized === "yelp") return "Yelp";
  if (normalized === "email") return "Email";
  return normalized.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nativeValue(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function leadNamesMatch(legacyName: string, nativeName: string) {
  const legacyParts = legacyName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const nativeParts = nativeName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (legacyParts.length < 2 || nativeParts.length < 2) return false;
  return legacyParts[0] === nativeParts[0]
    && (legacyParts[1] === nativeParts[1] || legacyParts[1][0] === nativeParts[1][0]);
}

function leadForConversation(conversation: SmsInboxConversation, leads: CommandLead[]) {
  if (conversation.personType === "team") return null;
  const phone = normalizedLeadPhone(conversation.leadPhone);
  const name = conversation.leadName?.trim().toLowerCase() ?? "";
  const matched = leads.find((lead) => (
    (conversation.id > 0 && lead.sessionId === conversation.id)
    || (phone && normalizedLeadPhone(lead.phone) === phone)
    || (name && (lead.name.trim().toLowerCase() === name || leadNamesMatch(name, lead.name)))
  ));
  if (matched) return matched;
  return {
    id: conversation.id,
    sessionId: conversation.id > 0 ? conversation.id : null,
    name: conversation.leadName?.trim() || "Customer conversation",
    sourceLabel: displayLeadSource(conversation.leadSource),
    detail: "Conversation",
    phone: conversation.leadPhone,
    address: null,
    claimedBy: null,
    isBooked: false,
    bookedByAgentName: null,
    priceLabel: null,
    ts: smsInboxTimestamp(conversation) || Date.now(),
    queue: displayLeadSource(conversation.leadSource) === "Thumbtack" ? "incoming" as const : "web" as const,
    serviceType: null,
    location: null,
    requestedDates: null,
    bedrooms: null,
    bathrooms: null,
    homeSize: null,
    rooms: null,
    propertyType: null,
    frequency: null,
    extras: [],
    summary: null,
    description: null,
    negotiationId: null,
    requestId: null,
    customerId: null,
    category: null,
    categoryId: null,
    pets: null,
    travelPreferences: [],
    nativeDetails: [],
    proposedTimes: [],
    status: null,
    leadPrice: null,
    leadPriceBreakdown: null,
    estimate: null,
    createdAt: null,
    requestReviewLink: null,
    refundRequestLink: null,
    attachments: [],
    messageId: null,
  } satisfies CommandLead;
}

function mergeNativeThumbtackLead(lead: CommandLead, nativeLeads: NativeThumbtackLead[]) {
  if (lead.queue !== "incoming") return lead;
  const leadPhone = normalizedLeadPhone(lead.phone);
  const leadName = lead.name.trim().toLowerCase();
  const native = nativeLeads.find((candidate) => (
    (leadPhone && normalizedLeadPhone(candidate.phone) === leadPhone)
    || (leadName && (candidate.name.trim().toLowerCase() === leadName || leadNamesMatch(leadName, candidate.name)))
  ));
  if (!native) return lead;
  return {
    ...lead,
    ...native,
    id: lead.id,
    sourceLabel: "Thumbtack",
    detail: [native.serviceType, native.homeSize].filter(Boolean).join(" · ") || lead.detail,
    claimedBy: lead.claimedBy,
    priceLabel: native.leadPrice ? native.leadPrice : lead.priceLabel,
    ts: lead.ts,
    queue: lead.queue,
  };
}

function leadHref(lead: CommandLead) {
  return lead.sessionId ? `/admin/leads?leadId=${lead.sessionId}` : `/admin/leads?search=${encodeURIComponent(lead.name)}`;
}

function nativeMatchesLead(lead: CommandLead, native: NativeThumbtackLead) {
  const phoneMatches = Boolean(normalizedLeadPhone(lead.phone) && normalizedLeadPhone(lead.phone) === normalizedLeadPhone(native.phone));
  const nameMatches = lead.name.trim().toLowerCase() === native.name.trim().toLowerCase() || leadNamesMatch(lead.name, native.name);
  return phoneMatches || nameMatches;
}

function nativeLeadToCommandLead(native: NativeThumbtackLead): CommandLead {
  const fallbackId = -Math.abs(native.negotiationId.split("").reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0));
  return {
    ...native,
    id: native.messageId ?? fallbackId,
    sourceLabel: "Thumbtack",
    detail: [native.serviceType, native.homeSize].filter(Boolean).join(" · ") || "New inquiry",
    claimedBy: native.claimedBy,
    priceLabel: native.leadPrice,
    ts: native.createdAt ? Date.parse(native.createdAt) : Date.now(),
    queue: "incoming",
  };
}

const THUMBTACK_FIRST_RESPONSE_PROMPT = `You write first-response texts for inbound cleaning leads (Thumbtack and similar) for Maids in Black, a house cleaning business serving the DMV. I will paste a lead. Reply with ONLY the copy-paste message, with no notes, commentary, or explanations before or after it.

Voice: warm, upbeat, friendly. Sign as Madison from Maids in Black. No em dashes.

Structure:

1. Greeting: "Hey [first name]! 👋 Madison from Maids in Black here. Happy to help [get/keep] your [X]bd/[X]ba [home type] [fresh/fully refreshed/spotless]!" Match the line to the cleaning type (move out: spotless for your move out; move in: spotless before you move in; post-construction: fresh after the construction; recurring: keep fresh).
2. Middle paragraph, in this order:
   - Name the cleaning type and list ONLY the extras they selected (fridge, oven, interior windows, baseboards, cabinets, laundry, basement).
   - Address anything specific in their message (skipped rooms, special requests, organizing, builder restrictions). If something is unusual or unclear, say we'll confirm it when we send pricing.
   - If the frequency is recurring: "[Weekly/Every 2 weeks/Monthly] is a great routine for keeping the home consistently fresh, and recurring clients get our best rate."
   - "We've cleaned hundreds of homes in [city], and our whole team is background checked and insured, so you can feel completely comfortable having us in your space."
   - If pets: "Pets are no problem at all."
3. Close: ask them to send their phone number so we can text a quote and time options (Thumbtack's routing number can be unreliable). Otherwise ask: "Want me to check our team's availability [for their dates] and text you a couple of time options, or send pricing first?"

Rules:

- Never offer to call the customer. No one is available to call.
- If their dates are today or this week, acknowledge the timing ("Since you're looking at this week..."). If they have a deadline, say we'll do our best to get them on the schedule before it.
- We price by the home, not by the hour. Say so if they ask about hourly rates.
- Never include time estimates or how long the clean will take.
- If their form details conflict with their message (for example, different bedroom counts), ask them to confirm instead of guessing.
- Keep it short: a greeting, a concise middle section, and a one-line close.
- Look through the customer's notes, request details, home information, and selected extras for opportunities to make the message clearer with a short emoji-bullet list. Prefer emoji bullets whenever there is a natural opportunity to clearly present two or more concrete details, requested tasks, special requests, or included services, such as 2 bedrooms and 2 bathrooms, inside cabinets, fridge and oven cleaning, laundry, interior windows, baseboards, skipped rooms, organizing, or builder restrictions. You may combine related home facts and requested services in one concise list when that makes the lead easier to scan. Do not force bullets into every message, do not create an awkward list, and do not invent requests the customer did not make. If bullets would not improve clarity, write the information naturally in the paragraph.
- When a bullet list is appropriate, put each concrete detail or task on its own line and use a specific, relevant emoji such as 🛏️ for bedrooms, 🛁 for bathrooms, 🍳 for fridge/oven, 🧺 for laundry, 🪟 for windows, ✨ for baseboards or cabinets, and 🧹 for cleaning tasks. Keep the bullets together as one clean list, then follow them with the personalized details and reassurance paragraph. Do not compress a multi-item request into a comma-separated sentence.

Example target style:

Hey Peter! 👋 Madison from Maids in Black here. Happy to help get your new 5bd/4ba Frederick home spotless before the furniture comes in!

Here’s what your move in deep clean would include:

🗄️ Cabinets and drawers, inside and out
🍳 Fridge, oven, dishwasher, and microwave
🪟 Window sills and tracks
✨ Baseboards and light fixtures
🧹 Vacuuming and mopping on all three levels

We price by the home instead of by the hour, so you get one clear total, and we’ll size the team to your 4,300 sq ft. Our whole team is background checked and insured, and we’ve cleaned hundreds of homes in Frederick.

Could you send over your phone number? We’ll text you a quote and availability for Oct 30 or 31 right away.`;

function buildThumbtackLeadDraftContext(lead: CommandLead): string {
  const details = lead.nativeDetails
    .map((detail) => `${detail.question ?? "Request detail"}: ${detail.answer ?? ""}`)
    .filter((detail) => !detail.endsWith(": "))
    .join("\n");
  return [
    `Lead name: ${lead.name}`,
    `Cleaning type: ${lead.serviceType ?? lead.category ?? "House cleaning"}`,
    `Location: ${lead.address ?? lead.location ?? "Not provided"}`,
    `Requested dates/times: ${lead.requestedDates ?? "Not provided"}`,
    `Bedrooms: ${lead.bedrooms ?? "Not provided"}`,
    `Bathrooms: ${lead.bathrooms ?? "Not provided"}`,
    `Home information: ${lead.homeSize ?? lead.rooms ?? lead.propertyType ?? "Not provided"}`,
    `Frequency: ${lead.frequency ?? "Not provided"}`,
    `Selected extras: ${lead.extras.length ? lead.extras.join(", ") : "None listed"}`,
    `Pets: ${lead.pets ?? "Not provided"}`,
    `Customer request/description: ${lead.description ?? lead.summary ?? "Not provided"}`,
    `Travel preferences: ${lead.travelPreferences.length ? lead.travelPreferences.join(", ") : "None listed"}`,
    `Proposed times: ${lead.proposedTimes.length ? JSON.stringify(lead.proposedTimes) : "None listed"}`,
    details ? `All retained Thumbtack request fields:\n${details}` : "",
  ].filter(Boolean).join("\n");
}

function isHiddenCommandNotification(message: ChannelMessage) {
  if (HIDDEN_COMMAND_QUICK_ACTIONS.includes(message.quickAction as (typeof HIDDEN_COMMAND_QUICK_ACTIONS)[number])) return true;
  if (message.quickAction === "sync_watchdog") return true;
  if (message.role === "system" && /\bSync Alert\b/i.test(message.body)) return true;
  return message.quickAction === "unanswered_alarm" && /new .*lead/i.test(message.body);
}

function isServiceAlert(message: ChannelMessage) {
  if (message.role !== "system") return false;
  return message.quickAction === "post_start_overdue"
    || message.quickAction === "possible_noshow"
    || /\bno\s*-?\s*check-?in\b/i.test(message.body);
}

function Avatar({ name, photoUrl, className = "" }: { name: string; photoUrl?: string | null; className?: string }) {
  return photoUrl ? <img className={className} src={photoUrl} alt={`${name} profile`} /> : <span className={className}>{initials(name)}</span>;
}

function leadCardConversation(lead: CommandLead, smsInbox: SmsInboxConversation[]) {
  const phone = normalizedLeadPhone(lead.phone);
  const name = lead.name.trim().toLowerCase();
  return smsInbox.find((conversation) => (
    (lead.sessionId !== null && conversation.id === lead.sessionId)
    || (phone && normalizedLeadPhone(conversation.leadPhone) === phone)
    || (name && conversation.leadName?.trim().toLowerCase() === name)
  )) ?? null;
}

function leadCardStatus(lead: CommandLead, smsInbox: SmsInboxConversation[]) {
  if (lead.isBooked) return { kind: "booked", label: "Booked", ts: lead.ts } as const;
  const conversation = leadCardConversation(lead, smsInbox);
  if (!conversation) return { kind: "new", label: "New", ts: lead.ts } as const;
  const replied = conversation.lastSenderRole === "user" || conversation.hasUnanswered;
  const ts = conversation.lastMessageTs ?? conversation.lastMsgTs ?? lead.ts;
  return replied
    ? { kind: "replied", label: "Replied", ts } as const
    : conversation.lastSenderRole === "assistant"
      ? { kind: "texted", label: "Texted", ts } as const
      : { kind: "new", label: "New", ts } as const;
}

function LeadQueue({ title, description, leads, smsInbox, claimPending, bookingPending, onClaim, onMarkBooked, onOpenSms }: { title: string; description: string; leads: CommandLead[]; smsInbox: SmsInboxConversation[]; claimPending: boolean; bookingPending: boolean; onClaim: (lead: CommandLead) => void; onMarkBooked: (lead: CommandLead) => void; onOpenSms: (lead: CommandLead) => void }) {
  const orderedLeads = [...leads].sort((a, b) => b.ts - a.ts);
  const [selectedLead, setSelectedLead] = useState<CommandLead | null>(null);
  useEffect(() => {
    setSelectedLead((current) => current ? leads.find((lead) => lead.id === current.id) ?? current : current);
  }, [leads]);
  const copyPhone = (phone: string) => { void navigator.clipboard?.writeText(phone); };
  const renderLeadCard = (lead: CommandLead) => { const status = leadCardStatus(lead, smsInbox); return <section className={`ccc-live-lead-primary${lead.claimedBy ? "" : " is-unclaimed"}${status.kind === "booked" ? " is-booked" : ""}`} key={lead.id} role="button" tabIndex={0} onClick={() => setSelectedLead(lead)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedLead(lead); } }}>
    <div className="ccc-live-lead-primary-identity"><img src={customerPortraitFor(lead.name)} alt={`Client portrait illustration for ${lead.name}`} /><span><strong>{lead.name}</strong><small>{lead.queue === "web" ? `Quote requested · ${lead.sourceLabel}` : `${lead.sourceLabel} · ${lead.detail}`}</small><em className={`is-${status.kind}`}><i /> <span>{status.label}</span><time>{formatRelative(status.ts)}</time></em></span>{lead.priceLabel && <b>{lead.priceLabel}</b>}</div>
    {lead.phone && <div className="ccc-live-lead-primary-contact"><span><Phone />{formatPhoneDisplay(lead.phone)}</span><div><button type="button" aria-label={`Copy ${lead.name} phone`} title="Copy phone" onClick={(event) => { event.stopPropagation(); copyPhone(lead.phone!); }}><Copy /></button><button type="button" aria-label={`Open text conversation with ${lead.name}`} title="Open text conversation" onClick={(event) => { event.stopPropagation(); onOpenSms(lead); }}><MessageSquare /></button><a href={`tel:${lead.phone}`} aria-label={`Call ${lead.name}`} onClick={(event) => event.stopPropagation()}><Phone /></a></div></div>}
    {lead.location && <p className="ccc-live-lead-primary-detail"><MapPin />{lead.location}</p>}
    <p className="ccc-live-lead-primary-detail"><Sparkles />{lead.serviceType || lead.detail}</p>
    <div className="ccc-live-lead-chip-row">{[lead.requestedDates, lead.bedrooms && lead.bathrooms ? `${lead.bedrooms} Bed · ${lead.bathrooms} Bath` : lead.rooms, lead.frequency].filter(Boolean).map((value) => <span key={value}>{value}</span>)}</div>
    <footer><button type="button" className={lead.claimedBy ? "is-claimed ccc-live-lead-claim-pill" : "ccc-live-lead-claim-pill"} title={lead.claimedBy ? `Claimed by ${lead.claimedBy}` : "Claim lead"} aria-label={lead.claimedBy ? `Claimed by ${lead.claimedBy}` : "Claim lead"} disabled={Boolean(lead.claimedBy) || claimPending} onClick={(event) => { event.stopPropagation(); onClaim(lead); }}>{lead.claimedBy ? <><Check />{firstName(lead.claimedBy)}</> : <><Users />Claim</>}</button><button type="button" className={lead.isBooked ? "is-booked" : ""} disabled={lead.isBooked || bookingPending || !lead.sessionId} onClick={(event) => { event.stopPropagation(); onMarkBooked(lead); }}>{lead.isBooked ? <><Check />Booked</> : "Book"}</button><button type="button" className="ccc-live-lead-view-button ccc-live-lead-view-icon" aria-label={`View details for ${lead.name}`} title="View lead details" onClick={(event) => { event.stopPropagation(); setSelectedLead(lead); }}><Eye /></button></footer>
  </section>; };
  return (
    <article className={`ccc-context-card ccc-live-lead-queue ${orderedLeads.length ? "has-leads" : ""}`}>
      <header><span><Users />{title}</span><b>{leads.length}</b></header>
      <p className="ccc-live-lead-queue-description">{description}</p>
      {orderedLeads.length ? <div className="ccc-live-lead-list">{orderedLeads.map(renderLeadCard)}</div> : <p className="ccc-live-card-empty">No leads in this queue.</p>}
      {selectedLead && <LeadDetailPanel lead={selectedLead} onClose={() => setSelectedLead(null)} onClaim={onClaim} claimPending={claimPending} bookingPending={bookingPending} onMarkBooked={onMarkBooked} onOpenSms={onOpenSms} onCopyPhone={copyPhone} />}
    </article>
  );
}

function LeadDetailPanel({ lead, onClose, onClaim, claimPending, bookingPending, onMarkBooked, onOpenSms, onCopyPhone }: { lead: CommandLead; onClose: () => void; onClaim: (lead: CommandLead) => void; claimPending: boolean; bookingPending: boolean; onMarkBooked: (lead: CommandLead) => void; onOpenSms: (lead: CommandLead) => void; onCopyPhone: (phone: string) => void }) {
  return <div className="ccc-lead-detail-backdrop" role="presentation" onMouseDown={onClose}>
    <aside className="ccc-lead-detail-panel" role="dialog" aria-modal="true" aria-label={`${lead.name} lead details`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><small>LEAD DETAILS</small><h2>{lead.name}</h2><p>{lead.sourceLabel} · {formatRelative(lead.ts)}</p></div><button type="button" aria-label="Close lead details" onClick={onClose}><X /></button></header>
      <div className="ccc-lead-detail-scroll">
        <div className="ccc-lead-detail-hero"><img src={customerPortraitFor(lead.name)} alt={`Client portrait illustration for ${lead.name}`} /><div><strong>{lead.serviceType || lead.detail}</strong><span><i />New inquiry</span></div></div>
        {lead.phone && <div className="ccc-lead-detail-phone"><div><Phone /><strong>{formatPhoneDisplay(lead.phone)}</strong><small>Customer phone · Provided by {lead.sourceLabel}</small></div><span><button type="button" aria-label="Copy phone" onClick={() => onCopyPhone(lead.phone!)}><Copy /></button><a href={`tel:${lead.phone}`} aria-label={`Call ${lead.name}`}><Phone /></a></span></div>}
        <div className="ccc-live-lead-chip-row">{[lead.serviceType, lead.requestedDates, lead.homeSize || (lead.bedrooms && lead.bathrooms ? `${lead.bedrooms} Bed · ${lead.bathrooms} Bath` : lead.rooms), lead.propertyType, lead.frequency, lead.status, lead.leadPrice, lead.negotiationId && `Negotiation ${lead.negotiationId}`, ...lead.extras].filter(Boolean).map((value) => <span key={value}>{value}</span>)}</div>
        <section className="ccc-lead-detail-section"><h3><ClipboardList />Lead info</h3><dl>
          {lead.negotiationId && <><dt>Negotiation ID</dt><dd>{lead.negotiationId}</dd></>}
          {lead.requestId && <><dt>Request ID</dt><dd>{lead.requestId}</dd></>}
          {lead.customerId && <><dt>Customer ID</dt><dd>{lead.customerId}</dd></>}
          {lead.category && <><dt>Category</dt><dd>{lead.category}{lead.categoryId ? ` (${lead.categoryId})` : ""}</dd></>}
          {lead.status && <><dt>Status</dt><dd>{lead.status}</dd></>}
          {lead.leadPrice && <><dt>Thumbtack lead price</dt><dd>{lead.leadPrice}{nativeValue(lead.leadPriceBreakdown) ? ` · ${nativeValue(lead.leadPriceBreakdown)}` : ""}</dd></>}
          {lead.location && <><dt><MapPin />Location</dt><dd>{lead.location}</dd></>}
          {lead.address && lead.address !== lead.location && <><dt><Home />Address</dt><dd>{lead.address}</dd></>}
          {lead.requestedDates && <><dt><CalendarDays />Requested cleaning dates</dt><dd>{lead.requestedDates}</dd></>}
          {lead.travelPreferences.length > 0 && <><dt>Travel preferences</dt><dd>{lead.travelPreferences.join(", ")}</dd></>}
          {lead.pets && <><dt>Pets</dt><dd>{lead.pets}</dd></>}
          {lead.createdAt && <><dt>Thumbtack created at</dt><dd>{new Date(lead.createdAt).toLocaleString()}</dd></>}
        </dl></section>
        {lead.summary && <section className="ccc-lead-detail-section"><h3><Sparkles />Customer request summary</h3><p className="ccc-lead-detail-summary">{lead.summary}</p></section>}
        {lead.description && lead.description !== lead.summary && <section className="ccc-lead-detail-section"><h3>Original customer request</h3><p className="ccc-lead-detail-summary">{lead.description}</p></section>}
        {lead.proposedTimes.length > 0 && <section className="ccc-lead-detail-section"><h3><CalendarDays />Proposed time windows</h3><ul className="ccc-lead-detail-list">{lead.proposedTimes.map((time, index) => <li key={`${time.start}-${time.end}-${index}`}>{time.start ? new Date(time.start).toLocaleString() : ""}{time.end ? ` – ${new Date(time.end).toLocaleString()}` : ""}</li>)}</ul></section>}
        {lead.nativeDetails.length > 0 && <section className="ccc-lead-detail-section"><h3>All Thumbtack request fields</h3><dl>{lead.nativeDetails.map((detail, index) => <Fragment key={`${detail.question}-${index}`}><dt>{detail.question || "Request detail"}</dt><dd>{detail.answer || "—"}</dd></Fragment>)}</dl></section>}
        {(lead.estimate || lead.attachments.length > 0 || lead.requestReviewLink || lead.refundRequestLink) && <section className="ccc-lead-detail-section"><h3>Native payload references</h3><dl>{lead.estimate && <><dt>Estimate</dt><dd>{nativeValue(lead.estimate)}</dd></>}{lead.attachments.length > 0 && <><dt>Attachments</dt><dd>{nativeValue(lead.attachments)}</dd></>}{lead.requestReviewLink && <><dt>Review link</dt><dd><a href={lead.requestReviewLink} target="_blank" rel="noreferrer">Open Thumbtack review</a></dd></>}{lead.refundRequestLink && <><dt>Refund link</dt><dd><a href={lead.refundRequestLink} target="_blank" rel="noreferrer">Open refund request</a></dd></>}</dl></section>}
      </div>
      <footer><button type="button" className={lead.claimedBy ? "is-claimed" : ""} disabled={Boolean(lead.claimedBy) || claimPending} onClick={() => onClaim(lead)}>{lead.claimedBy ? <><Check />{lead.claimedBy}</> : <><Users />Claim</>}</button><button type="button" className={lead.isBooked ? "is-booked" : ""} disabled={lead.isBooked || bookingPending || !lead.sessionId} onClick={() => onMarkBooked(lead)}>{lead.isBooked ? <><Check />Booked</> : "Book"}</button>{lead.phone && <button type="button" onClick={() => onOpenSms(lead)}><MessageSquare />Text</button>}<a href={leadHref(lead)}>Open CRM <ChevronRight /></a></footer>
    </aside>
  </div>;
}

function ServiceAlertPanel({ alerts }: { alerts: ChannelMessage[] }) {
  const [open, setOpen] = useState(false);
  if (!alerts.length) return null;
  return <div className="ccc-live-service-alert-control">
    <button type="button" className={open ? "is-open" : ""} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}><Activity />Alerts <b>{alerts.length}</b></button>
    {open && <div className="ccc-live-service-alert-popover" role="dialog" aria-label="Service alerts">
      <header><span><Activity />Service alerts</span><button type="button" aria-label="Close service alerts" onClick={() => setOpen(false)}><X /></button></header>
      <p>Latest field check-in notices</p>
      <div className="ccc-live-service-alert-scroll" aria-label="Service alert history">
        {alerts.map((alert) => <div className="ccc-live-service-alert" key={alert.id}>
          <div><span className={alert.quickAction === "possible_noshow" ? "is-critical" : ""}>{alert.quickAction === "possible_noshow" ? "Possible no-show" : "Overdue check-in"}</span><time>{formatTime(alert.ts)}</time></div>
          <p>{alert.body}</p>
        </div>)}
      </div>
    </div>}
  </div>;
}

function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/agents/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setError(result.error || "Login failed. Please try again.");
        return;
      }
      onSuccess();
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="ccc-app ccc-live-login">
      <form className="ccc-static-modal" onSubmit={submit}>
        <header><div><MessageSquare /><span><strong>MIB Command</strong><small>Sign in to access the command channel</small></span></div></header>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="ccc-live-login-error">{error}</p>}
        <footer><button type="submit" disabled={pending || !email || !password}>{pending ? <Loader2 className="animate-spin" /> : <Send />}Sign in</button></footer>
      </form>
    </main>
  );
}

export default function CommandChatExactLive() {
  const utils = trpc.useUtils();
  const { data: agentMe, isLoading: agentLoading, isError: agentError, refetch: refetchAgent } = trpc.agents.me.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const isAuthenticated = Boolean(agentMe);
  const callerName = agentMe?.name || "MIB Team";
  const channel: ChannelKey = "command";
  const LEAD_ALERT_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bMcVRxTSaTukZing.wav";
  const [smsSearch, setSmsSearch] = useState("");
  const [leftRailTab, setLeftRailTab] = useState<"sms" | "email">("sms");
  const [issueEngineOpen, setIssueEngineOpen] = useState(false);
  const [issueEngineInitialId, setIssueEngineInitialId] = useState<number | null>(null);
  const [unreadMentionIds, setUnreadMentionIds] = useState<number[]>([]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [allThreadsOpen, setAllThreadsOpen] = useState(false);
  const [threadDraft, setThreadDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<QuoteReplyTarget | null>(null);
  const [notice, setNotice] = useState("");
  const [issueTitle, setIssueTitle] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  const [issueType, setIssueType] = useState<(typeof ISSUE_TYPES)[number][0]>("internal_task");
  const [reminderBody, setReminderBody] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState(15);
  const [pinBody, setPinBody] = useState("");
  const [bookingPerson, setBookingPerson] = useState("");
  const [bookingAmount, setBookingAmount] = useState("");
  const [bookingNote, setBookingNote] = useState("");
  const [selectedSmsConversation, setSelectedSmsConversation] = useState<SmsInboxConversation | null>(null);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [selectedLeadDetail, setSelectedLeadDetail] = useState<CommandLead | null>(null);
  const [selectedLeadCardPhone, setSelectedLeadCardPhone] = useState<string | null>(null);
  const [selectedLeadCardDraft, setSelectedLeadCardDraft] = useState<{ scenario: string; jobContext: string } | null>(null);
  const [optimisticClaimedBy, setOptimisticClaimedBy] = useState<Record<number, string>>({});
  const [optimisticBookedBySession, setOptimisticBookedBySession] = useState<Record<number, string>>({});
  const [selectedEmailThreadId, setSelectedEmailThreadId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pendingOutgoingMessages, setPendingOutgoingMessages] = useState<ChannelMessage[]>([]);
  const [todayDateStr, setTodayDateStr] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  const [madisonOpen, setMadisonOpen] = useState(false);
  const [incomingCommandMessage, setIncomingCommandMessage] = useState<{ from: string } | null>(null);
  const conversationDrawerOpen = Boolean(selectedSmsConversation || selectedEmailThreadId);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageStreamRef = useRef<HTMLDivElement>(null);
  const centerFeedInitialScrollDone = useRef(false);
  const centerFeedNearBottomRef = useRef(true);
  const scrollAfterSendRef = useRef(false);
  const lastSeenCommandMsgIdRef = useRef<number | undefined>(undefined);
  const incomingCommandMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (selectedSmsConversation) {
      setMadisonOpen(false);
      setSelectedEmailThreadId(null);
    }
  }, [selectedSmsConversation]);

  useEffect(() => {
    setSelectedLeadDetail(null);
  }, [selectedSmsConversation?.id]);

  useEffect(() => {
    if (selectedEmailThreadId) {
      setMadisonOpen(false);
      setSelectedSmsConversation(null);
      setSelectedLeadCardPhone(null);
      setSelectedLeadCardDraft(null);
    }
  }, [selectedEmailThreadId]);

  const { data: profile } = trpc.opsChat.getMyProfile.useQuery(undefined, { enabled: isAuthenticated, retry: false, staleTime: 5 * 60 * 1000 });
  const { data: photosData } = trpc.opsChat.getAllAgentPhotoMap.useQuery(undefined, { enabled: isAuthenticated, retry: false, staleTime: 5 * 60 * 1000 });
  const { data: channelMessages = [], isLoading: messagesLoading } = trpc.opsChat.listChannelMessages.useQuery(
    { channel },
    { enabled: isAuthenticated, refetchInterval: 30_000, refetchIntervalInBackground: false },
  );
  const { data: nativeThumbtackLeads = [], isLoading: nativeThumbtackLoading } = trpc.thumbtackLead.listNative.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const { playSound, muted: notifMuted } = useNotificationSound();
  const { isLeader: isNotifLeader } = useTabLeader();
  const { data: openIssues = [] } = trpc.opsChat.listIssues.useQuery({ status: "open", limit: 12 }, { enabled: isAuthenticated, refetchInterval: 30_000 });
  const { data: activePin } = trpc.opsChat.getChannelPin.useQuery({ channel }, { enabled: isAuthenticated, refetchInterval: 30_000 });
  const { data: agents = { agents: [] } } = trpc.opsChat.getAgentStatusList.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 60_000 });
  const { data: activeThreads = [] } = trpc.opsChat.listActiveThreads.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 30_000 });
  const { data: todayBookingStats } = trpc.bookings.todayStats.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const { data: pendingSuperAlerts = [] } = trpc.opsChat.getPendingSuperAlerts.useQuery(undefined, { enabled: isAuthenticated, staleTime: 0, refetchInterval: 3_000, refetchIntervalInBackground: false });
  const { data: superAlertMessageIds = [] } = trpc.opsChat.getSuperAlertMessageIds.useQuery({ channel }, { enabled: isAuthenticated, staleTime: 0, refetchInterval: 60_000 });
  const { data: threadDetail } = trpc.opsChat.getThreadReplies.useQuery({ parentId: threadId ?? 0 }, { enabled: isAuthenticated && threadId !== null });
  const { data: smsInboxRows = [], isLoading: smsInboxLoading } = trpc.commandCenter.listCommandChatInbox.useQuery(
    undefined,
    { enabled: isAuthenticated, staleTime: 30_000, refetchOnWindowFocus: false, refetchInterval: 15_000 },
  );
  const { data: emailInboxData, isLoading: emailInboxLoading } = trpc.opsChat.listEmailInboxThreads.useQuery(
    undefined,
    { enabled: isAuthenticated, staleTime: 30_000, refetchOnWindowFocus: false, refetchInterval: 15_000 },
  );
  const smsInbox = useMemo(() => (smsInboxRows as unknown as SmsInboxConversation[])
    .filter((conversation) => Boolean(conversation.leadPhone))
    .sort((left, right) => smsInboxTimestamp(right) - smsInboxTimestamp(left)), [smsInboxRows]);
  const visibleSmsInbox = useMemo(() => {
    const query = smsSearch.trim().toLowerCase();
    if (!query) return smsInbox;
    return smsInbox.filter((conversation) => [
      smsConversationName(conversation),
      conversation.leadPhone,
      conversation.lastMessageText,
      conversation.aiSummary,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [smsInbox, smsSearch]);
  const emailInbox = useMemo(
    () => [...((emailInboxData?.threads ?? []) as EmailInboxThread[])].sort((left, right) => right.lastMessageAt - left.lastMessageAt),
    [emailInboxData?.threads],
  );
  const visibleEmailInbox = useMemo(() => {
    const query = smsSearch.trim().toLowerCase();
    if (!query) return emailInbox;
    return emailInbox.filter((thread) => [
      emailThreadName(thread),
      thread.senderEmail,
      thread.subject,
      thread.snippet,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [emailInbox, smsSearch]);
  const leftTeamSmsSessionIds = useMemo(
    () => smsInbox.filter((conversation) => conversation.personType === "team").map((conversation) => conversation.id),
    [smsInbox],
  );
  const teamSmsConversations = useMemo(
    () => new Map(smsInbox.filter((conversation) => conversation.personType === "team").map((conversation) => [conversation.id, conversation])),
    [smsInbox],
  );
  const { data: teamSmsEvents = [] } = trpc.commandCenter.listInboundTeamSmsEvents.useQuery(
    { sessionIds: leftTeamSmsSessionIds },
    { enabled: isAuthenticated && leftTeamSmsSessionIds.length > 0, staleTime: 15_000, refetchOnWindowFocus: false, refetchInterval: 15_000 },
  );
  const { data: inboundVoiceCallHistory } = trpc.voice.listCalls.useQuery(
    { limit: 50, offset: 0 },
    { enabled: isAuthenticated, staleTime: 30_000, refetchInterval: 30_000, refetchIntervalInBackground: false },
  );
  const voiceCallIdentityByVapiId = useMemo(() => new Map<string, VoiceCallerIdentity>(
    (inboundVoiceCallHistory?.calls ?? [])
      .filter((call) => Boolean(call.vapiCallId))
      .map((call) => [call.vapiCallId, { callerName: call.callerName?.trim() || null, callerPhone: call.callerPhone?.trim() || null }]),
  ), [inboundVoiceCallHistory?.calls]);

  const messageIds = useMemo(() => (channelMessages as ChannelMessage[]).map((message) => message.id).filter((id) => id > 0).slice(-500), [channelMessages]);
  const reactionsMutation = trpc.opsChat.getReactions.useMutation();
  const [reactionRows, setReactionRows] = useState<Array<{ messageId: number; callerId: string; callerName: string; emoji: string }>>([]);
  useEffect(() => {
    if (!isAuthenticated || !messageIds.length) {
      setReactionRows([]);
      return;
    }
    let active = true;
    void reactionsMutation.mutateAsync({ messageIds }).then((result) => {
      if (active) setReactionRows(result.reactions);
    }).catch(() => {
      if (active) setReactionRows([]);
    });
    return () => { active = false; };
  // message IDs determine the request; mutation identity is stable from tRPC.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, messageIds.join(",")]);

  const sendThreadMessage = trpc.opsChat.sendMessage.useMutation();
  const sendAwayStatusMessage = trpc.opsChat.sendMessage.useMutation();
  const setAwayStatusMutation = trpc.agents.setAwayStatus.useMutation({
    onError: () => showNotice("Away status could not be updated. Please try again."),
  });
  const toggleReaction = trpc.opsChat.toggleReaction.useMutation({
    onSuccess: () => {
      void utils.opsChat.listChannelMessages.invalidate({ channel });
      if (messageIds.length) void reactionsMutation.mutateAsync({ messageIds }).then((result) => setReactionRows(result.reactions));
    },
  });
  const handleReaction = useCallback((messageId: number, emoji: string) => {
    toggleReaction.mutate({ messageId, emoji });
  }, [toggleReaction.mutate]);
  const setAwayStatus = useCallback((status: AwayStatus) => {
    const selectedStatus = status === null ? null : AWAY_STATUSES.find((option) => option.key === status) ?? null;
    setAwayStatusMutation.mutate({ status }, {
      onSuccess: () => {
        void refetchAgent();
        void utils.opsChat.getAgentStatusList.invalidate();
        const body = selectedStatus
          ? `${selectedStatus.emoji} ${profile?.name || callerName} — ${selectedStatus.label}`
          : `✅ ${profile?.name || callerName} — I'm Back`;
        sendAwayStatusMessage.mutate({
          channel: "command",
          body,
          authorName: profile?.name || callerName,
          authorRole: "office",
          quickAction: `away_status:${status ?? "back"}`,
        });
      },
    });
  }, [callerName, profile?.name, refetchAgent, sendAwayStatusMessage, setAwayStatusMutation, utils]);
  const createIssue = trpc.opsChat.createIssue.useMutation({
    onSuccess: () => {
      setModal(null);
      setIssueTitle("");
      setIssueNotes("");
      void utils.opsChat.listIssues.invalidate({ status: "open", limit: 12 });
      void utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
    },
    onError: () => showNotice("Issue could not be created. Please try again."),
  });
  const setReminder = trpc.opsChat.setReminder.useMutation({ onSuccess: () => { setModal(null); setReminderBody(""); showNotice("Reminder scheduled."); } });
  const pinNote = trpc.opsChat.pinNote.useMutation({ onSuccess: () => { setModal(null); setPinBody(""); void utils.opsChat.getChannelPin.invalidate({ channel }); } });
  const announceBooking = trpc.opsChat.announceBooking.useMutation({ onSuccess: () => { setModal(null); setBookingPerson(""); setBookingAmount(""); setBookingNote(""); void utils.opsChat.listChannelMessages.invalidate({ channel: "command" }); } });
  const markLeadBookedMutation = trpc.opsChat.markLeadBooked.useMutation();
  const acknowledgeSuperAlert = trpc.opsChat.acknowledgeSuperAlert.useMutation({
    onSuccess: () => { void utils.opsChat.getPendingSuperAlerts.invalidate(); },
    onError: () => showNotice("Super Alert could not be acknowledged. Please try again."),
  });

  const photoMap = useMemo(() => photosData?.photos ?? {}, [photosData?.photos]);
  const mentionNames = useMemo(() => {
    const byFirstName: Record<string, string> = {};
    const candidateNames = new Set([...Object.keys(photoMap), ...agents.agents.map((agent) => agent.name)]);
    for (const name of Array.from(candidateNames)) {
      if (!name || name === callerName) continue;
      const firstName = name.split(" ")[0].toLowerCase();
      if (!byFirstName[firstName] || name.length > byFirstName[firstName].length) byFirstName[firstName] = name;
    }
    return Object.values(byFirstName).sort();
  }, [agents.agents, callerName, photoMap]);
  const superAlertMessageIdSet = useMemo(() => new Set(superAlertMessageIds), [superAlertMessageIds]);
  const activeSuperAlert = pendingSuperAlerts[0] ?? null;
  const todayBookingCount = todayBookingStats?.bookedCount ?? 0;
  const todayRevenue = todayBookingStats?.bookedRevenue ?? 0;
  const todayBookingDetails = todayBookingStats?.bookingDetails ?? [];
  const headerAgentPresence = useMemo(() => {
    const now = Date.now();
    return agents.agents.map((agent) => ({ ...agent, presence: commandPresenceStatus(agent, now) }));
  }, [agents.agents]);
  const rootMessages = useMemo(() => (channelMessages as ChannelMessage[]).filter((message) => !message.threadParentId), [channelMessages]);
  const pendingRootMessages = useMemo(
    () => pendingOutgoingMessages.filter((pending) => !rootMessages.some((persisted) => (
      persisted.from === pending.from
      && persisted.role === pending.role
      && persisted.body === pending.body
      && persisted.mediaUrl === pending.mediaUrl
      && Math.abs(persisted.ts - pending.ts) < 15_000
    ))),
    [pendingOutgoingMessages, rootMessages],
  );
  const rawCommandLeads = useMemo(() => {
    const parsedLeads = rootMessages.map(leadFromCommandMessage).filter((lead): lead is CommandLead => lead !== null);
    const nativeLeads = nativeThumbtackLeads as NativeThumbtackLead[];
    const nativeCards = nativeThumbtackLoading ? [] : nativeLeads.map(nativeLeadToCommandLead);
    const nonThumbtackLegacyLeads = parsedLeads.filter((lead) => lead.queue !== "incoming" || lead.sourceLabel.trim().toLowerCase() !== "thumbtack");
    return [...nonThumbtackLegacyLeads, ...nativeCards];
  }, [nativeThumbtackLeads, nativeThumbtackLoading, rootMessages]);
  const commandLeadSessionIds = useMemo(
    () => rawCommandLeads.map((lead) => lead.sessionId).filter((id): id is number => id !== null),
    [rawCommandLeads],
  );
  const { data: leadSessionStatuses = [] } = trpc.opsChat.getLeadSessionStatuses.useQuery(
    { sessionIds: commandLeadSessionIds },
    { enabled: isAuthenticated && commandLeadSessionIds.length > 0, refetchInterval: 30_000, refetchIntervalInBackground: false },
  );
  const commandLeads = useMemo(() => {
    const statusById = new Map(leadSessionStatuses.map((status) => [status.id, status]));
    return rawCommandLeads.map((lead) => {
      const status = lead.sessionId ? statusById.get(lead.sessionId) : undefined;
      const claimedBy = optimisticClaimedBy[lead.id];
      const optimisticBookedBy = lead.sessionId ? optimisticBookedBySession[lead.sessionId] : undefined;
      const hydrated = status ? { ...lead, isBooked: status.isBooked, bookedByAgentName: status.bookedByAgentName } : lead;
      const booked = optimisticBookedBy ? { ...hydrated, isBooked: true, bookedByAgentName: optimisticBookedBy } : hydrated;
      return claimedBy ? { ...booked, claimedBy } : booked;
    });
  }, [leadSessionStatuses, optimisticBookedBySession, optimisticClaimedBy, rawCommandLeads]);
  const allLeads = useMemo(() => commandLeads, [commandLeads]);
  const selectedConversationLead = useMemo(
    () => selectedSmsConversation ? leadForConversation(selectedSmsConversation, allLeads) : null,
    [allLeads, selectedSmsConversation],
  );
  const serviceAlerts = useMemo(
    () => rootMessages.filter(isServiceAlert).sort((left, right) => right.ts - left.ts),
    [rootMessages],
  );
  const visibleRootMessages = useMemo(
    () => [...rootMessages, ...pendingRootMessages].filter((message) => !isHiddenCommandNotification(message) && !isServiceAlert(message)),
    [pendingRootMessages, rootMessages],
  );
  const commandTimeline = useMemo<CommandTimelineEntry[]>(
    () => [
      ...visibleRootMessages.map((message) => ({ kind: "internal" as const, id: `channel-${message.id}`, ts: message.ts, message })),
      ...(teamSmsEvents as TeamSmsStreamEvent[]).map((event) => ({ kind: "team-sms" as const, id: `team-sms-${event.id}`, ts: event.ts, event })),
    ].sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id)),
    [teamSmsEvents, visibleRootMessages],
  );
  const latestTimelineTimestamp = commandTimeline.at(-1)?.ts ?? 0;
  const effectiveMentionNames = useMemo(() => new Set([callerName, profile?.name].filter((name): name is string => Boolean(name))), [callerName, profile?.name]);
  const mentionPattern = useMemo(() => {
    if (!effectiveMentionNames.size) return null;
    const names = Array.from(effectiveMentionNames).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    return new RegExp(`@(${names})(?:\\b|\\s|$)`, "i");
  }, [effectiveMentionNames]);
  const mentionStorageKey = useMemo(() => `cmd_lastSeenMsgId_${callerName}`, [callerName]);
  const mentionMessages = useMemo(
    () => mentionPattern ? visibleRootMessages.filter((message) => !effectiveMentionNames.has(message.from) && mentionPattern.test(message.body)) : [],
    [effectiveMentionNames, mentionPattern, visibleRootMessages],
  );
  const reactionsByMessage = useMemo(() => {
    const grouped: Record<number, Record<string, { count: number; names: string[] }>> = {};
    for (const item of reactionRows) {
      const byEmoji = grouped[item.messageId] ?? (grouped[item.messageId] = {});
      const entry = byEmoji[item.emoji] ?? (byEmoji[item.emoji] = { count: 0, names: [] });
      entry.count += 1;
      entry.names.push(item.callerName);
    }
    return grouped;
  }, [reactionRows]);
  const metrics = useMemo(() => {
    const participants = new Set(visibleRootMessages.slice(-80).map((message) => message.from)).size;
    return { mentions: unreadMentionIds.length, participants };
  }, [unreadMentionIds.length, visibleRootMessages]);
  const activeThreadCount = activeThreads.length;
  const unreadThreadCount = activeThreads.filter((thread) => thread.hasUnread).length;

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3000);
  }, []);
  const claimCommandLead = trpc.opsChat.claimLead.useMutation({
    onSuccess: (result, variables) => {
      if (!result.success) {
        setOptimisticClaimedBy((current) => ({ ...current, [variables.messageId]: result.alreadyClaimedBy }));
        showNotice(`Already claimed by ${result.alreadyClaimedBy}`);
        void Promise.all([
          utils.opsChat.listChannelMessages.invalidate({ channel }),
          utils.thumbtackLead.listNative.invalidate(),
        ]).finally(() => setOptimisticClaimedBy((current) => {
          const next = { ...current };
          delete next[variables.messageId];
          return next;
        }));
        return;
      }
      setOptimisticClaimedBy((current) => ({ ...current, [variables.messageId]: result.claimedBy }));
      showNotice(`Lead claimed by ${result.claimedBy}`);
      void Promise.all([
        utils.opsChat.listChannelMessages.invalidate({ channel }),
        utils.thumbtackLead.listNative.invalidate(),
      ]).finally(() => setOptimisticClaimedBy((current) => {
        const next = { ...current };
        delete next[variables.messageId];
        return next;
      }));
    },
    onError: (error, variables) => {
      setOptimisticClaimedBy((current) => {
        const next = { ...current };
        delete next[variables.messageId];
        return next;
      });
      showNotice(`Lead claim failed: ${error.message}`);
    },
  });
  const claimLeadFromQueue = useCallback((lead: CommandLead) => {
    if (lead.claimedBy || claimCommandLead.isPending) return;
    setOptimisticClaimedBy((current) => ({ ...current, [lead.id]: callerName }));
    claimCommandLead.mutate({ messageId: lead.id, ...(lead.sessionId ? { sessionId: lead.sessionId } : {}) });
  }, [callerName, claimCommandLead, claimCommandLead.isPending]);
  const markLeadBookedFromQueue = useCallback(async (lead: CommandLead) => {
    if (lead.isBooked || !lead.sessionId || markLeadBookedMutation.isPending) return;
    let marked = false;
    try {
      await markLeadBookedMutation.mutateAsync({ sessionId: lead.sessionId });
      marked = true;
      setOptimisticBookedBySession((current) => ({ ...current, [lead.sessionId!]: callerName }));
      void utils.bookings.todayStats.invalidate();
      void utils.opsChat.getLeadSessionStatuses.invalidate({ sessionIds: commandLeadSessionIds });
      void utils.thumbtackLead.listNative.invalidate();
      await announceBooking.mutateAsync({
        channel: "command",
        personName: lead.name,
        ...(lead.priceLabel ? { amount: lead.priceLabel } : {}),
        authorName: profile?.name || callerName,
      });
      showNotice(`${lead.name} marked as booked and announced.`);
    } catch (error) {
      if (!marked && lead.sessionId) {
        setOptimisticBookedBySession((current) => {
          const next = { ...current };
          delete next[lead.sessionId!];
          return next;
        });
      }
      showNotice(marked ? "Lead marked booked, but the Command Chat announcement failed." : error instanceof Error ? `Booking update failed: ${error.message}` : "Booking update failed.");
    }
  }, [announceBooking, callerName, commandLeadSessionIds, markLeadBookedMutation, profile?.name, showNotice, utils]);
  const openSmsDrawerFromLead = useCallback((lead: CommandLead) => {
    const inboxConversation = smsInbox.find((conversation) => (
      (lead.sessionId !== null && conversation.id === lead.sessionId)
      || (lead.phone && normalizedLeadPhone(conversation.leadPhone) === normalizedLeadPhone(lead.phone))
    ));
    if (!inboxConversation && !lead.phone) {
      showNotice("A Command Chat text conversation is not available for this lead yet.");
      return;
    }
    setSelectedLeadCardPhone(lead.phone);
    setSelectedLeadCardDraft(lead.sourceLabel === "Thumbtack" ? {
      scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\n\nThumbtack lead:\n${buildThumbtackLeadDraftContext(lead)}`,
      jobContext: buildThumbtackLeadDraftContext(lead),
    } : null);
    setSelectedSmsConversation(inboxConversation ?? {
      id: lead.sessionId ?? 0,
      leadName: lead.name,
      leadPhone: lead.phone,
      leadSource: lead.sourceLabel === "Thumbtack" ? "thumbtack" : null,
      lastMessageText: null,
      lastMsgTs: null,
      lastMessageTs: null,
      lastSenderRole: null,
      hasUnanswered: false,
      aiSummary: null,
      personType: "customer",
      lastInboundPhoneNumberId: null,
    });
  }, [showNotice, smsInbox]);

  const addPendingOutgoingMessage = useCallback((message: ChannelMessage) => {
    scrollAfterSendRef.current = true;
    setPendingOutgoingMessages((current) => [...current, message]);
  }, []);

  const restoreFailedOutgoingMessage = useCallback((messageId: number) => {
    setPendingOutgoingMessages((current) => current.filter((message) => message.id !== messageId));
    showNotice("Message could not be sent. Please try again.");
  }, [showNotice]);

  const showIncomingCommandMessage = useCallback((from: string) => {
    if (incomingCommandMessageTimer.current) clearTimeout(incomingCommandMessageTimer.current);
    setIncomingCommandMessage({ from });
    incomingCommandMessageTimer.current = setTimeout(() => setIncomingCommandMessage(null), 6000);
  }, []);

  const dismissIncomingCommandMessage = useCallback(() => {
    if (incomingCommandMessageTimer.current) clearTimeout(incomingCommandMessageTimer.current);
    setIncomingCommandMessage(null);
    const stream = messageStreamRef.current;
    if (!stream) return;
    requestAnimationFrame(() => {
      stream.scrollTop = stream.scrollHeight;
      centerFeedNearBottomRef.current = true;
    });
  }, []);

  const startQuotedReply = useCallback((message: ChannelMessage) => {
    setReplyTarget({ id: message.id, body: message.body, author: message.from });
  }, []);

  const clearQuotedReply = useCallback((messageId?: number) => {
    setReplyTarget((current) => !messageId || current?.id === messageId ? null : current);
  }, []);

  const trackCommandFeedScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const stream = event.currentTarget;
    const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 250;
    centerFeedNearBottomRef.current = nearBottom;
    if (nearBottom && incomingCommandMessage) {
      if (incomingCommandMessageTimer.current) clearTimeout(incomingCommandMessageTimer.current);
      setIncomingCommandMessage(null);
    }
  }, [incomingCommandMessage]);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (incomingCommandMessageTimer.current) clearTimeout(incomingCommandMessageTimer.current);
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const nextDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      setTodayDateStr((currentDate) => currentDate === nextDate ? currentDate : nextDate);
    }, 60_000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let lastSeenId = 0;
    try { lastSeenId = Number.parseInt(localStorage.getItem(mentionStorageKey) ?? "0", 10) || 0; } catch { /* browser storage is optional */ }
    setUnreadMentionIds(mentionMessages.filter((message) => message.id > lastSeenId).map((message) => message.id));
  }, [mentionMessages, mentionStorageKey]);

  useOpsStream({
    onNewMessage: (updatedChannel) => {
      if (!updatedChannel || updatedChannel === channel) void utils.opsChat.listChannelMessages.invalidate({ channel });
      if (!updatedChannel || updatedChannel === "command") void utils.bookings.todayStats.invalidate();
      void utils.opsChat.listActiveThreads.invalidate();
      void utils.opsChat.getChannelCounts.invalidate();
    },
    onLeadUpdate: () => {
      void utils.commandCenter.listCommandChatInbox.invalidate();
      if (leftTeamSmsSessionIds.length) void utils.commandCenter.listInboundTeamSmsEvents.invalidate({ sessionIds: leftTeamSmsSessionIds });
      if (selectedSmsConversation) void utils.leads.getCsConversation.invalidate({ sessionId: selectedSmsConversation.id });
    },
    onGmailNewMessages: () => {
      void utils.opsChat.listEmailInboxThreads.invalidate();
      if (selectedEmailThreadId) {
        void utils.gmail.getThread.invalidate({ threadId: selectedEmailThreadId });
        void utils.opsChat.getEmailDraftByThreadId.invalidate({ threadId: selectedEmailThreadId });
      }
    },
    onReactionUpdate: () => {
      if (messageIds.length) void reactionsMutation.mutateAsync({ messageIds }).then((result) => setReactionRows(result.reactions));
    },
    onReminderUpdate: () => void utils.opsChat.listChannelMessages.invalidate({ channel }),
    onSuperAlert: () => {
      void utils.opsChat.getPendingSuperAlerts.invalidate();
      void utils.opsChat.getSuperAlertMessageIds.invalidate({ channel });
    },
  }, { enabled: isAuthenticated, label: "CommandChatExactLive" });

  // The exact Command Chat already owns the command-channel query, so use it for
  // the established alert behavior rather than introducing a second watcher.
  useEffect(() => {
    if (!isAuthenticated) {
      lastSeenCommandMsgIdRef.current = undefined;
      return;
    }
    const realMessages = (channelMessages as ChannelMessage[]).filter((message) => message.id > 0);
    if (!realMessages.length) return;
    const currentMaxId = Math.max(...realMessages.map((message) => message.id));
    if (lastSeenCommandMsgIdRef.current === undefined) {
      // First load — initialize silently so historical leads never alert.
      lastSeenCommandMsgIdRef.current = currentMaxId;
      return;
    }
    if (currentMaxId > lastSeenCommandMsgIdRef.current) {
      const newLeads = realMessages.filter(
        (message) => message.id > lastSeenCommandMsgIdRef.current! && message.quickAction === "new_lead",
      );
      const newHumanMessages = realMessages.filter((message) => (
        message.id > lastSeenCommandMsgIdRef.current!
        && message.quickAction === null
        && !effectiveMentionNames.has(message.from)
      ));
      if (newLeads.length > 0 && isNotifLeader && !notifMuted) {
        try {
          const audio = new Audio(LEAD_ALERT_URL);
          audio.volume = 0.75;
          audio.play().catch(() => {});
        } catch {}
      } else if (newHumanMessages.length > 0 && isNotifLeader && !notifMuted) {
        playSound();
      }
      if (newHumanMessages.length > 0 && !centerFeedNearBottomRef.current) {
        showIncomingCommandMessage(newHumanMessages.at(-1)!.from);
      }
      lastSeenCommandMsgIdRef.current = currentMaxId;
    }
  }, [channelMessages, effectiveMentionNames, isAuthenticated, isNotifLeader, notifMuted, playSound, showIncomingCommandMessage]);

  useEffect(() => {
    const stream = messageStreamRef.current;
    if (!stream) return;
    const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 250;
    const shouldScroll = scrollAfterSendRef.current || !centerFeedInitialScrollDone.current || nearBottom;
    if (!shouldScroll) return;
    const frame = requestAnimationFrame(() => {
      stream.scrollTop = stream.scrollHeight;
      centerFeedInitialScrollDone.current = true;
      centerFeedNearBottomRef.current = true;
      scrollAfterSendRef.current = false;
      setIncomingCommandMessage(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [latestTimelineTimestamp, pendingRootMessages.length]);

  useEffect(() => {
    setPendingOutgoingMessages((current) => {
      const persistedIds = new Set(pendingOutgoingMessages.filter((pending) => !pendingRootMessages.includes(pending)).map((pending) => pending.id));
      if (!persistedIds.size) return current;
      return current.filter((pending) => !persistedIds.has(pending.id));
    });
  }, [pendingOutgoingMessages, pendingRootMessages]);

  const submitThreadReply = () => {
    const parent = threadDetail?.parent;
    if (!parent || !threadDraft.trim()) return;
    sendThreadMessage.mutate({
      channel,
      body: threadDraft.trim(),
      authorName: profile?.name || callerName,
      authorRole: "office",
      threadParentId: parent.id,
    }, {
      onSuccess: () => {
        setThreadDraft("");
        void utils.opsChat.getThreadReplies.invalidate({ parentId: parent.id });
        void utils.opsChat.listChannelMessages.invalidate({ channel });
      },
      onError: () => showNotice("Message could not be sent. Please try again."),
    });
  };

  const openIssueEngine = (issueId: number | null = null) => {
    setIssueEngineInitialId(issueId);
    setIssueEngineOpen(true);
  };

  const focusNextMention = () => {
    const [nextId, ...remainingIds] = unreadMentionIds;
    if (!nextId) return;
    document.getElementById(`ccc-command-message-${nextId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (remainingIds.length) {
      try { localStorage.setItem(mentionStorageKey, String(nextId)); } catch { /* browser storage is optional */ }
      setUnreadMentionIds(remainingIds);
      return;
    }
    const newestMessageId = visibleRootMessages.reduce((highestId, message) => Math.max(highestId, message.id), nextId);
    try { localStorage.setItem(mentionStorageKey, String(newestMessageId)); } catch { /* browser storage is optional */ }
    setUnreadMentionIds([]);
  };


  if (agentLoading) return <main className="ccc-app ccc-live-loading"><Loader2 className="animate-spin" /></main>;
  if (agentError || !agentMe) return <LoginGate onSuccess={() => void refetchAgent()} />;

  return (
    <main className="ccc-app ccc-widget-app ccc-live" aria-label="MIB Command workspace">
      <section className="ccc-workspace">
        <div className="ccc-command-grid">
          <aside className="ccc-command-panel ccc-left-panel">
            <div className="ccc-left-section ccc-conversations-section ccc-live-left-rail">
              <header className="ccc-live-sms-header">
                <div className="ccc-live-sms-title"><span><strong>{leftRailTab === "email" ? "Email" : "SMS"}</strong><b>{leftRailTab === "email" ? emailInbox.length : smsInbox.length}</b></span><a href={leftRailTab === "email" ? "/admin/emails" : "/admin/sms"} aria-label={leftRailTab === "email" ? "Open Email workspace" : "Open SMS workspace to compose a new message"}><SquarePen /></a></div>
                <div className="ccc-live-sms-filter-tabs" role="tablist" aria-label="Command Chat conversation views">
                  <button type="button" className={leftRailTab === "sms" ? "active" : ""} aria-selected={leftRailTab === "sms"} onClick={() => { setLeftRailTab("sms"); setSelectedEmailThreadId(null); }}>SMS</button><button type="button" className={leftRailTab === "email" ? "active" : ""} aria-selected={leftRailTab === "email"} onClick={() => { setLeftRailTab("email"); setSelectedSmsConversation(null); }}>Email</button>
                </div>
                <div className="ccc-live-sms-search"><label><Search /><input value={smsSearch} onChange={(event) => setSmsSearch(event.target.value)} placeholder={leftRailTab === "email" ? "Search email threads..." : "Search conversations..."} aria-label={leftRailTab === "email" ? "Search email threads" : "Search SMS conversations"} /></label><button type="button" aria-label="Conversation filter options"><SlidersHorizontal /></button></div>
              </header>
              <div className="ccc-live-left-rail-content">
                {leftRailTab === "email" ? <div className="ccc-conversation-list ccc-inbox-list ccc-live-sms-list" aria-label="Email conversations">
                  {visibleEmailInbox.map((thread) => <EmailInboxRow thread={thread} key={thread.threadId} onOpen={() => setSelectedEmailThreadId(thread.threadId)} />)}
                  {!visibleEmailInbox.length && <p className="ccc-live-card-empty">{emailInboxLoading ? "Loading email conversations…" : smsSearch ? "No email threads match your search." : "No active email conversations."}</p>}
                </div> : <div className="ccc-conversation-list ccc-inbox-list ccc-live-sms-list" aria-label="Text message conversations">
                  {visibleSmsInbox.map((conversation) => <SmsInboxRow conversation={conversation} key={conversation.id} onOpen={() => { setSelectedLeadCardPhone(null); setSelectedLeadCardDraft(null); setSelectedSmsConversation(conversation); }} />)}
                  {!visibleSmsInbox.length && <p className="ccc-live-card-empty">{smsInboxLoading ? "Loading text conversations…" : smsSearch ? "No conversations match your search." : "No active text conversations."}</p>}
                </div>}
              </div>
            </div>
          </aside>

          <section className="ccc-command-panel ccc-center-panel">
            <div className="ccc-reference-chat-header"><div className="ccc-reference-chat-top"><div className="ccc-reference-chat-identity"><span className="ccc-command-glyph"><MessageSquare /></span><div className="ccc-reference-command-info"><strong>{CHANNELS.find((item) => item.key === channel)?.label || "MIB Command"}</strong><div className="ccc-reference-header-metrics" aria-label="Live command workspace metrics"><button type="button" className={`ccc-header-metric-control ccc-header-metric-threads ${allThreadsOpen ? "active" : ""}`} aria-label="Open all unread command threads" onClick={() => setAllThreadsOpen(true)}><MessageSquare /><b>{unreadThreadCount}</b> Threads</button><span className="ccc-header-metric-bookings ccc-header-booking-hover" tabIndex={0} aria-label={`${todayBookingCount} bookings today`}><CalendarClock /><b>{todayBookingCount}</b> Booked{todayBookingDetails.length > 0 && <span className="ccc-header-booking-popover" role="tooltip"><strong>Today&apos;s bookings</strong>{todayBookingDetails.map((booking, index) => <span className="ccc-header-booking-row" key={`${booking.customerName ?? "customer"}-${index}`}><span><b>{booking.customerName?.trim() || "Customer"}</b><small>{booking.bookedByAgentName?.trim() ? `Booked by ${booking.bookedByAgentName.trim()}` : "Public booking"}</small></span><em>${(Number(booking.totalCents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</em></span>)}</span>}</span><span className="ccc-header-metric-money"><CircleDollarSign /><b>${todayRevenue.toLocaleString()}</b> Today</span><button type="button" className="ccc-header-metric-control ccc-header-metric-issues" onClick={() => openIssueEngine()}><AlertTriangle /><b>{openIssues.length}</b> Issues</button><button type="button" className="ccc-header-metric-control ccc-header-metric-mentions" disabled={!metrics.mentions} aria-label="Open next unread mention" onClick={focusNextMention}><Bell /><b>{metrics.mentions}</b></button></div></div></div><div className="ccc-reference-chat-actions"><div className="ccc-presence ccc-live-header-presence" aria-label="Active command participants">{headerAgentPresence.map((agent, index) => <span className={`ccc-live-presence-agent ccc-live-presence-${agent.presence}`} key={agent.id} title={`${agent.name} — ${agent.presence === "on-call" ? "on a call" : agent.presence}`} style={{ zIndex: headerAgentPresence.length - index }}><Avatar name={agent.name} photoUrl={agent.photoUrl} className="ccc-presence-portrait" /><i aria-hidden="true" /></span>)}</div></div></div></div>
            <>
              {activePin && <div className="ccc-pin"><Pin /><div><strong>Pinned by {activePin.authorName}</strong><span>{activePin.body}</span></div><button type="button" aria-label="Dismiss pinned note locally" onClick={() => showNotice("Pins are managed from channel actions.")}><X /></button></div>}
              <div className="ccc-day-divider"><span>Live channel · {dateLabel(Date.now())}</span></div>
              <div className="ccc-message-stream" ref={messageStreamRef} onScroll={trackCommandFeedScroll}>
                <CommandTimelineFeed messagesLoading={messagesLoading} timeline={commandTimeline} callerName={callerName} photoMap={photoMap} voiceCallIdentityByVapiId={voiceCallIdentityByVapiId} mentionPattern={mentionPattern} superAlertMessageIdSet={superAlertMessageIdSet} reactionsByMessage={reactionsByMessage} onOpenPhoto={setLightboxUrl} onOpenThread={setThreadId} onReply={startQuotedReply} onReaction={handleReaction} onOpenSmsConversation={(conversation) => { setSelectedLeadCardPhone(null); setSelectedLeadCardDraft(null); setSelectedSmsConversation(conversation); }} />
              </div>
              {incomingCommandMessage && <button type="button" className="ccc-live-new-command-message" onClick={dismissIncomingCommandMessage}><ChevronDown />New message from {incomingCommandMessage.from}</button>}
              <div className="ccc-quick-actions"><AwayStatusControl status={(agentMe?.awayStatus ?? null) as AwayStatus} pending={setAwayStatusMutation.isPending} onSetStatus={setAwayStatus} /><button type="button" onClick={() => setShowNewMessage(true)}><Plus />Start new SMS</button><button type="button" onClick={() => setModal("issue")}><AlertTriangle />Open issue</button><button type="button" onClick={() => setModal("reminder")}><CalendarClock />Set reminder</button><button type="button" onClick={() => setModal("pin")}><Pin />Pin a note</button><button type="button" onClick={() => setModal("booking")}><Sparkles />Announce booking</button><button type="button" onClick={() => showNotice("Use the dedicated SMS workspace for customer broadcasts.")}><Megaphone />Broadcast</button></div>
              <CommandComposer
                authorName={profile?.name || callerName}
                mentionNames={mentionNames}
                photoMap={photoMap}
                replyTarget={replyTarget}
                onClearReplyTarget={clearQuotedReply}
                onOptimisticMessage={addPendingOutgoingMessage}
                onOutgoingFailure={restoreFailedOutgoingMessage}
                onNotice={showNotice}
              />
            </>
          </section>

          <aside className={`ccc-command-panel ccc-right-panel ${threadId !== null ? "ccc-right-panel-thread-open" : ""}`}>
            {threadId !== null ? <ThreadPanel thread={threadDetail} callerName={callerName} draft={threadDraft} pending={sendThreadMessage.isPending} photoMap={photoMap} onDraft={setThreadDraft} onSend={submitThreadReply} onClose={() => { setThreadId(null); setThreadDraft(""); }} /> : <><div className="ccc-lead-context-topline"><strong>Leads</strong><div><ServiceAlertPanel alerts={serviceAlerts} /><a href="/admin/leads">Open CRM <ChevronRight /></a></div></div><LeadQueue title="All leads" description="Quote forms and Thumbtack · newest first" leads={allLeads} smsInbox={smsInbox} claimPending={claimCommandLead.isPending} bookingPending={markLeadBookedMutation.isPending} onClaim={claimLeadFromQueue} onMarkBooked={markLeadBookedFromQueue} onOpenSms={openSmsDrawerFromLead} /></>}
          </aside>
        </div>
      </section>
      {selectedSmsConversation && <SmsConversationDrawer conversation={selectedSmsConversation} conversations={smsInbox} callerName={callerName} callerPhotoUrl={profile?.photoUrl ?? null} photoMap={photoMap} businessDate={todayDateStr} leadCardPhone={selectedLeadCardPhone} leadDraft={selectedLeadCardDraft} lead={selectedConversationLead} onNotice={showNotice} onOpenLeadDetails={setSelectedLeadDetail} onSessionResolved={(sessionId) => { setSelectedLeadCardPhone(null); setSelectedLeadCardDraft(null); setSelectedSmsConversation((current) => current ? { ...current, id: sessionId } : current); }} onClose={() => { setSelectedSmsConversation(null); setSelectedLeadCardPhone(null); setSelectedLeadCardDraft(null); setSelectedLeadDetail(null); }} />}
      {selectedLeadDetail && <LeadDetailPanel lead={selectedLeadDetail} onClose={() => setSelectedLeadDetail(null)} onClaim={claimLeadFromQueue} claimPending={claimCommandLead.isPending} bookingPending={markLeadBookedMutation.isPending} onMarkBooked={markLeadBookedFromQueue} onOpenSms={openSmsDrawerFromLead} onCopyPhone={(phone) => { void navigator.clipboard?.writeText(phone); }} />}
      {selectedEmailThreadId && <ExactEmailWorkspaceOverlay threadId={selectedEmailThreadId} onClose={() => setSelectedEmailThreadId(null)} />}
      <AllThreadsPanel open={allThreadsOpen} onClose={() => setAllThreadsOpen(false)} onOpenThread={(parentId) => { setAllThreadsOpen(false); setThreadId(parentId); }} />
      {lightboxUrl && <PhotoLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {activeSuperAlert && <SuperAlertOverlay alert={activeSuperAlert} pending={acknowledgeSuperAlert.isPending} onReply={() => { acknowledgeSuperAlert.mutate({ alertId: activeSuperAlert.id }); setThreadId(activeSuperAlert.messageId); }} />}
      {modal && <ActionModal kind={modal} onClose={() => setModal(null)} issueTitle={issueTitle} issueNotes={issueNotes} issueType={issueType} reminderBody={reminderBody} reminderMinutes={reminderMinutes} pinBody={pinBody} bookingPerson={bookingPerson} bookingAmount={bookingAmount} bookingNote={bookingNote} onIssueTitle={setIssueTitle} onIssueNotes={setIssueNotes} onIssueType={setIssueType} onReminderBody={setReminderBody} onReminderMinutes={setReminderMinutes} onPinBody={setPinBody} onBookingPerson={setBookingPerson} onBookingAmount={setBookingAmount} onBookingNote={setBookingNote} pending={createIssue.isPending || setReminder.isPending || pinNote.isPending || announceBooking.isPending} onSubmit={() => {
        if (modal === "issue") createIssue.mutate({ title: issueTitle.trim(), issueType, severity: "medium", notes: issueNotes.trim() || undefined, createdByName: profile?.name || callerName });
        if (modal === "reminder") setReminder.mutate({ channel, body: reminderBody.trim(), authorName: profile?.name || callerName, triggerAt: Date.now() + reminderMinutes * 60_000 });
        if (modal === "pin") pinNote.mutate({ channel, body: pinBody.trim(), authorName: profile?.name || callerName });
        if (modal === "booking") announceBooking.mutate({ channel: "command", personName: bookingPerson.trim(), amount: bookingAmount.trim() || undefined, note: bookingNote.trim() || undefined, authorName: profile?.name || callerName });
      }} />}
      <IssueEngineOverlay open={issueEngineOpen} onClose={() => { setIssueEngineOpen(false); setIssueEngineInitialId(null); }} callerName={callerName} agentPhotoMap={photoMap} agentList={agents.agents.map((agent) => ({ id: agent.id, name: agent.name, photoUrl: agent.photoUrl ?? null }))} initialIssueId={issueEngineInitialId} />
      {!conversationDrawerOpen && madisonOpen && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            right: 16,
            width: 380,
            height: "calc(100vh - 100px)",
            zIndex: 9999,
            borderRadius: 20,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 8px 40px rgba(116,71,245,0.22), 0 2px 12px rgba(0,0,0,0.12)",
            border: "1px solid #e0d7ff",
            background: "#17191f",
          }}
        >
          <AiConcierge
            agentPhotoUrl={profile?.photoUrl ?? undefined}
            onClose={() => setMadisonOpen(false)}
            compact
            dark
          />
        </div>
      )}
      {!conversationDrawerOpen && <button
        onClick={() => setMadisonOpen(o => !o)}
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          zIndex: 10000,
          padding: 0,
          overflow: "hidden",
          boxShadow: madisonOpen
            ? "0 0 0 3px #7447f5, 0 4px 20px rgba(116,71,245,0.4)"
            : "0 2px 12px rgba(0,0,0,0.18)",
          transition: "box-shadow 0.2s",
        }}
        title="Ask Madison"
        aria-label="Open Madison"
      >
        <img
          src="/madison-avatar.jpg"
          alt="Madison"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </button>}
      {notice && <div className="ccc-notice" role="status"><CircleDot />{notice}</div>}
      {showNewMessage && <LiveNewMessageModal close={() => setShowNewMessage(false)} refresh={() => { void utils.commandCenter.listCommandChatInbox.invalidate(); }} />}
    </main>
  );
}

function LiveNewMessageModal({ close, refresh }: { close: () => void; refresh: () => void }) {
  const [tab, setTab] = useState<"customer" | "lead">("customer");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [leadDetails, setLeadDetails] = useState("");
  const [leadDraft, setLeadDraft] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadName, setLeadName] = useState("");
  const [stage, setStage] = useState<"paste" | "review">("paste");
  const sendWorkspaceMessage = trpc.leads.sendWorkspaceMessage.useMutation({ onSuccess: () => { refresh(); close(); } });
  const generateFirstMessage = trpc.tools.generateFirstMessage.useMutation({
    onSuccess: result => { setLeadDraft(result.message ?? ""); setStage("review"); },
  });
  const sendCustomer = () => {
    if (!phone.trim() || !message.trim()) return;
    sendWorkspaceMessage.mutate({ phone: phone.trim(), message: message.trim(), name: name.trim() || undefined });
  };
  const analyseLead = () => {
    if (!leadDetails.trim()) return;
    generateFirstMessage.mutate({ bookingDetails: leadDetails.trim() });
  };
  const sendLead = () => {
    if (!leadPhone.trim() || !leadDraft.trim()) return;
    sendWorkspaceMessage.mutate({ phone: leadPhone.trim(), message: leadDraft.trim(), name: leadName.trim() || undefined });
  };
  return (
    <div className="cic-modal-backdrop" role="dialog" aria-modal="true" aria-label="New message">
      <section className="cic-modal cic-live-new-message">
        <header><span><MessageCircle />New Message</span><button type="button" onClick={close} aria-label="Close"><X /></button></header>
        <nav><button type="button" className={tab === "customer" ? "is-active" : ""} onClick={() => setTab("customer")}>Customer</button><button type="button" className={tab === "lead" ? "is-active" : ""} onClick={() => setTab("lead")}>Lead</button></nav>
        {tab === "customer" ? <>
          <label>Customer phone<input value={phone} onChange={event => setPhone(event.target.value)} placeholder="(202) 555-0000" /></label>
          <label>Customer name<input value={name} onChange={event => setName(event.target.value)} placeholder="Customer name" /></label>
          <label>Message<textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Write a message…" /></label>
          <footer><button type="button" onClick={close}>Cancel</button><button className="cic-send" type="button" onClick={sendCustomer} disabled={sendWorkspaceMessage.isPending || !phone.trim() || !message.trim()}>{sendWorkspaceMessage.isPending ? "Sending…" : "Send"}<Send size={13} /></button></footer>
        </> : stage === "paste" ? <>
          <label>Paste lead details<textarea value={leadDetails} onChange={event => setLeadDetails(event.target.value)} placeholder="Paste the lead exactly as received. Madison will extract the details and prepare the first message." /></label>
          <footer><button type="button" onClick={close}>Cancel</button><button className="cic-send" type="button" onClick={analyseLead} disabled={generateFirstMessage.isPending || !leadDetails.trim()}>{generateFirstMessage.isPending ? "Analyzing…" : "Analyze lead"}<Sparkles size={13} /></button></footer>
        </> : <>
          <label>Customer phone<input value={leadPhone} onChange={event => setLeadPhone(event.target.value)} placeholder="(202) 555-0000" /></label>
          <label>Customer name<input value={leadName} onChange={event => setLeadName(event.target.value)} placeholder="Customer name" /></label>
          <label>First message<textarea value={leadDraft} onChange={event => setLeadDraft(event.target.value)} placeholder="Write a message…" /></label>
          <footer><button type="button" onClick={() => setStage("paste")}>Back</button><button className="cic-send" type="button" onClick={sendLead} disabled={sendWorkspaceMessage.isPending || !leadPhone.trim() || !leadDraft.trim()}>{sendWorkspaceMessage.isPending ? "Sending…" : "Send & create"}<Send size={13} /></button></footer>
        </>}
      </section>
    </div>
  );
}

function SuperAlertOverlay({ alert, pending, onReply }: { alert: { id: number; messageId: number; senderName: string; messageBody: string }; pending: boolean; onReply: () => void }) {
  return <div className="ccc-live-super-alert" role="alertdialog" aria-modal="true" aria-label={`Super Alert from ${alert.senderName}`}><section><header><Zap /><span><strong>Super Alert</strong><small>From {alert.senderName}</small></span></header><p>{alert.messageBody}</p><small>You were tagged twice. Reply in the linked Command Chat thread to acknowledge it.</small><button type="button" disabled={pending} onClick={onReply}>{pending ? <Loader2 className="animate-spin" /> : <MessageSquare />}Reply in thread</button></section></div>;
}

function PhotoLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return <div className="ccc-live-photo-lightbox" onMouseDown={onClose} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }} role="dialog" aria-modal="true" aria-label="Command attachment preview" tabIndex={-1} ref={(element) => element?.focus()}><button type="button" aria-label="Close photo" onMouseDown={(event) => event.stopPropagation()} onClick={onClose}><X /></button><img src={commandAttachmentUrl(url)} alt="Full-size command attachment" onMouseDown={(event) => event.stopPropagation()} /></div>;
}

function LiveMessage({ message, callerName, photoUrl, voiceCallIdentityByVapiId, mentionPattern, superAlert, reactions, onOpenPhoto, onThread, onReply, onReaction }: { message: ChannelMessage; callerName: string; photoUrl: string | null; voiceCallIdentityByVapiId: Map<string, VoiceCallerIdentity>; mentionPattern: RegExp | null; superAlert: boolean; reactions: Record<string, { count: number; names: string[] }>; onOpenPhoto: (url: string) => void; onThread: () => void; onReply: () => void; onReaction: (emoji: string) => void }) {
  const mine = message.from === callerName;
  const team = message.role === "agent" && !mine;
  const system = message.role === "system";
  const media = mediaUrls(message.mediaUrl);
  const confirmationReply = confirmationReplyFromMessage(message);
  const callHandoff = callHandoffFromMessage(message);
  let bookedByAgentName: string | null = null;
  if (message.quickAction === "announce_booking") {
    try {
      const metadata = JSON.parse(message.metadata ?? "{}") as { bookedByAgentName?: unknown };
      if (typeof metadata.bookedByAgentName === "string" && metadata.bookedByAgentName.trim()) {
        bookedByAgentName = metadata.bookedByAgentName.trim();
      }
    } catch { /* preserve the generic message for legacy rows */ }
  }
  const voiceCaller = callHandoff?.vapiCallId ? voiceCallIdentityByVapiId.get(callHandoff.vapiCallId) : null;
  const resolvedCallHandoff = callHandoff ? {
    ...callHandoff,
    callerName: voiceCaller?.callerName || callHandoff.callerName,
    callerPhone: voiceCaller?.callerPhone || callHandoff.callerPhone,
  } : null;
  if (confirmationReply) return <ConfirmationReplyCard alert={confirmationReply} timestamp={message.ts} />;
  if (resolvedCallHandoff) return <IncomingCallHandoffCard handoff={resolvedCallHandoff} timestamp={message.ts} />;
  if (system) return <div className="ccc-message ccc-message-system"><span><Activity />{renderMessageBody(message.body)}<time>{formatTime(message.ts)}</time></span></div>;
  return <article id={`ccc-command-message-${message.id}`} className={`ccc-group-message ccc-group-message-${team ? "team" : "customer"} ccc-group-message-${mine ? "right" : "left"} ${superAlert ? "ccc-live-super-alert-message" : ""}`}><Avatar name={message.from} photoUrl={photoUrl} className={`ccc-group-avatar ${team ? "ccc-group-avatar-team" : "ccc-group-avatar-dispatch"}`} /><div><div className="ccc-message-meta"><strong>{message.from}</strong><em>{team ? "Team" : mine ? "You" : "Office"}</em>{superAlert && <em className="ccc-live-super-alert-badge"><Zap />Super Alert</em>}<time>{formatTime(message.ts)}</time></div><p>{renderMessageBody(message.body, mentionPattern)}</p>{bookedByAgentName && <small>Booked by {bookedByAgentName}</small>}{media.length > 0 && <div className="ccc-live-message-media">{media.map((url) => <button type="button" key={url} onClick={() => onOpenPhoto(url)} aria-label="Open command attachment"><img src={commandAttachmentUrl(url)} alt="Command attachment" /></button>)}</div>}{message.replyToBody && <button type="button" className="ccc-live-quoted-reply" onClick={onThread}>Replying to {message.replyToAuthor}: {message.replyToBody}</button>}<div className="ccc-live-message-tools">{Object.entries(reactions).map(([emoji, value]) => <button type="button" key={emoji} onClick={() => onReaction(emoji)} title={value.names.join(", ")}>{emoji} {value.count}</button>)}<button type="button" onClick={() => onReaction("👍")}>👍</button><button type="button" className="ccc-live-quote-reply-action" onClick={onReply}>Reply</button><button type="button" onClick={onThread}>Thread {message.replyCount > 0 && <b>{message.replyCount}</b>}</button></div></div></article>;
}

function formatCallDuration(seconds: number | null) {
  if (!seconds || seconds < 1) return "—";
  return seconds < 60 ? `0:${String(seconds).padStart(2, "0")}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function outcomeLabel(outcome: string) {
  return outcome.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function IncomingCallHandoffCard({ handoff, timestamp }: { handoff: IncomingCallHandoff; timestamp: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const recordingUrl = proxyRecordingUrl(handoff.recordingUrl);
  const playLabel = recordingUrl ? (playing ? "Pause incoming call recording" : "Play incoming call recording") : "Recording unavailable";
  const togglePlayback = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) void audioRef.current.play();
    else audioRef.current.pause();
  };
  return <article className="ccc-voice-handoff" aria-label={`AI-handled inbound call from ${handoff.callerName}`}>
    <header><div className="ccc-voice-handoff-identity"><img src={customerPortraitFor(handoff.callerName)} alt={`Caller portrait illustration for ${handoff.callerName}`} /><span><strong>{handoff.callerName}</strong><small><AudioLines />AI-handled inbound call{handoff.callerPhone && <>{" · "}{handoff.callerPhone}</>}</small></span></div><b>{outcomeLabel(handoff.outcome)}</b></header>
    <div className="ccc-voice-handoff-player"><button type="button" aria-label={playLabel} disabled={!recordingUrl} onClick={togglePlayback}><Play fill="currentColor" /></button><span className="ccc-voice-handoff-waveform" aria-hidden="true">{VOICE_HANDOFF_BARS.map((height, index) => <i key={index} className={index < 11 ? "is-blue" : index < 30 ? "is-olive" : index < 41 ? "is-amber" : "is-silver"} style={{ height: `${height}%` }} />)}</span><time>{formatCallDuration(handoff.durationSeconds)}</time></div>
    {recordingUrl && <audio ref={audioRef} src={recordingUrl} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} preload="metadata" />}
    <footer><span><Headphones />{recordingUrl ? (playing ? "Playing call recording" : "Recording available") : "No recording stored"}</span><time>{dateLabel(timestamp)} · {formatTime(timestamp)}</time></footer>
  </article>;
}

function renderMentionBody(body: string, mentionPattern: RegExp | null): ReactNode {
  if (!mentionPattern) return body;
  const matches = Array.from(body.matchAll(new RegExp(mentionPattern.source, "gi")));
  if (!matches.length) return body;
  const content: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    if (start > cursor) content.push(body.slice(cursor, start));
    content.push(<mark className="ccc-live-mention" key={`${start}-${index}`}>{match[0]}</mark>);
    cursor = start + match[0].length;
  });
  if (cursor < body.length) content.push(body.slice(cursor));
  return content;
}

const MESSAGE_URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

function messageUrlHref(value: string) {
  return value.startsWith("www.") ? `https://${value}` : value;
}

function renderMessageBody(body: string, mentionPattern: RegExp | null = null): ReactNode {
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const match of Array.from(body.matchAll(MESSAGE_URL_PATTERN))) {
    const start = match.index ?? 0;
    if (start > cursor) content.push(renderMentionBody(body.slice(cursor, start), mentionPattern));
    const rawUrl = match[0];
    const punctuation = rawUrl.match(/[.,!;:]+$/)?.[0] ?? "";
    const url = punctuation ? rawUrl.slice(0, -punctuation.length) : rawUrl;
    content.push(<a className="ccc-live-message-link" href={messageUrlHref(url)} target="_blank" rel="noreferrer" key={`${start}-${url}`}>{url}</a>);
    if (punctuation) content.push(punctuation);
    cursor = start + rawUrl.length;
  }
  if (cursor < body.length) content.push(renderMentionBody(body.slice(cursor), mentionPattern));
  return content.length ? content : body;
}

function ConfirmationReplyCard({ alert, timestamp }: { alert: ConfirmationReplyAlert; timestamp: number }) {
  const isCancellation = alert.intent === "cancellation";
  const attachmentHost = alert.replyUrl ? (() => {
    try { return new URL(alert.replyUrl).hostname.replace(/^www\./, ""); } catch { return "external attachment"; }
  })() : null;
  const status = isCancellation ? "Cancellation request" : "Needs clarification";
  return <article className={`ccc-group-message ccc-group-message-left ccc-live-confirmation-message ${isCancellation ? "is-cancellation" : "is-unclear"}`}>
    <span className={`ccc-group-avatar ccc-live-confirmation-avatar ${isCancellation ? "is-cancellation" : "is-unclear"}`}><Phone /></span>
    <div>
      <div className="ccc-message-meta"><strong>{alert.customerName}</strong><em>{status}</em><time>{formatTime(timestamp)}</time></div>
      <p><span className="ccc-live-confirmation-label">Confirmation reply</span>{alert.serviceDate && <span className="ccc-live-confirmation-date">Service date · {alert.serviceDate}</span>}{alert.replyUrl ? <>Media link received · {attachmentHost}</> : <>“{alert.replyText}”</>}</p>
      <a className="ccc-live-confirmation-action" href="/admin/confirmation-calls">Open Confirmation Calls <ChevronRight /></a>
    </div>
  </article>;
}

function ThreadPanel({ thread, callerName, draft, pending, photoMap, onDraft, onSend, onClose }: { thread: { parent: { id: number; ts: number; from: string; role: string; body: string; mediaUrl: string | null; quickAction: string | null; threadParentId: number | null } | null; replies: Array<{ id: number; ts: number; from: string; role: string; body: string; mediaUrl: string | null; quickAction: string | null; threadParentId: number | null }> } | undefined; callerName: string; draft: string; pending: boolean; photoMap: Record<string, string | null>; onDraft: (value: string) => void; onSend: () => void; onClose: () => void }) {
  return <section className="ccc-live-thread-panel" aria-label="Command thread"><header><div><MessageSquare /><span><strong>Thread</strong><small>Command discussion</small></span></div><button type="button" aria-label="Close command thread" onClick={onClose}><X /></button></header><div className="ccc-live-thread-messages">{!thread?.parent ? <div className="ccc-live-empty"><Loader2 className="animate-spin" />Loading thread…</div> : <><LiveThreadEntry entry={thread.parent} mine={thread.parent.from === callerName} photo={photoMap[thread.parent.from] ?? null} root />{thread.replies.map((entry) => <LiveThreadEntry entry={entry} key={entry.id} mine={entry.from === callerName} photo={photoMap[entry.from] ?? null} />)}</>}</div><footer><textarea value={draft} onChange={(event) => onDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder="Reply in thread…" /><button type="button" disabled={!draft.trim() || pending} onClick={onSend}>{pending ? <Loader2 className="animate-spin" /> : <Send />}</button></footer></section>;
}

function SmsInboxRow({ conversation, onOpen }: { conversation: SmsInboxConversation; onOpen: () => void }) {
  const name = smsConversationName(conversation);
  const timestamp = smsInboxTimestamp(conversation);
  const preview = conversation.aiSummary?.trim() || conversation.lastMessageText?.trim() || "No message preview available.";
  const time = timestamp && Date.now() - timestamp < 86_400_000 ? formatTime(timestamp) : timestamp ? dateLabel(timestamp) : "";
  return <button type="button" className="ccc-live-sms-row" onClick={onOpen}>
    {conversation.personType === "team" ? <span className="ccc-live-sms-team-avatar"><Users /></span> : <img src={customerPortraitFor(name)} alt={`Client portrait illustration for ${name}`} />}
    <span className="ccc-live-sms-row-copy"><strong>{name}</strong><small>{preview}</small></span>
    <span className="ccc-live-sms-row-meta"><time>{time}</time><i className={conversation.hasUnanswered ? "is-unread" : ""} /></span>
  </button>;
}

function EmailInboxRow({ thread, onOpen }: { thread: EmailInboxThread; onOpen: () => void }) {
  const name = emailThreadName(thread);
  const timestamp = thread.lastMessageAt;
  const time = timestamp && Date.now() - timestamp < 86_400_000 ? formatTime(timestamp) : timestamp ? dateLabel(timestamp) : "";
  const preview = [emailThreadSubject(thread.subject), thread.snippet?.trim()].filter(Boolean).join(" · ") || "No email preview available.";
  return <button type="button" className="ccc-live-sms-row ccc-live-email-row" onClick={onOpen}>
    <img src={customerPortraitFor(name)} alt={`Client portrait illustration for ${name}`} />
    <span className="ccc-live-sms-row-copy"><strong>{name}</strong><small>{preview}</small></span>
    <span className="ccc-live-sms-row-meta"><time>{time}</time><i className={thread.isUnread ? "is-unread" : ""} /></span>
  </button>;
}

function TeamSmsFeedMessage({ event, onOpen }: { event: TeamSmsStreamEvent; onOpen: () => void }) {
  const { name, body, ts: timestamp } = event;
  return <article className="ccc-group-message ccc-group-message-team ccc-group-message-left ccc-live-team-sms-message"><span className="ccc-group-avatar ccc-group-avatar-team"><Users /></span><div><div className="ccc-message-meta"><strong>{name}</strong><time>{formatTime(timestamp)}</time></div><button type="button" className="ccc-live-team-sms-card" onClick={onOpen} aria-label={`Open and reply to ${name}`}><p>{renderMessageBody(body)}</p><span className="ccc-live-team-reply-hint"><MessageSquare />Reply</span></button><div className="ccc-live-team-sms-reactions" aria-label="Team message reactions"><span><Heart fill="currentColor" /> <b>3</b></span><span><Users /></span></div></div></article>;
}

const CommandTimelineFeed = memo(function CommandTimelineFeed({ messagesLoading, timeline, callerName, photoMap, voiceCallIdentityByVapiId, mentionPattern, superAlertMessageIdSet, reactionsByMessage, teamSmsConversations, onOpenPhoto, onOpenThread, onReply, onReaction, onOpenSmsConversation }: {
  messagesLoading: boolean;
  timeline: CommandTimelineEntry[];
  callerName: string;
  photoMap: Record<string, string | null>;
  voiceCallIdentityByVapiId: Map<string, VoiceCallerIdentity>;
  mentionPattern: RegExp | null;
  superAlertMessageIdSet: Set<number>;
  reactionsByMessage: Record<number, Record<string, { count: number; names: string[] }>>;
  teamSmsConversations: Map<number, SmsInboxConversation>;
  onOpenPhoto: (url: string) => void;
  onOpenThread: (messageId: number) => void;
  onReply: (message: ChannelMessage) => void;
  onReaction: (messageId: number, emoji: string) => void;
  onOpenSmsConversation: (conversation: SmsInboxConversation) => void;
}) {
  if (messagesLoading) return <div className="ccc-live-empty"><Loader2 className="animate-spin" />Loading channel…</div>;
  if (timeline.length === 0) return <div className="ccc-live-empty"><MessageSquare />No messages match this view.</div>;
  return <>{timeline.map((entry) => entry.kind === "internal" ? <LiveMessage key={entry.id} message={entry.message} callerName={callerName} photoUrl={photoMap[entry.message.from] ?? null} voiceCallIdentityByVapiId={voiceCallIdentityByVapiId} mentionPattern={mentionPattern} superAlert={superAlertMessageIdSet.has(entry.message.id)} reactions={reactionsByMessage[entry.message.id] ?? {}} onOpenPhoto={onOpenPhoto} onThread={() => onOpenThread(entry.message.id)} onReply={() => onReply(entry.message)} onReaction={(emoji) => onReaction(entry.message.id, emoji)} /> : <TeamSmsFeedMessage key={entry.id} event={entry.event} onOpen={() => { const conversation = teamSmsConversations.get(entry.event.sessionId); if (conversation) onOpenSmsConversation(conversation); }} />)}</>;
});


function AwayStatusControl({
  status,
  pending,
  onSetStatus,
}: {
  status: AwayStatus;
  pending: boolean;
  onSetStatus: (status: AwayStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const updateMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = window.matchMedia("(max-width: 1120px)").matches ? 204 : 218;
    setMenuPosition({
      top: Math.max(8, rect.top - 8),
      left: Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    updateMenuPosition();
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  if (status) return <div className="ccc-live-away-control" ref={controlRef}>
    <button type="button" className="ccc-live-away-trigger is-away" onClick={() => onSetStatus(null)} disabled={pending} aria-label="Mark yourself available">
      {pending ? <Loader2 className="animate-spin" /> : <CircleDot />}<span>I&apos;m Back</span>
    </button>
  </div>;

  return <div className="ccc-live-away-control" ref={controlRef}>
    <button type="button" className="ccc-live-away-trigger" ref={triggerRef} onClick={() => { if (open) { setOpen(false); } else { updateMenuPosition(); setOpen(true); } }} disabled={pending} aria-expanded={open} aria-haspopup="menu">
      {pending ? <Loader2 className="animate-spin" /> : <CircleDot />}<span>Away</span><ChevronDown />
    </button>
    {open && menuPosition && typeof document !== "undefined" && createPortal(<div className="ccc-live-away-menu" ref={menuRef} role="menu" aria-label="Set away status" style={menuPosition}>
      <p>Set status</p>
      {AWAY_STATUSES.map((option) => <button type="button" key={option.key} role="menuitem" className={`ccc-live-away-option tone-${option.tone}`} onClick={() => { setOpen(false); onSetStatus(option.key); }}>
        <span>{option.emoji}</span><div><strong>{option.label}</strong><small>{option.sub}</small></div>
      </button>)}
    </div>, document.body)}
  </div>;
}

const CommandComposer = memo(function CommandComposer({
  authorName,
  mentionNames,
  photoMap,
  replyTarget,
  onClearReplyTarget,
  onOptimisticMessage,
  onOutgoingFailure,
  onNotice,
}: {
  authorName: string;
  mentionNames: string[];
  photoMap: Record<string, string | null>;
  replyTarget: QuoteReplyTarget | null;
  onClearReplyTarget: (messageId?: number) => void;
  onOptimisticMessage: (message: ChannelMessage) => void;
  onOutgoingFailure: (messageId: number) => void;
  onNotice: (message: string) => void;
}) {
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(0);
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const previousReplyTargetIdRef = useRef<number | null>(null);
  const autoReplyMentionRef = useRef<{ replyId: number; prefix: string } | null>(null);
  const mentionSuggestions = useMemo(
    () => mentionQuery === null ? [] : mentionNames.filter((name) => name.toLowerCase().startsWith(mentionQuery.toLowerCase())),
    [mentionNames, mentionQuery],
  );
  const uploadPhoto = trpc.opsChat.uploadOpsPhoto.useMutation({ onError: () => onNotice("Photo upload failed. Please try again.") });
  const transcribeVoice = trpc.opsChat.transcribeVoiceNote.useMutation({
    onSuccess: (result) => setDraft((value) => [value, result.text].filter(Boolean).join(value ? "\n" : "")),
    onError: () => onNotice("Voice note could not be transcribed."),
  });
  const sendMessage = trpc.opsChat.sendMessage.useMutation();

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!replyTarget) {
      previousReplyTargetIdRef.current = null;
      return;
    }
    if (previousReplyTargetIdRef.current === replyTarget.id) return;
    previousReplyTargetIdRef.current = replyTarget.id;
    const prefix = `@${replyTarget.author} `;
    setDraft((value) => {
      const priorAutoMention = autoReplyMentionRef.current;
      const withoutPriorAutoMention = priorAutoMention && value.startsWith(priorAutoMention.prefix)
        ? value.slice(priorAutoMention.prefix.length)
        : value;
      if (withoutPriorAutoMention.startsWith(prefix)) {
        autoReplyMentionRef.current = null;
        return withoutPriorAutoMention;
      }
      autoReplyMentionRef.current = { replyId: replyTarget.id, prefix };
      return `${prefix}${withoutPriorAutoMention}`;
    });
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [replyTarget]);

  const cancelReply = useCallback(() => {
    const target = replyTarget;
    const autoReplyMention = autoReplyMentionRef.current;
    if (target && autoReplyMention?.replyId === target.id) {
      setDraft((value) => value.startsWith(autoReplyMention.prefix) ? value.slice(autoReplyMention.prefix.length) : value);
    }
    autoReplyMentionRef.current = null;
    onClearReplyTarget(target?.id);
  }, [onClearReplyTarget, replyTarget]);

  const selectMention = useCallback((name: string) => {
    const selectionEnd = composerRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(selectionEnd);
    const next = `${before}@${name} ${after}`;
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const cursor = `${before}@${name} `.length;
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(cursor, cursor);
    });
  }, [draft, mentionStart]);

  const updateMentionQuery = useCallback((value: string, selectionStart: number) => {
    setDraft(value);
    const before = value.slice(0, selectionStart);
    const match = before.match(/@([\w\s]*)$/);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    setMentionStart(selectionStart - match[0].length);
    setMentionIndex(0);
    setMentionQuery(match[1]);
  }, []);

  const submitMessage = useCallback(() => {
    if (sendMessage.isPending) return;
    const body = draft.trim();
    if (!body && !attachmentUrls.length) return;
    const sentAttachments = attachmentUrls;
    const sentMediaUrl = sentAttachments.length ? JSON.stringify(sentAttachments) : null;
    const sentAt = Date.now();
    const sentReplyTarget = replyTarget;
    const localMessage: ChannelMessage = {
      id: -sentAt,
      ts: sentAt,
      from: authorName,
      role: "office",
      body: body || "Photo",
      mediaUrl: sentMediaUrl,
      quickAction: null,
      metadata: null,
      replyToId: sentReplyTarget?.id ?? null,
      replyToBody: sentReplyTarget?.body ?? null,
      replyToAuthor: sentReplyTarget?.author ?? null,
      threadParentId: null,
      threadParentBody: null,
      threadParentFrom: null,
      replyCount: 0,
    };
    onOptimisticMessage(localMessage);
    setDraft("");
    setAttachmentUrls([]);
    sendMessage.mutate({
      channel: "command",
      body: localMessage.body,
      authorName,
      authorRole: "office",
      mediaUrl: sentMediaUrl ?? undefined,
      replyToId: sentReplyTarget?.id,
      replyToBody: sentReplyTarget?.body.slice(0, 512),
      replyToAuthor: sentReplyTarget?.author,
    }, {
      onSuccess: () => {
        if (sentReplyTarget) onClearReplyTarget(sentReplyTarget.id);
        void utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
        void utils.opsChat.getChannelCounts.invalidate();
      },
      onError: () => {
        onOutgoingFailure(localMessage.id);
        setDraft((current) => current || body);
        setAttachmentUrls((current) => current.length ? current : sentAttachments);
      },
    });
  }, [attachmentUrls, authorName, draft, onClearReplyTarget, onOptimisticMessage, onOutgoingFailure, replyTarget, sendMessage, utils]);

  const stageImage = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files?.[0];
    event.target.value = "";
    if (!image) return;
    if (!image.type.startsWith("image/")) {
      onNotice("Command Chat supports image attachments only.");
      return;
    }
    try {
      const dataBase64 = await fileToBase64(image);
      const result = await uploadPhoto.mutateAsync({ filename: image.name, mimeType: image.type, dataBase64 });
      setAttachmentUrls((urls) => [...urls, result.url]);
    } catch {
      // The mutation reports its own failure through the notice callback.
    }
  }, [onNotice, uploadPhoto]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onNotice("Voice recording is unavailable in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderChunks.current = [];
      streamRef.current = stream;
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) recorderChunks.current.push(event.data); });
      recorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        const blob = new Blob(recorderChunks.current, { type: recorder.mimeType || "audio/webm" });
        void blobToBase64(blob).then((dataBase64) => transcribeVoice.mutate({ dataBase64, mimeType: blob.type || "audio/webm" }));
      });
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      onNotice("Microphone access was not granted.");
    }
  }, [onNotice, recording, transcribeVoice]);

  return <div className="ccc-composer">
    {mentionQuery !== null && mentionSuggestions.length > 0 && <div className="ccc-live-mention-picker" role="listbox" aria-label="Mention a team member">{mentionSuggestions.map((name, index) => <button type="button" role="option" aria-selected={index === mentionIndex} className={index === mentionIndex ? "active" : ""} key={name} onMouseDown={(event) => { event.preventDefault(); selectMention(name); }}><Avatar name={name} photoUrl={photoMap[name] ?? null} /><span>{name}</span><small>@{name}</small></button>)}</div>}
    <div className="ccc-live-composer-body">
      {replyTarget && <div className="ccc-live-reply-preview"><span><MessageSquare /></span><div><strong>Replying to @{replyTarget.author}</strong><p>{replyTarget.body}</p></div><button type="button" onClick={cancelReply} aria-label="Cancel quoted reply"><X /></button></div>}
      {attachmentUrls.length > 0 && <div className="ccc-live-attachments">{attachmentUrls.map((url) => <span key={url}><img src={url} alt="Pending command attachment" /><button type="button" onClick={() => setAttachmentUrls((urls) => urls.filter((item) => item !== url))}><X /></button></span>)}</div>}
      <textarea ref={composerRef} value={draft} onChange={(event) => updateMentionQuery(event.target.value, event.target.selectionStart ?? event.target.value.length)} onKeyDown={(event) => { if (mentionQuery !== null && mentionSuggestions.length > 0) { if (event.key === "ArrowDown") { event.preventDefault(); setMentionIndex((index) => Math.min(index + 1, mentionSuggestions.length - 1)); return; } if (event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((index) => Math.max(index - 1, 0)); return; } if (event.key === "Tab") { event.preventDefault(); selectMention(mentionSuggestions[mentionIndex]); return; } if (event.key === "Escape") { event.preventDefault(); setMentionQuery(null); return; } } if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); setMentionQuery(null); submitMessage(); } }} placeholder={recording ? "Recording voice note…" : "Message the command channel…"} />
      <div className="ccc-composer-tools"><span><button type="button" aria-label="Attach image" disabled={uploadPhoto.isPending} onClick={() => fileInputRef.current?.click()}>{uploadPhoto.isPending ? <Loader2 className="animate-spin" /> : <Paperclip />}</button><button type="button" aria-label={recording ? "Stop voice recording" : "Record voice note"} disabled={transcribeVoice.isPending} onClick={() => void toggleRecording()}>{recording ? <span className="ccc-live-recording" /> : transcribeVoice.isPending ? <Loader2 className="animate-spin" /> : <Mic />}</button><button type="button" aria-label="Add check mark" onClick={() => setDraft((value) => `${value}${value ? " " : ""}✅`)}><Check /></button></span><button type="button" className="ccc-send" disabled={sendMessage.isPending || (!draft.trim() && !attachmentUrls.length)} onClick={submitMessage}>{sendMessage.isPending ? <Loader2 className="animate-spin" /> : <Send />}Send</button></div>
    </div>
    <input ref={fileInputRef} type="file" accept="image/*" className="ccc-live-file-input" onChange={(event) => void stageImage(event)} />
  </div>;
});

function ExactEmailWorkspaceOverlay({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  return <div className="ccc-live-email-workspace-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="ccc-live-email-workspace-modal" role="dialog" aria-modal="true" aria-label="Email conversation" onMouseDown={(event) => event.stopPropagation()}>
      <CommandChatEmailDetail initialThreadId={threadId} onCloseDetail={onClose} detailOnly />
    </section>
  </div>;
}

function SmsConversationDrawer({ conversation, conversations, callerName, callerPhotoUrl, photoMap, businessDate, leadCardPhone, leadDraft, lead, onNotice, onOpenLeadDetails, onSessionResolved, onClose }: { conversation: SmsInboxConversation; conversations: SmsInboxConversation[]; callerName: string; callerPhotoUrl: string | null; photoMap: Record<string, string | null>; businessDate: string; leadCardPhone?: string | null; leadDraft?: { scenario: string; jobContext: string } | null; lead: CommandLead | null; onNotice: (message: string) => void; onOpenLeadDetails: (lead: CommandLead) => void; onSessionResolved: (sessionId: number) => void; onClose: () => void }) {
  const utils = trpc.useUtils();
  const isTeamConversation = conversation.personType === "team";
  const contextPhone = conversation.leadPhone || "0000000";
  const [draft, setDraft] = useState("");
  const [smsAutoDraftLoading, setSmsAutoDraftLoading] = useState(false);
  const [smsAutoDraftReady, setSmsAutoDraftReady] = useState(false);
  const [smsAutoDraftText, setSmsAutoDraftText] = useState("");
  const [smsAutoDraftMinimized, setSmsAutoDraftMinimized] = useState(false);
  const [confirmedOutgoing, setConfirmedOutgoing] = useState<SmsInboxMessage[]>([]);
  const [quoteAssistantOpen, setQuoteAssistantOpen] = useState(false);
  const [quoteAssistantFields, setQuoteAssistantFields] = useState<QuoteAssistantFields | null>(null);
  const [quoteAssistantMissing, setQuoteAssistantMissing] = useState<string[]>([]);
  const [quoteAssistantPrice, setQuoteAssistantPrice] = useState<number | null>(null);
  const [quoteAssistantError, setQuoteAssistantError] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);
  const smsComposerRef = useRef<HTMLTextAreaElement>(null);
  const initialBottomScrollDone = useRef(false);
  const scrollAfterSendRef = useRef(false);
  const smsAutoDraftAbortRef = useRef<AbortController | null>(null);
  const autoDraftedForConversationRef = useRef<number | null>(null);
  const smsAutoDraftSessionIdRef = useRef<number | null>(conversation.id);
  const { data: detail } = trpc.leads.getCsConversation.useQuery(
    { sessionId: conversation.id },
    { enabled: conversation.id > 0, staleTime: 0, refetchOnWindowFocus: false, refetchInterval: 30_000 },
  );
  const { data: clientProfile } = trpc.leadflowJobs.customerProfile.useQuery(
    { phone: contextPhone },
    { enabled: !isTeamConversation && Boolean(conversation.leadPhone), staleTime: 30_000, refetchOnWindowFocus: false, refetchInterval: 60_000 },
  );
  const { data: teamIdentity } = trpc.leadflowJobs.teamIdentityByPhone.useQuery(
    { phone: contextPhone },
    { enabled: isTeamConversation && Boolean(conversation.leadPhone), staleTime: 5 * 60_000, refetchOnWindowFocus: false },
  );
  const { data: teamSchedule } = trpc.leadflowSchedule.getSchedule.useQuery(
    { date: businessDate },
    { enabled: isTeamConversation && teamIdentity?.launch27TeamId != null, staleTime: 30_000, refetchOnWindowFocus: false, refetchInterval: 60_000 },
  );
  const name = smsConversationName(conversation);
  const activeScheduleTeam = useMemo(() => {
    if (!teamIdentity?.launch27TeamId) return null;
    return teamSchedule?.teams.find((team) => team.launch27TeamId === teamIdentity.launch27TeamId) ?? null;
  }, [teamIdentity?.launch27TeamId, teamSchedule?.teams]);
  const teamRoute = useMemo(() => {
    if (!activeScheduleTeam) return [];
    return (teamSchedule?.jobs ?? [])
      .filter((job) => job.assignment?.teamId === activeScheduleTeam.id)
      .sort((left, right) => (left.assignment?.routeOrder ?? Number.MAX_SAFE_INTEGER) - (right.assignment?.routeOrder ?? Number.MAX_SAFE_INTEGER));
  }, [activeScheduleTeam, teamSchedule?.jobs]);
  const messages = useMemo(() => {
    let parsed: SmsInboxMessage[] = [];
    try { parsed = JSON.parse(detail?.messageHistory ?? "[]") as SmsInboxMessage[]; } catch { parsed = []; }
    const persisted = parsed.filter((message) => Boolean(message.content?.trim()));
    const notYetPersisted = confirmedOutgoing.filter((outgoing) => !persisted.some((message) =>
      message.role === outgoing.role && message.content === outgoing.content && Math.abs((message.ts ?? 0) - (outgoing.ts ?? 0)) < 15_000,
    ));
    return [...persisted, ...notYetPersisted].sort((left, right) => (left.ts ?? 0) - (right.ts ?? 0));
  }, [confirmedOutgoing, detail?.messageHistory]);
  const smsConversationContext = useMemo(() => messages.slice(-5)
    .map((message) => `${message.role === "user" ? "Customer" : "Agent"}: ${message.content}`)
    .join("\n"), [messages]);
  const smsAutoDraft = trpc.opsChat.csReply.useMutation({
    onSuccess: (data) => {
      if (smsAutoDraftSessionIdRef.current !== conversation.id) return;
      const replyText = typeof data.reply === "string" ? data.reply : "";
      if (replyText) {
        setSmsAutoDraftText(replyText);
        setSmsAutoDraftReady(true);
      }
      setSmsAutoDraftLoading(false);
    },
    onError: () => {
      if (smsAutoDraftSessionIdRef.current === conversation.id) setSmsAutoDraftLoading(false);
    },
  });
  const streamSmsAutoDraft = useCallback(async () => {
    if ((!smsConversationContext && !leadDraft?.scenario && !leadDraft?.jobContext) || autoDraftedForConversationRef.current === conversation.id) return;
    autoDraftedForConversationRef.current = conversation.id;
    if (smsAutoDraftAbortRef.current) smsAutoDraftAbortRef.current.abort();
    const controller = new AbortController();
    smsAutoDraftAbortRef.current = controller;
    const request = { conversationContext: smsConversationContext, customerName: name, jobContext: leadDraft?.jobContext ?? "", scenario: leadDraft?.scenario ?? "" };
    setSmsAutoDraftText("");
    setSmsAutoDraftReady(false);
    setSmsAutoDraftLoading(true);
    try {
      const response = await fetch("/api/cs-reply-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (smsAutoDraftSessionIdRef.current !== conversation.id) {
          void reader.cancel();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataString = trimmed.slice(5).trim();
          if (dataString === "[DONE]") continue;
          let event: { token?: string; error?: string };
          try { event = JSON.parse(dataString); } catch { continue; }
          if (event.error) throw new Error(event.error);
          if (event.token) {
            accumulated += event.token;
            setSmsAutoDraftText(accumulated);
          }
        }
      }
      if (!accumulated.trim()) {
        if (smsAutoDraftSessionIdRef.current !== conversation.id) return;
        setSmsAutoDraftText("");
        setSmsAutoDraftLoading(true);
        smsAutoDraft.mutate(request);
        return;
      }
      if (smsAutoDraftSessionIdRef.current === conversation.id) {
        setSmsAutoDraftReady(true);
        setSmsAutoDraftLoading(false);
      }
      if (smsAutoDraftAbortRef.current === controller) smsAutoDraftAbortRef.current = null;
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      if (smsAutoDraftSessionIdRef.current !== conversation.id) return;
      console.warn("[command-chat sms auto-draft] falling back to tRPC:", error);
      setSmsAutoDraftText("");
      setSmsAutoDraftLoading(true);
      smsAutoDraft.mutate(request);
    }
  }, [conversation.id, leadDraft?.jobContext, leadDraft?.scenario, name, smsAutoDraft, smsConversationContext]);
  const regenerateSmsDraft = useCallback(() => {
    autoDraftedForConversationRef.current = null;
    void streamSmsAutoDraft();
  }, [streamSmsAutoDraft]);
  const insertSmsAutoDraft = useCallback(() => {
    if (!smsAutoDraftText.trim()) return;
    setDraft(smsAutoDraftText);
    setSmsAutoDraftReady(false);
  }, [smsAutoDraftText]);
  const prepareQuoteAssistant = trpc.commandCenter.prepareQuoteAssistant.useMutation({
    onSuccess: (result) => {
      setQuoteAssistantFields({ ...result.quoteInputs, condition: result.quoteInputs.condition ?? 5 });
      setQuoteAssistantMissing(result.missing);
      setQuoteAssistantPrice(result.priceDollars);
      setQuoteAssistantError("");
      setQuoteAssistantOpen(true);
    },
    onError: (error) => setQuoteAssistantError(error.message || "Quote details could not be prepared."),
  });
  const createQuoteAssistant = trpc.bookingFunnel.createCustomerLink.useMutation({
    onSuccess: (result) => {
      const selectedExtras = quoteAssistantFields?.extras ?? [];
      const extras = selectedExtras.length
        ? selectedExtras.map((extra) => `${QUOTE_EXTRA_ICONS[extra.id] ?? "✨"} ${extra.quantity > 1 ? `${extra.quantity} × ` : ""}${QUOTE_EXTRA_OPTIONS.find(([id]) => id === extra.id)?.[1] ?? extra.id}`).join("\n")
        : "No add-ons selected";
      const serviceType = quoteAssistantFields?.serviceType ?? "Home cleaning";
      const bedrooms = quoteAssistantFields?.bedrooms ?? "your";
      const bathrooms = quoteAssistantFields?.bathrooms ?? "home";
      const quoteUrl = result.urlPath.startsWith("http") ? result.urlPath : `${window.location.origin}${result.urlPath}`;
      const bedroomCount = bedrooms.match(/\d+/)?.[0] ?? bedrooms;
      const homeType = quoteHomeType(lead?.propertyType || null).toLowerCase();
      const serviceLabel = serviceType.toLowerCase().replace("move-in / move-out cleaning", "move-out cleaning");
      const quoteMessage = `Hey ${firstName(name)}! 👋 Madison from Maids in Black here. I put together your quote.\n\nHere’s what your ${serviceLabel} quote includes:\n\n🧼 Full ${serviceLabel}\n🏠 ${bedroomCount}-bedroom ${homeType}\n${extras}\n✅ Background-checked and insured team\n\nYour first-cleaning quote is $${(result.firstCleaningTotalCents / 100).toFixed(0)}. You can review the details and choose your time here:\n${quoteUrl}`;
      setDraft(quoteMessage);
      setQuoteAssistantOpen(false);
      setQuoteAssistantError("");
      onNotice("Quote created and added to the SMS composer for review.");
    },
    onError: (error) => setQuoteAssistantError(error.message || "Quote link could not be created."),
  });
  const openQuoteAssistant = useCallback(() => {
    setQuoteAssistantError("");
    prepareQuoteAssistant.mutate({ conversationContext: smsConversationContext, leadFacts: quoteAssistantLeadFacts(lead) });
  }, [lead, prepareQuoteAssistant, smsConversationContext]);
  const resizeSmsComposer = useCallback((composer: HTMLTextAreaElement) => {
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 240)}px`;
  }, []);
  useEffect(() => {
    smsAutoDraftSessionIdRef.current = conversation.id;
    autoDraftedForConversationRef.current = null;
    setDraft("");
    setSmsAutoDraftReady(false);
    setSmsAutoDraftText("");
    setSmsAutoDraftLoading(false);
    setSmsAutoDraftMinimized(false);
    setQuoteAssistantOpen(false);
    setQuoteAssistantFields(null);
    setQuoteAssistantMissing([]);
    setQuoteAssistantPrice(null);
    setQuoteAssistantError("");
    setConfirmedOutgoing([]);
    initialBottomScrollDone.current = false;
    scrollAfterSendRef.current = false;
    return () => {
      smsAutoDraftSessionIdRef.current = null;
      smsAutoDraftAbortRef.current?.abort();
      smsAutoDraftAbortRef.current = null;
    };
  }, [conversation.id]);
  useEffect(() => {
    if (smsComposerRef.current) resizeSmsComposer(smsComposerRef.current);
  }, [draft, resizeSmsComposer]);
  useEffect(() => {
    if (conversation.id > 0 && !detail && !leadDraft?.scenario && !leadDraft?.jobContext) return;
    if (messages.length === 0 && !leadDraft?.scenario && !leadDraft?.jobContext) return;
    void streamSmsAutoDraft();
  }, [conversation.id, detail, leadDraft?.jobContext, leadDraft?.scenario, messages.length, streamSmsAutoDraft]);
  useEffect(() => {
    if (!detail || (initialBottomScrollDone.current && !scrollAfterSendRef.current)) return;
    const animationFrame = requestAnimationFrame(() => {
      if (!messageListRef.current) return;
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
      initialBottomScrollDone.current = true;
      scrollAfterSendRef.current = false;
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [conversation.id, detail, messages.length]);
  const sendReply = trpc.leads.sendMessage.useMutation({
    onSuccess: (result, variables) => {
      setDraft("");
      if (!result.duplicate) {
        scrollAfterSendRef.current = true;
        setConfirmedOutgoing((current) => [...current, { role: "assistant", content: variables.message, senderName: callerName, ts: Date.now() }]);
      }
      void utils.commandCenter.listCommandChatInbox.invalidate();
      void utils.leads.getCsConversation.invalidate({ sessionId: conversation.id });
    },
  });
  const sendWorkspaceMessage = trpc.leads.sendWorkspaceMessage.useMutation({
    onSuccess: (result, variables) => {
      setDraft("");
      scrollAfterSendRef.current = true;
      setConfirmedOutgoing((current) => [...current, { role: "assistant", content: variables.message, senderName: callerName, ts: Date.now() }]);
      void utils.commandCenter.listCommandChatInbox.invalidate();
      void utils.leads.getCsConversation.invalidate({ sessionId: conversation.id });
      if (leadCardPhone && result.sessionId > 0) onSessionResolved(result.sessionId);
      if (!result.success) onNotice("Message was not sent.");
    },
    onError: (error) => onNotice(error.message || "Message could not be sent."),
  });
  const submit = () => {
    const message = draft.trim();
    if (!message) return;
    if (leadCardPhone) {
      sendWorkspaceMessage.mutate({ phone: leadCardPhone, message, name: conversation.leadName ?? undefined });
      return;
    }
    sendReply.mutate({
      sessionId: conversation.id,
      message,
      fromNumberId: getCsInboxReplyPhoneNumberIdForSelectedConversation(conversation, conversations),
      source: "cs_inbox",
    });
  };
  return <div className="ccc-live-sms-backdrop" onMouseDown={onClose}><aside className="ccc-live-sms-drawer" onMouseDown={(event) => event.stopPropagation()}>
    <header><div>{isTeamConversation ? <span className="ccc-live-sms-drawer-team"><Users /></span> : <img src={customerPortraitFor(name)} alt={`Client portrait illustration for ${name}`} />}<span><strong>{name}{!isTeamConversation && <em className="ccc-live-sms-drawer-source">{lead?.sourceLabel || displayLeadSource(conversation.leadSource)}</em>}</strong><small>{isTeamConversation ? "Team text conversation" : conversation.leadPhone || "Text conversation"}</small></span></div><div className="ccc-live-sms-drawer-header-actions">{!isTeamConversation && lead && <button type="button" className="ccc-live-sms-drawer-detail" aria-label={`View lead details for ${name}`} title="View lead details" onClick={() => onOpenLeadDetails(lead)}><Eye /></button>}<button type="button" aria-label="Close text conversation" onClick={onClose}><X /></button></div></header>
    {!isTeamConversation && clientProfile?.upcoming && (() => { const isToday = clientProfile.upcoming.date === businessDate; const etaLabel = teamRouteEtaLabel(clientProfile.upcoming.jobStatus, clientProfile.upcoming.etaTimestamp); return <section className="ccc-live-sms-booking-context" aria-label="Client's next booking"><div><CalendarClock /><span><b>Next booking</b><small>{bookingDateLabel(clientProfile.upcoming.date, businessDate)}</small></span></div><strong>{clientProfile.upcoming.serviceName || "Scheduled service"}</strong><small>{clientProfile.upcoming.teamName || "Team pending"}</small>{isToday && <span className={`ccc-live-sms-job-status ccc-live-sms-booking-status ${teamRouteStatusClass(clientProfile.upcoming.jobStatus)}`}><TeamRouteStatusIcon status={clientProfile.upcoming.jobStatus} /><b>{teamRouteStatusLabel(clientProfile.upcoming.jobStatus)}</b>{etaLabel && <small>{etaLabel}</small>}</span>}</section>; })()}
    {!isTeamConversation && <button type="button" className="ccc-live-sms-quote-assistant-trigger" onClick={openQuoteAssistant} disabled={prepareQuoteAssistant.isPending}><Sparkles />{prepareQuoteAssistant.isPending ? "Reading lead details…" : "Create quote with AI"}</button>}
    {isTeamConversation && activeScheduleTeam && <section className="ccc-live-sms-team-schedule" aria-label={`${activeScheduleTeam.name} schedule for today`}><header><span><CalendarClock />Today&apos;s schedule</span><b>{teamRoute.length} {teamRoute.length === 1 ? "stop" : "stops"}</b></header>{teamRoute.length ? <ol>{teamRoute.slice(0, 4).map((job) => { const etaLabel = teamRouteEtaLabel(job.jobStatus, job.etaTimestamp); return <li key={job.id}><time>{scheduleTimeLabel(job.serviceDateTime)}</time><strong>{job.customerName || "Customer"}</strong><span className={`ccc-live-sms-job-status ${teamRouteStatusClass(job.jobStatus)}`}><TeamRouteStatusIcon status={job.jobStatus} /><b>{teamRouteStatusLabel(job.jobStatus)}</b>{etaLabel && <small>{etaLabel}</small>}</span></li>; })}</ol> : <p>No scheduled stops today.</p>}{teamRoute.length > 4 && <a href="/admin/schedule">View all {teamRoute.length} stops <ChevronRight /></a>}</section>}
    {conversation.aiSummary?.trim() && <div className="ccc-live-sms-summary"><Sparkles /><span><b>AI summary</b><small>{conversation.aiSummary}</small></span></div>}
    <div className="ccc-live-sms-messages" ref={messageListRef}>{!detail ? <div className="ccc-live-empty"><Loader2 className="animate-spin" />Loading text history…</div> : messages.map((message, index) => {
      const outgoing = message.role !== "user";
      const senderName = message.senderName?.trim() || callerName;
      const senderPhotoUrl = photoMap[senderName] ?? (senderName === callerName ? callerPhotoUrl : null);
      return <article className={`ccc-live-sms-message ${outgoing ? "is-outgoing" : ""}`} key={`${message.ts ?? index}-${message.content}`}><small>{outgoing ? <span className="ccc-live-sms-outbound-sender"><Avatar name={senderName} photoUrl={senderPhotoUrl} className="ccc-live-sms-outbound-avatar" />{senderName}</span> : conversation.personType === "team" ? name : "Customer"}{message.ts ? ` · ${formatTime(message.ts)}` : ""}</small><p>{renderMessageBody(message.content)}</p></article>;
    })}</div>
    <footer>
      {smsAutoDraftLoading && <div className="ccc-live-sms-ai-draft-status" aria-live="polite"><RefreshCw className="animate-spin" /><span>AI is drafting a reply…</span></div>}
      {!smsAutoDraftLoading && smsAutoDraftReady && smsAutoDraftText && <article className={`ccc-live-sms-ai-draft-card ${smsAutoDraftMinimized ? "is-minimized" : ""}`}><header><span><Sparkles />World-class draft</span><small>Review before sending</small><button type="button" className="ccc-live-sms-ai-draft-toggle" aria-label={smsAutoDraftMinimized ? "Expand world-class draft" : "Minimize world-class draft"} aria-expanded={!smsAutoDraftMinimized} title={smsAutoDraftMinimized ? "Expand draft" : "Minimize draft"} onClick={() => setSmsAutoDraftMinimized((value) => !value)}><ChevronDown /></button></header>{!smsAutoDraftMinimized && <><p>{smsAutoDraftText}</p><div><button type="button" className="ccc-live-sms-ai-draft-insert" onClick={insertSmsAutoDraft}><Pencil />Insert into reply</button><button type="button" className="ccc-live-sms-ai-draft-regenerate" onClick={regenerateSmsDraft}><RefreshCw />Regenerate</button></div></>}</article>}
      <div className="ccc-live-sms-composer"><textarea ref={smsComposerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onInput={(event) => resizeSmsComposer(event.currentTarget)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder={smsAutoDraftLoading ? "" : "Write a text reply…"} /><button type="button" disabled={!draft.trim() || sendReply.isPending || sendWorkspaceMessage.isPending} aria-label="Send text reply" onClick={submit}>{sendReply.isPending || sendWorkspaceMessage.isPending ? <Loader2 className="animate-spin" /> : <Send />}</button></div>
    </footer>
    {quoteAssistantOpen && quoteAssistantFields && <QuoteAssistantModal
      customerName={name}
      customerPhone={leadCardPhone || conversation.leadPhone || ""}
      fields={quoteAssistantFields}
      initialMissing={quoteAssistantMissing}
      priceDollars={quoteAssistantPrice}
      error={quoteAssistantError}
      pending={createQuoteAssistant.isPending}
      onFieldsChange={setQuoteAssistantFields}
      onClose={() => { setQuoteAssistantOpen(false); setQuoteAssistantError(""); }}
      onCreate={() => createQuoteAssistant.mutate({
        customerName: name,
        customerPhone: leadCardPhone || conversation.leadPhone || "",
        requestedLocalDate: nextQuoteDate(),
        requestedLocalTime: quoteRequestedTime(lead),
        address: lead?.address || undefined,
        pricing: {
          pricingMode: "home",
          serviceId: quoteServiceId(quoteAssistantFields.serviceType),
          bedrooms: Number.parseInt(quoteAssistantFields.bedrooms || "0", 10),
          bathrooms: Number.parseInt(quoteAssistantFields.bathrooms || "1", 10),
          homeType: quoteHomeType(lead?.propertyType || null),
          condition: quoteAssistantFields.condition ?? 5,
          maidCount: 1,
          hourCount: 1,
          extras: quoteAssistantFields.extras || [],
          recurrence: "one-time",
        },
        notes: [lead?.summary, lead?.description, lead?.detail].filter((value): value is string => Boolean(value?.trim())),
      })}
    />}
  </aside></div>;
}

function QuoteAssistantModal({ customerName, customerPhone, fields, initialMissing, priceDollars, error, pending, onFieldsChange, onClose, onCreate }: {
  customerName: string;
  customerPhone: string;
  fields: QuoteAssistantFields;
  initialMissing: string[];
  priceDollars: number | null;
  error: string;
  pending: boolean;
  onFieldsChange: (fields: QuoteAssistantFields) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const currentMissing = [
    !fields.bedrooms && "bedrooms",
    !fields.bathrooms && "bathrooms",
    !fields.serviceType && "serviceType",
    !fields.condition && "condition",
    !(fields.extrasConfirmed || fields.extras !== null) && "extras",
  ].filter((value): value is string => Boolean(value));
  const toggleExtra = (id: string, checked: boolean) => {
    const extras = fields.extras ?? [];
    onFieldsChange({
      ...fields,
      extras: checked ? [...extras.filter((extra) => extra.id !== id), { id, quantity: 1 }] : extras.filter((extra) => extra.id !== id),
      extrasConfirmed: true,
    });
  };
  return <div className="ccc-modal-backdrop ccc-live-quote-assistant-backdrop" onMouseDown={onClose}>
    <section className="ccc-static-modal ccc-live-quote-assistant-modal" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><Sparkles /><span><strong>Create quote with AI</strong><small>Review the extracted details before creating the link</small></span></div><button type="button" onClick={onClose} aria-label="Close quote assistant"><X /></button></header>
      <div className="ccc-live-quote-assistant-customer"><strong>{customerName}</strong><span>{formatPhoneDisplay(customerPhone)}</span></div>
      <div className="ccc-live-quote-assistant-grid">
        <label>Bedrooms<input value={fields.bedrooms ?? ""} onChange={(event) => onFieldsChange({ ...fields, bedrooms: event.target.value || null })} placeholder="e.g. 2 Bedrooms" /></label>
        <label>Bathrooms<input value={fields.bathrooms ?? ""} onChange={(event) => onFieldsChange({ ...fields, bathrooms: event.target.value || null })} placeholder="e.g. 1 Bathroom" /></label>
        <label>Cleaning type<select value={fields.serviceType ?? ""} onChange={(event) => onFieldsChange({ ...fields, serviceType: event.target.value || null })}><option value="">Select type</option><option>Standard Cleaning</option><option>Deep Cleaning</option><option>Move-In / Move-Out Cleaning</option></select></label>
        <label>Home condition (1–10)<input type="number" min="1" max="10" value={fields.condition ?? ""} onChange={(event) => onFieldsChange({ ...fields, condition: event.target.value ? Number(event.target.value) : null })} placeholder="5" /></label>
      </div>
      <fieldset className="ccc-live-quote-assistant-extras"><legend>Included add-ons</legend>{QUOTE_EXTRA_OPTIONS.map(([id, label]) => <label key={id}><input type="checkbox" checked={Boolean(fields.extras?.some((extra) => extra.id === id))} onChange={(event) => toggleExtra(id, event.target.checked)} />{label}</label>)}<label><input type="checkbox" checked={fields.extrasConfirmed === true && fields.extras?.length === 0} onChange={(event) => { if (event.target.checked) onFieldsChange({ ...fields, extras: [], extrasConfirmed: true }); }} />No add-ons</label></fieldset>
      {priceDollars !== null && currentMissing.length === 0 && <div className="ccc-live-quote-assistant-price">Verified first-cleaning price <strong>${priceDollars.toFixed(0)}</strong></div>}
      {currentMissing.length > 0 && <p className="ccc-live-quote-assistant-missing">Review required: {currentMissing.join(", ")}. {initialMissing.length > 0 && "AI left these blank because they were not explicit in the conversation."}</p>}
      {error && <p className="ccc-live-quote-assistant-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="button" className="ccc-live-quote-assistant-create" disabled={pending || !customerPhone.trim() || currentMissing.length > 0} onClick={onCreate}>{pending ? <Loader2 className="animate-spin" /> : <Sparkles />}{pending ? "Creating…" : "Create quote & add SMS"}</button></footer>
    </section>
  </div>;
}

function LiveThreadEntry({ entry, mine, photo, root = false }: { entry: { from: string; body: string; ts: number }; mine: boolean; photo: string | null; root?: boolean }) {
  return <article className={`ccc-live-thread-entry ${mine ? "is-mine" : ""} ${root ? "is-root" : ""}`}><Avatar name={entry.from} photoUrl={photo} className="ccc-group-avatar" /><div><div><strong>{entry.from}</strong><time>{formatTime(entry.ts)}</time></div><p>{renderMessageBody(entry.body)}</p></div></article>;
}

function ActionModal({ kind, onClose, issueTitle, issueNotes, issueType, reminderBody, reminderMinutes, pinBody, bookingPerson, bookingAmount, bookingNote, onIssueTitle, onIssueNotes, onIssueType, onReminderBody, onReminderMinutes, onPinBody, onBookingPerson, onBookingAmount, onBookingNote, pending, onSubmit }: { kind: Exclude<ModalKind, null>; onClose: () => void; issueTitle: string; issueNotes: string; issueType: (typeof ISSUE_TYPES)[number][0]; reminderBody: string; reminderMinutes: number; pinBody: string; bookingPerson: string; bookingAmount: string; bookingNote: string; onIssueTitle: (value: string) => void; onIssueNotes: (value: string) => void; onIssueType: (value: (typeof ISSUE_TYPES)[number][0]) => void; onReminderBody: (value: string) => void; onReminderMinutes: (value: number) => void; onPinBody: (value: string) => void; onBookingPerson: (value: string) => void; onBookingAmount: (value: string) => void; onBookingNote: (value: string) => void; pending: boolean; onSubmit: () => void }) {
  const config = { issue: ["Open issue", "Post issue"], reminder: ["Set reminder", "Schedule reminder"], pin: ["Pin a note", "Pin note"], booking: ["Announce booking", "Announce"] } as const;
  const [title, action] = config[kind];
  const valid = kind === "issue" ? issueTitle.trim() : kind === "reminder" ? reminderBody.trim() : kind === "pin" ? pinBody.trim() : bookingPerson.trim();
  return <div className="ccc-modal-backdrop" onMouseDown={onClose}><section className="ccc-static-modal ccc-live-action-modal" onMouseDown={(event) => event.stopPropagation()}><header><div>{kind === "issue" ? <AlertTriangle /> : kind === "reminder" ? <CalendarClock /> : kind === "pin" ? <Pin /> : <Sparkles />}<span><strong>{title}</strong><small>Command channel action</small></span></div><button type="button" onClick={onClose}><X /></button></header>{kind === "issue" && <><label>Issue title<input value={issueTitle} onChange={(event) => onIssueTitle(event.target.value)} placeholder="What needs attention?" autoFocus /></label><label>Type<select value={issueType} onChange={(event) => onIssueType(event.target.value as (typeof ISSUE_TYPES)[number][0])}>{ISSUE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Notes<textarea value={issueNotes} onChange={(event) => onIssueNotes(event.target.value)} placeholder="Add relevant context…" /></label></>}{kind === "reminder" && <><label>Reminder<textarea value={reminderBody} onChange={(event) => onReminderBody(event.target.value)} placeholder="What should the team remember?" autoFocus /></label><div className="ccc-live-minute-pills">{[5, 15, 30, 60].map((minutes) => <button type="button" className={reminderMinutes === minutes ? "active" : ""} key={minutes} onClick={() => onReminderMinutes(minutes)}>{minutes < 60 ? `${minutes} min` : "1 hour"}</button>)}</div></>}{kind === "pin" && <label>Note<textarea value={pinBody} onChange={(event) => onPinBody(event.target.value)} placeholder="Keep this at the top of the channel…" autoFocus /></label>}{kind === "booking" && <><label>Customer name<input value={bookingPerson} onChange={(event) => onBookingPerson(event.target.value)} placeholder="Customer name" autoFocus /></label><label>Amount <input value={bookingAmount} onChange={(event) => onBookingAmount(event.target.value)} placeholder="Optional, e.g. $320 recurring" /></label><label>Note<textarea value={bookingNote} onChange={(event) => onBookingNote(event.target.value)} placeholder="Optional context for the team" /></label></>}<footer><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={!valid || pending} onClick={onSubmit}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{action}</button></footer></section></div>;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

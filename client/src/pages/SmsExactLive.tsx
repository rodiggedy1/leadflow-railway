import { useEffect, useMemo, useRef, useState } from "react";
import Picker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  HelpCircle,
  Link2,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Smile,
  Sparkles,
  Tag,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { proxyRecordingUrl } from "@/lib/utils";
import { useOpsStream } from "@/hooks/useOpsStream";
import { getCsInboxReplyPhoneNumberIdForSelectedConversation } from "@shared/csInboxPhoneNumberRouting";
import { batchCsInboxPhonesForNameLookup, mergeCsInboxNameMaps } from "@shared/csInboxPhoneNameBatching";
import { getUnansweredUrgencyWindow, qualifiesForAtRisk } from "@shared/csAtRisk";
import { SERVICE_AGREEMENT_SMS } from "@shared/csServiceAgreement";
import { buildDefaultQuoteSms } from "@shared/quoteSmsTemplate";
import { EXTRAS_LIST, calculateExtrasTotal } from "@shared/extras";
import { toast } from "sonner";
import FAQPanel from "@/components/FAQPanel";
import ObjectionsPanel from "@/components/ObjectionsPanel";
import WorldClassReplyPanel from "@/components/WorldClassReplyPanel";
import InsertResponseModal from "@/components/InsertResponseModal";
import CsRightPanelClient from "@/components/CsRightPanelClient";
import CsRightPanelTeam from "@/components/CsRightPanelTeam";
import "./operations-crm-review.css";
import "./cs-inbox-crm-review.css";
import "./sms-review.css";
import "./sms-leads-cohesion.css";
import "./sms-identity-portraits.css";
import "./sms-exact-live.css";

type Lane = "New" | "Needs Response" | "Waiting on Customer" | "At Risk";
type MsgSender = "client" | "agent" | "system" | "cleaner" | "note";
type CustomerMission = "payment" | "quote" | "agreement";
type RawMessage = { role: string; content: string; ts?: number; senderName?: string; media?: string[] };
type CallEntry = { id: number; outcome: string; summary: string | null; durationSeconds: number; recordingUrl: string | null; transcript: string | null; createdAt: number };
type PaymentLinkConfirmCard = { recipientName: string; recipientFirstName: string; recipientPhone: string; paymentLinkUrl: string; expiresAt: number; smsText: string };
type InlineClientProfile = { todayJob?: unknown | null } | null | undefined;

type LiveConversation = {
  id: number;
  name: string;
  initials: string;
  phone: string;
  queue: string | null;
  lastMessage: string;
  wait: string;
  lastMsgTs?: number;
  hasUnanswered: boolean;
  csResolvedAt?: string | Date | null;
  csStatusTier?: string | null;
  lastSenderRole?: string | null;
  lastCustomerMessageTs?: number | null;
  messageCount?: number | null;
  createdAt?: string | Date | number | null;
  messages: { sender: MsgSender; text: string; time: string; ts?: number; senderName?: string; media?: string[] }[];
  chips: string[];
  latestInteractionType?: "call" | "sms";
  latestCallCreatedAt?: number | null;
  latestCallDuration?: number | null;
  latestCallSummary?: string | null;
  latestCallRecordingUrl?: string | null;
  lastInboundPhoneNumberId?: string | null;
  personType?: "team" | "customer";
};

const LANES: Lane[] = ["New", "Needs Response", "Waiting on Customer", "At Risk"];
const LANE_COLORS: Record<Lane, string> = {
  New: "#3478f6",
  "Needs Response": "#13b77a",
  "Waiting on Customer": "#8b5cf6",
  "At Risk": "#ff9f1a",
};

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

const QUOTE_BASE_PRICE: Record<number, number> = { 1: 119, 2: 209, 3: 229, 4: 279, 5: 319, 6: 379, 7: 419 };
const QUOTE_BATH_PRICE = 30;
const QUOTE_SERVICE_SURCHARGES: Record<string, number> = { "Standard Cleaning": 0, "Deep Cleaning": 60, "Move-In/Move-Out": 60, "Post-Construction Cleaning": 60 };
const QUOTE_SERVICE_TYPES = ["Standard Cleaning", "Deep Cleaning", "Move-In/Move-Out", "Post-Construction Cleaning"];
const QUOTE_BATH_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4];
const QUOTE_EXTRA_KEYS = ["clean_inside_oven", "clean_inside_cabinets", "clean_inside_full_fridge", "clean_interior_windows", "clean_finished_basement", "move_in_move_out", "i_have_pets", "same_day_booking"];

function customerPortraitFor(value: string) {
  const hash = Array.from(value).reduce((total, character) => total + character.charCodeAt(0), 0);
  return CUSTOMER_PORTRAITS[Math.abs(hash) % CUSTOMER_PORTRAITS.length];
}

function mediaDisplayUrl(url: string) {
  return url.includes(".r2.dev/") || url.includes("r2.cloudflarestorage.com") || url.includes("storage.vapi.ai")
    ? `/api/media-proxy?url=${encodeURIComponent(url)}`
    : url;
}

function isVideoMedia(url: string) {
  return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url);
}

function imageMediaUrls(urls: string[]) {
  return urls.filter(url => !isVideoMedia(url));
}

function isTeamMember(conversation: LiveConversation) {
  return conversation.queue === "Teams" || conversation.personType === "team";
}

function relativeTime(timestamp?: number | null) {
  if (!timestamp) return "—";
  const age = Math.max(0, Date.now() - timestamp);
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h`;
  return `${Math.floor(age / 86_400_000)}d`;
}

function conversationTime(row: Record<string, unknown>, lastMessage?: RawMessage) {
  const callTime = row.latestInteractionType === "call" ? Number(row.latestCallCreatedAt ?? 0) : 0;
  return callTime || Number(row.lastMsgTs ?? 0) || lastMessage?.ts || 0;
}

function toConversation(row: Record<string, unknown>, names: Record<string, string>): LiveConversation {
  let rawMessages: RawMessage[] = [];
  try { rawMessages = JSON.parse(String(row.messageHistory ?? "[]")); } catch { rawMessages = []; }
  const lastMessage = rawMessages.at(-1);
  const phone = String(row.leadPhone ?? "");
  const phone10 = phone.replace(/[^\d]/g, "").slice(-10);
  const name = names[phone10] || String(row.leadName ?? "") || phone || "Unknown";
  const effectiveTime = conversationTime(row, lastMessage);
  const unanswered = Boolean(row.hasUnanswered ?? (lastMessage?.role === "user"));
  return {
    id: Number(row.id),
    name,
    initials: name.split(/\s+/).filter(Boolean).map(word => word[0]).join("").slice(0, 2).toUpperCase() || "?",
    phone,
    queue: typeof row.csQueue === "string" ? row.csQueue : null,
    lastMessage: lastMessage?.content || String(row.lastMessageText ?? ""),
    wait: relativeTime(effectiveTime),
    lastMsgTs: Number(row.lastMsgTs ?? 0) || undefined,
    hasUnanswered: unanswered,
    csResolvedAt: (row.csResolvedAt as string | Date | null | undefined) ?? null,
    csStatusTier: typeof row.csStatusTier === "string" ? row.csStatusTier : null,
    lastSenderRole: typeof row.lastSenderRole === "string" ? row.lastSenderRole : null,
    lastCustomerMessageTs: Number(row.lastCustomerMessageTs ?? 0) || null,
    messageCount: Number(row.messageCount ?? rawMessages.length) || null,
    createdAt: (row.createdAt as string | Date | number | null | undefined) ?? null,
    messages: rawMessages.map(message => ({
      sender: message.role === "user" ? "client" : message.role === "assistant" ? "agent" : message.role === "note" ? "note" : "system",
      text: message.content,
      time: message.ts ? new Date(message.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
      ts: message.ts,
      senderName: message.senderName,
      media: message.media ?? [],
    })),
    chips: [typeof row.csStatusTier === "string" ? row.csStatusTier : null, unanswered ? "Needs Reply" : null].filter(Boolean) as string[],
    latestInteractionType: row.latestInteractionType === "call" ? "call" : "sms",
    latestCallCreatedAt: Number(row.latestCallCreatedAt ?? 0) || null,
    latestCallDuration: Number(row.latestCallDuration ?? 0) || null,
    latestCallSummary: typeof row.latestCallSummary === "string" ? row.latestCallSummary : null,
    latestCallRecordingUrl: typeof row.latestCallRecordingUrl === "string" ? row.latestCallRecordingUrl : null,
    lastInboundPhoneNumberId: typeof row.lastInboundPhoneNumberId === "string" ? row.lastInboundPhoneNumberId : null,
    personType: row.personType === "team" ? "team" : "customer",
  };
}

function getCreatedTimestamp(conversation: LiveConversation) {
  if (!conversation.createdAt) return 0;
  return typeof conversation.createdAt === "number" ? conversation.createdAt : new Date(conversation.createdAt).getTime();
}

function getLane(conversation: LiveConversation, now: number): Lane {
  const day = 24 * 60 * 60 * 1000;
  if (conversation.latestInteractionType === "call" && conversation.latestCallCreatedAt) {
    const isFresh = now - conversation.latestCallCreatedAt < day && getCreatedTimestamp(conversation) >= now - day && (conversation.messageCount ?? 999) <= 2;
    return isFresh ? "New" : "Needs Response";
  }
  if (conversation.csResolvedAt) return "Waiting on Customer";
  const urgency = getUnansweredUrgencyWindow({
    lastSenderRole: conversation.lastSenderRole,
    lastCustomerMessageTs: conversation.lastCustomerMessageTs,
    now,
  });
  if (urgency === "at_risk") return "At Risk";
  if (urgency === "needs_response") return "Needs Response";
  const isNew = conversation.lastSenderRole === "user" && getCreatedTimestamp(conversation) >= now - day && (conversation.messageCount ?? 999) <= 2;
  return isNew ? "New" : "Waiting on Customer";
}

function LiveAvatar({ conversation, className, showPortrait = true }: { conversation: LiveConversation; className: string; showPortrait?: boolean }) {
  if (!isTeamMember(conversation) && showPortrait) {
    return <img className={`${className} cic-live-avatar cic-portrait`} src={customerPortraitFor(conversation.name)} alt={`Portrait illustration for ${conversation.name}`} />;
  }
  return <span className={`${className} cic-live-avatar ${isTeamMember(conversation) ? "is-team" : ""}`} aria-label={conversation.name}>{conversation.initials}</span>;
}

function LastAgentBadge({ name, photoUrl }: { name?: string | null; photoUrl?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = name?.split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "A";
  const label = name ? `Last human agent: ${name}` : "No human agent reply yet";
  if (!photoUrl || imageFailed) return <span className={`cic-owner-portrait${name ? " is-agent" : " is-unassigned"}`} title={label} aria-label={label}>{name ? initials : <UserRound size={10} />}</span>;
  return <img className="cic-owner-portrait cic-owner-photo" src={photoUrl} alt={label} title={label} onError={() => setImageFailed(true)} />;
}

function CrmSidebar({ total, needsResponse, atRisk, teams }: { total: number; needsResponse: number; atRisk: number; teams: number }) {
  return (
    <aside className="ocr-sidebar cic-sidebar">
      <div className="ocr-brand"><div className="ocr-logo-mark"><span /><span /><span /><span /></div><div><strong>Sales CRM</strong><span>Company pipeline</span></div></div>
      <div className="ocr-nav-scroll">
        <nav className="ocr-nav-primary"><button className="is-active" type="button"><MessageCircle />All Conversations <b>{total}</b></button><button type="button"><Mail />Email <b>—</b></button><button type="button"><Sparkles />Next Best Action</button></nav>
        <div className="ocr-nav-group"><p>VIEWS</p><button type="button"><i className="ocr-pipeline-dot dot-yellow" />Needs Response <b>{needsResponse}</b></button><button type="button"><i className="ocr-pipeline-dot dot-pink" />Unanswered <b>{atRisk}</b></button><button type="button"><i className="ocr-pipeline-dot dot-violet" />Hot Leads</button></div>
        <div className="ocr-nav-group"><p>TEAMS</p><button type="button"><Users />Dispatch <b>{teams}</b></button></div>
        <div className="ocr-nav-group"><p>REPORTING</p><button type="button"><CircleDot />Response health</button><button type="button"><AlertTriangle />At risk</button></div>
      </div>
      <div className="ocr-nav-utility"><button type="button"><Users />Invite teammates</button><button type="button"><HelpCircle />Help</button></div>
      <div className="ocr-sidebar-footer"><div className="ocr-trial"><div><strong>14 Days</strong><span>Left on trials</span></div><button type="button"><CreditCard />Add Billings</button></div></div>
    </aside>
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

function InlineCustomerMission({ mission, conversation, profile, close }: { mission: CustomerMission; conversation: LiveConversation; profile: InlineClientProfile; close: () => void }) {
  const jobSeed = (profile?.todayJob ?? {}) as { bedrooms?: string | null; bathrooms?: string | null; serviceType?: string | null };
  const [paymentCard, setPaymentCard] = useState<PaymentLinkConfirmCard | null>(null);
  const [paymentSmsText, setPaymentSmsText] = useState("");
  const [agreementText, setAgreementText] = useState(SERVICE_AGREEMENT_SMS);
  const [quoteStep, setQuoteStep] = useState<"configure" | "compose">("configure");
  const [quoteText, setQuoteText] = useState("");
  const [beds, setBeds] = useState(() => Math.min(Math.max(Number(String(jobSeed.bedrooms ?? "1").match(/\d+/)?.[0] ?? 1), 1), 7));
  const [baths, setBaths] = useState(() => QUOTE_BATH_OPTIONS.includes(Number(String(jobSeed.bathrooms ?? "1").match(/\d+\.?\d*/)?.[0] ?? 1)) ? Number(String(jobSeed.bathrooms ?? "1").match(/\d+\.?\d*/)?.[0] ?? 1) : 1);
  const [serviceType, setServiceType] = useState(() => QUOTE_SERVICE_TYPES.find(type => type.toLowerCase().includes(String(jobSeed.serviceType ?? "").toLowerCase().split(" ")[0])) ?? "Standard Cleaning");
  const [extras, setExtras] = useState<string[]>([]);
  const [finalPriceInput, setFinalPriceInput] = useState("");
  const [notes, setNotes] = useState("");
  const createPaymentLink = trpc.aiConcierge.chat.useMutation({ onSuccess: (result: unknown) => {
    const card = result as { type?: string } & PaymentLinkConfirmCard;
    if (card.type === "payment_link_confirm") { setPaymentCard(card); setPaymentSmsText(card.smsText); }
  } });
  const sendPaymentLink = trpc.aiConcierge.sendPaymentLinkSms.useMutation({ onSuccess: () => { toast.success("Payment link sent to customer."); close(); }, onError: error => toast.error(error.message || "Failed to send payment link") });
  const sendQuote = trpc.csMissions.sendQuoteSms.useMutation({ onSuccess: () => { toast.success("Quote sent to customer."); close(); }, onError: error => toast.error(error.message || "Failed to send quote") });
  const sendAgreement = trpc.csMissions.sendQuoteSms.useMutation({ onSuccess: () => { toast.success("Service agreement sent to customer."); close(); }, onError: error => toast.error(error.message || "Failed to send service agreement") });
  useEffect(() => {
    if (mission !== "payment") return;
    createPaymentLink.mutate({ message: `Send payment link to ${conversation.name}`, resolvedClientPhone: conversation.phone, resolvedPaymentLink: true, resolvedClientName: conversation.name });
  // A payment link is generated only when its visible mission flow is opened.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission, conversation.id]);
  const calculatedPrice = (QUOTE_BASE_PRICE[beds] ?? 119) + baths * QUOTE_BATH_PRICE + (QUOTE_SERVICE_SURCHARGES[serviceType] ?? 0) + calculateExtrasTotal(extras);
  const finalPrice = finalPriceInput === "" ? calculatedPrice : Math.max(0, Number(finalPriceInput) || 0);
  const firstName = conversation.name.split(" ")[0] || "there";
  const quoteUrl = (() => { const params = new URLSearchParams({ beds: String(beds), baths: String(baths), type: serviceType, price: String(calculatedPrice) }); if (finalPriceInput !== "") params.set("finalPrice", String(finalPrice)); if (calculatedPrice > finalPrice) params.set("discount", String(calculatedPrice - finalPrice)); if (notes.trim()) params.set("notes", notes.trim()); if (extras.length) params.set("extras", extras.join(",")); return `https://quote.maidinblack.com/welcome/${encodeURIComponent(firstName)}?${params.toString()}`; })();
  if (mission === "payment") return <section className="cic-inline-mission" aria-label="Send payment link"><header><span><CreditCard size={14} />Send Payment Link</span><button type="button" onClick={close} aria-label="Close payment link"><X size={14} /></button></header>{createPaymentLink.isPending && <p className="cic-inline-mission-loading">Generating a secure payment link…</p>}{paymentCard && <><p className="cic-inline-mission-recipient">To <b>{paymentCard.recipientName}</b> · {paymentCard.recipientPhone}</p><label>Message to send<textarea value={paymentSmsText} onChange={event => setPaymentSmsText(event.target.value)} rows={5} /></label><footer><a href={paymentCard.paymentLinkUrl} target="_blank" rel="noreferrer">View link <ExternalLink size={12} /></a><button className="cic-inline-send" type="button" disabled={!paymentSmsText.trim() || sendPaymentLink.isPending} onClick={() => sendPaymentLink.mutate({ recipientPhone: paymentCard.recipientPhone, recipientName: paymentCard.recipientName, smsText: paymentSmsText.trim(), paymentLinkUrl: paymentCard.paymentLinkUrl })}>{sendPaymentLink.isPending ? "Sending…" : `Send to ${paymentCard.recipientFirstName}`}</button></footer></>}</section>;
  if (mission === "agreement") return <section className="cic-inline-mission" aria-label="Send service agreement"><header><span><FileText size={14} />Send Service Agreement</span><button type="button" onClick={close} aria-label="Close service agreement"><X size={14} /></button></header><p className="cic-inline-mission-recipient">Send to <b>{conversation.name}</b></p><label>Message to send<textarea value={agreementText} onChange={event => setAgreementText(event.target.value)} rows={6} /></label><footer><span /><button className="cic-inline-send" type="button" disabled={!agreementText.trim() || sendAgreement.isPending} onClick={() => sendAgreement.mutate({ missionId: 0, sessionId: conversation.id, text: agreementText.trim() })}>{sendAgreement.isPending ? "Sending…" : `Send to ${firstName}`}</button></footer></section>;
  return <section className="cic-inline-mission cic-inline-quote" aria-label="Send quote"><header><span><FileText size={14} />Send Quote</span><button type="button" onClick={close} aria-label="Close quote"><X size={14} /></button></header>{quoteStep === "configure" ? <><div className="cic-inline-quote-grid"><label>Beds<select value={beds} onChange={event => setBeds(Number(event.target.value))}>{[1,2,3,4,5,6,7].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Baths<select value={baths} onChange={event => setBaths(Number(event.target.value))}>{QUOTE_BATH_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Type<select value={serviceType} onChange={event => setServiceType(event.target.value)}>{QUOTE_SERVICE_TYPES.map(value => <option key={value} value={value}>{value.replace(" Cleaning", "")}</option>)}</select></label></div><label>Extras<div className="cic-inline-extras">{QUOTE_EXTRA_KEYS.map(key => { const extra = EXTRAS_LIST.find(item => item.key === key); return extra ? <button key={key} type="button" className={extras.includes(key) ? "is-selected" : ""} onClick={() => setExtras(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])}>{extra.label} +${extra.price}</button> : null; })}</div></label><div className="cic-inline-price"><span>Calculated <b>${calculatedPrice}</b></span><label>Final $<input inputMode="decimal" value={finalPriceInput} onChange={event => setFinalPriceInput(event.target.value)} placeholder={String(calculatedPrice)} /></label></div><label>Notes <input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional notes for the quote" /></label><footer><span /><button className="cic-inline-send" type="button" onClick={() => { setQuoteText(buildDefaultQuoteSms({ firstName, welcomeUrl: quoteUrl, hasDiscount: calculatedPrice > finalPrice })); setQuoteStep("compose"); }}>Review message</button></footer></> : <><label>Message to send<textarea value={quoteText} onChange={event => setQuoteText(event.target.value)} rows={6} /></label><footer><button className="cic-inline-secondary" type="button" onClick={() => setQuoteStep("configure")}>Back</button><button className="cic-inline-send" type="button" disabled={!quoteText.trim() || sendQuote.isPending} onClick={() => sendQuote.mutate({ missionId: 0, sessionId: conversation.id, text: quoteText.trim() })}>{sendQuote.isPending ? "Sending…" : "Send Quote"}</button></footer></>}</section>;
}

function LiveCustomerPanel({ conversation, openTools, activeMission, setActiveMission }: { conversation: LiveConversation; openTools: () => void; activeMission: CustomerMission | null; setActiveMission: (mission: CustomerMission | null) => void }) {
  const { data: profile } = trpc.leadflowJobs.smsCustomerContext.useQuery({ phone: conversation.phone }, { enabled: !!conversation.phone, refetchOnWindowFocus: false, refetchInterval: 120_000 });
  const today = profile?.todayJob;
  return <aside className="cic-right-panel">
    <section className="cic-profile-head"><LiveAvatar conversation={conversation} className="cic-avatar big" /><div><b>{profile?.name ?? conversation.name}</b><span>{profile?.firstBookingDate ? `Customer since ${new Date(profile.firstBookingDate).getFullYear()}` : "Customer"}</span><strong><Phone size={12} />{conversation.phone}</strong></div></section>
    <section className="cic-live-missions"><header><b>Missions</b><button type="button" onClick={openTools}>+ Add</button></header><div><button className="cic-live-mission" type="button" onClick={() => setActiveMission(activeMission === "payment" ? null : "payment")}><i><CreditCard size={19} strokeWidth={1.8} /></i><span><b>Send Payment Link</b><small>Generate &amp; send a payment link via SMS.</small></span></button><button className="cic-live-mission" type="button" onClick={() => setActiveMission(activeMission === "quote" ? null : "quote")}><i><FileText size={19} strokeWidth={1.8} /></i><span><b>Send Quote</b><small>Build &amp; send a personalized quote.</small></span></button><button className="cic-live-mission" type="button" onClick={() => setActiveMission(activeMission === "agreement" ? null : "agreement")}><i><FileText size={19} strokeWidth={1.8} /></i><span><b>Send Service Agreement</b><small>Send the Satisfaction Guarantee via SMS.</small></span></button></div>{activeMission && <InlineCustomerMission key={`${conversation.id}-${activeMission}`} mission={activeMission} conversation={conversation} profile={profile} close={() => setActiveMission(null)} />}</section>
    <section><h3><CalendarDays />Today’s job</h3>{today ? <div className="cic-job"><header><b>{today.serviceDateTime ? new Date(today.serviceDateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Scheduled"}</b><span>{today.jobStatus ?? today.bookingStatus ?? "Scheduled"}</span></header><strong>{(today as { teamName?: string | null }).teamName ?? "Team pending"}</strong>{today.jobAddress && <p><MapPin size={12} />{today.jobAddress}</p>}<small>{today.serviceType ?? "Service details unavailable"}</small></div> : <div className="cic-live-empty">No job scheduled for today.</div>}</section>
    <section><h3>Client profile</h3><div className="cic-metric-grid"><span><small>Frequency</small><b>{profile?.frequency ?? "—"}</b></span><span><small>Avg price</small><b>{profile?.avgPrice ? `$${profile.avgPrice}` : "—"}</b></span><span><small>Total bookings</small><b>{profile?.totalBookings ?? "—"}</b></span><span><small>Last booking</small><b>{profile?.recentJobs?.[0]?.date ?? "—"}</b></span></div></section>
    <section><div className="cic-know"><header><Bot size={14} />Know before you reply</header><p><b>Last job</b>{profile?.recentJobs?.[0] ? `${profile.recentJobs[0].serviceType ?? "Service"} on ${profile.recentJobs[0].date ?? "a prior date"}` : "No prior booking history."}</p><p><b>History</b>{profile?.totalBookings ? `${profile.totalBookings} recorded booking${profile.totalBookings === 1 ? "" : "s"}.` : "No booking count available."}</p><p><b>Thread</b>{conversation.hasUnanswered ? "Customer is awaiting a reply." : "No current reply is required."}</p></div></section>
    <section><div className="cic-insight"><header><Sparkles size={14} />AI insight</header><p>Review the live customer and booking context before sending. Keep the reply concise and confirm facts that affect the appointment.</p></div></section>
    <section><h3>Recent jobs</h3><div className="cic-recent">{profile?.recentJobs?.length ? profile.recentJobs.slice(0, 2).map((job, index) => <span key={`${job.date}-${index}`}><b>{job.serviceType ?? "Service"}</b><small>{job.date ?? "—"} · {job.status ?? "—"}</small></span>) : <span><small>No recent jobs available.</small></span>}</div></section>
    <section><h3>Thread status</h3><div className="cic-status-stack"><button type="button" onClick={openTools}><Tag />Customers<ChevronRight /></button><button type="button" onClick={openTools}><CircleDot />{conversation.csStatusTier ?? getLane(conversation, Date.now())}<ChevronRight /></button><button type="button" onClick={openTools}><Bell />{conversation.wait} since last message<ChevronRight /></button></div></section>
  </aside>;
}

function LiveTeamPanel({ conversation, openTools }: { conversation: LiveConversation; openTools: () => void }) {
  const { data: cleanerProfile } = trpc.leads.getCleanerProfileByPhone.useQuery({ phone: conversation.phone }, { enabled: !!conversation.phone, refetchOnWindowFocus: false });
  const { data: todayJobs } = trpc.leadflowJobs.smsTeamTodayJobs.useQuery({ cleanerProfileId: cleanerProfile?.id ?? 0 }, { enabled: !!cleanerProfile?.id, refetchOnWindowFocus: false, refetchInterval: 60_000 });
  return <aside className="cic-right-panel">
    <section className="cic-profile-head team"><LiveAvatar conversation={conversation} className="cic-avatar big" /><div><b>{conversation.name}</b><span>Team member</span><strong><Phone size={12} />{conversation.phone}</strong></div></section>
    <section><header><b>Missions</b><button type="button" onClick={openTools}>+ Add</button></header><button className="cic-mission" type="button" onClick={openTools}><i><MapPin size={14} /></i><span><b>Get ETA</b><small>Open the team action panel.</small></span></button></section>
    <section><h3><CalendarDays />Today’s jobs</h3>{!todayJobs ? <div className="cic-live-empty">Loading today’s jobs…</div> : todayJobs.length === 0 ? <div className="cic-live-empty">No jobs scheduled today.</div> : todayJobs.map(job => <div className="cic-team-job" key={job.id}><header><b>{job.serviceDateTime ? new Date(job.serviceDateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</b><span className={job.jobStatus === "running_late" ? "is-late" : ""}>{String(job.jobStatus ?? job.bookingStatus ?? "Scheduled").replaceAll("_", " ")}</span></header><strong>{job.customerName || "Customer"}</strong>{job.jobAddress && <p><MapPin size={12} />{job.jobAddress}</p>}{job.jobStatus === "running_late" && job.delayMinutes ? <small><AlertTriangle size={11} />Running {job.delayMinutes} min late</small> : null}<footer><button type="button" onClick={openTools}><Phone />Call client</button><button type="button" onClick={openTools}><MessageCircle />Text client</button>{job.bookingId ? <a href={`https://maidsinblack.launch27.com/admin/bookings/${job.bookingId}`} target="_blank" rel="noreferrer">L27</a> : null}</footer></div>)}</section>
    <section><h3>Team actions</h3><div className="cic-team-actions"><button type="button" onClick={openTools}><Link2 />Send magic link</button><button type="button" onClick={openTools}><Copy />Copy magic link</button></div></section>
    <section><h3>Thread status</h3><div className="cic-status-stack"><button type="button" onClick={openTools}><Users />Teams<ChevronRight /></button><button type="button" onClick={openTools}><CircleDot />{conversation.csStatusTier ?? getLane(conversation, Date.now())}<ChevronRight /></button><button type="button" onClick={openTools}><Bell />{conversation.wait} since last message<ChevronRight /></button></div></section>
  </aside>;
}

function LiveToolDialog({ conversation, close, setCompose, messages }: { conversation: LiveConversation; close: () => void; setCompose: (value: string) => void; messages: { sender: MsgSender; text: string; ts?: number }[] }) {
  return <div className="cic-live-tools-backdrop" role="dialog" aria-modal="true" aria-label="Conversation actions" onClick={close}><section className="cic-live-tools" onClick={event => event.stopPropagation()}><header><span>Conversation actions</span><button type="button" onClick={close}><X /></button></header><div className="cic-live-tools-content">{isTeamMember(conversation) ? <CsRightPanelTeam selected={{ id: conversation.id, name: conversation.name, initials: conversation.initials, phone: conversation.phone, queue: conversation.queue, status: conversation.csStatusTier ?? undefined, wait: conversation.wait }} /> : <CsRightPanelClient selected={{ id: conversation.id, name: conversation.name, initials: conversation.initials, phone: conversation.phone, queue: conversation.queue, status: conversation.csStatusTier ?? undefined, wait: conversation.wait, stats: { bookings: 0, complaints: 0 } }} setCompose={setCompose} messages={messages} />}</div></section></div>;
}

export default function SmsExactLive() {
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<LiveConversation | null>(null);
  const [search, setSearch] = useState("");
  const [detailSearch, setDetailSearch] = useState("");
  const [detailFilter, setDetailFilter] = useState<"All" | "Leads" | "Teams">("All");
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [compose, setCompose] = useState("");
  const [composeMode, setComposeMode] = useState<"reply" | "note">("reply");
  const [faqOpen, setFaqOpen] = useState(false);
  const [objectionsOpen, setObjectionsOpen] = useState(false);
  const [worldClassOpen, setWorldClassOpen] = useState(false);
  const [responsesOpen, setResponsesOpen] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [activeMission, setActiveMission] = useState<CustomerMission | null>(null);
  const [expandedCalls, setExpandedCalls] = useState<Set<number>>(new Set());
  const [mmsLightbox, setMmsLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const selectedRef = useRef<LiveConversation | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const autoDraftedForRef = useRef<number | null>(null);
  const threadRef = useRef<HTMLElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  const { data: rawRows, refetch: refetchInbox, isLoading: inboxLoading } = trpc.leads.listCsInbox.useQuery(
    { showResolved: true },
    { staleTime: 30_000, refetchOnWindowFocus: false, refetchInterval: 5_000 },
  );
  const { data: agentPhotoMapData } = trpc.opsChat.getAllAgentPhotoMap.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const agentPhotoMap = agentPhotoMapData?.photos ?? {};
  const phoneBatches = useMemo(() => batchCsInboxPhonesForNameLookup(rawRows?.map(row => row.leadPhone)), [rawRows]);
  const nameCache = useRef(new Map<string, { expires: number; names: Record<string, string> }>());
  const [names, setNames] = useState<Record<string, string>>({});
  const mmsLightboxUrl = mmsLightbox ? mediaDisplayUrl(mmsLightbox.urls[mmsLightbox.index]) : null;
  const closeMmsLightbox = () => setMmsLightbox(null);
  const previousMmsPhoto = () => setMmsLightbox(current => current && current.index > 0 ? { ...current, index: current.index - 1 } : current);
  const nextMmsPhoto = () => setMmsLightbox(current => current && current.index < current.urls.length - 1 ? { ...current, index: current.index + 1 } : current);

  useEffect(() => {
    if (!mmsLightbox) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMmsLightbox();
      if (event.key === "ArrowLeft") previousMmsPhoto();
      if (event.key === "ArrowRight") nextMmsPhoto();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mmsLightbox]);
  useEffect(() => {
    let cancelled = false;
    const missing = phoneBatches.filter(batch => (nameCache.current.get(batch.join(","))?.expires ?? 0) <= Date.now());
    const publish = () => { if (!cancelled) setNames(mergeCsInboxNameMaps(phoneBatches.map(batch => nameCache.current.get(batch.join(","))?.names))); };
    if (!missing.length) { publish(); return () => { cancelled = true; }; }
    void Promise.allSettled(missing.map(async batch => {
      const fetched = await utils.leadflowJobs.smsResolveNames.fetch({ phones: batch });
      nameCache.current.set(batch.join(","), { names: fetched, expires: Date.now() + 60_000 });
    })).then(publish);
    return () => { cancelled = true; };
  }, [phoneBatches, utils]);

  const conversations = useMemo(() => (rawRows ?? []).map(row => toConversation(row as unknown as Record<string, unknown>, names)), [rawRows, names]);
  useEffect(() => { selectedIdRef.current = selected?.id ?? null; selectedRef.current = selected; }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const refreshed = conversations.find(conversation => conversation.id === selected.id);
    if (refreshed && refreshed.lastInboundPhoneNumberId !== selected.lastInboundPhoneNumberId) setSelected(current => current?.id === refreshed.id ? { ...current, lastInboundPhoneNumberId: refreshed.lastInboundPhoneNumberId } : current);
  }, [conversations, selected]);

  useOpsStream({ onLeadUpdate: () => {
    void utils.leads.listCsInbox.invalidate();
    if (selectedIdRef.current) void utils.leads.getCsConversation.invalidate({ sessionId: selectedIdRef.current });
  } }, { label: "SmsExactLive" });

  const now = Date.now();
  const activeConversations = useMemo(() => conversations.filter(conversation => {
    if (!conversation.csResolvedAt) return true;
    const resolved = new Date(conversation.csResolvedAt).getTime();
    return conversation.latestInteractionType === "call" && (conversation.latestCallCreatedAt ?? 0) > resolved;
  }), [conversations]);
  const needsResponseCount = activeConversations.filter(conversation => getUnansweredUrgencyWindow({ lastSenderRole: conversation.lastSenderRole, lastCustomerMessageTs: conversation.lastCustomerMessageTs, now }) === "needs_response").length;
  const atRiskCount = activeConversations.filter(conversation => qualifiesForAtRisk({ lastSenderRole: conversation.lastSenderRole, lastCustomerMessageTs: conversation.lastCustomerMessageTs, now })).length;
  const teamCount = activeConversations.filter(isTeamMember).length;
  const columns = useMemo(() => LANES.map(label => ({ label, conversations: activeConversations.filter(conversation => {
    const haystack = `${conversation.name} ${conversation.phone} ${conversation.lastMessage} ${conversation.csStatusTier ?? ""}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase()) && getLane(conversation, now) === label;
  }).sort((a, b) => (b.latestCallCreatedAt ?? b.lastMsgTs ?? 0) - (a.latestCallCreatedAt ?? a.lastMsgTs ?? 0)) })), [activeConversations, search, now]);
  const activeCardSessionIds = useMemo(
    () => [...new Set(columns.flatMap(column => column.conversations.map(conversation => conversation.id)))].sort((a, b) => a - b).slice(0, 800),
    [columns],
  );
  const lastAgentNames = trpc.leads.getCsInboxLastAgents.useQuery(
    { sessionIds: activeCardSessionIds },
    { enabled: activeCardSessionIds.length > 0, staleTime: 30_000, refetchOnWindowFocus: false },
  );
  const lastAgentNameBySessionId = lastAgentNames.data ?? {};

  const syncQuoOutbound = trpc.opsChat.syncCsOutboundMessages.useMutation({ onSuccess: (_result, variables) => { void utils.leads.listCsInbox.invalidate({ showResolved: true }); void utils.leads.getCsConversation.invalidate({ sessionId: variables.sessionId }); } });
  useEffect(() => {
    if (!selected || !selected.phone.trim()) return;
    syncQuoOutbound.mutate({ sessionId: selected.id, leadPhone: selected.phone });
  // This is the established outbound sync contract, scoped only to the selected conversation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.phone]);

  const { data: detail } = trpc.leads.getCsConversation.useQuery({ sessionId: selected?.id ?? 0 }, { enabled: !!selected, staleTime: 0, refetchOnWindowFocus: false, refetchInterval: 30_000 });
  const { data: clientProfile } = trpc.leadflowJobs.smsCustomerContext.useQuery({ phone: selected?.phone ?? "" }, { enabled: !!selected && !isTeamMember(selected), staleTime: 60_000, refetchOnWindowFocus: false });
  const detailMessages = useMemo(() => {
    const detailWithHistory = detail as (typeof detail & { messageHistory?: string }) | undefined;
    if (!detailWithHistory?.messageHistory) return selected?.messages ?? [];
    let source: RawMessage[] = [];
    try { source = JSON.parse(detailWithHistory.messageHistory); } catch { source = []; }
    return source.map(message => ({ sender: message.role === "user" ? "client" : message.role === "assistant" ? "agent" : message.role === "note" ? "note" : "system", text: message.content, time: message.ts ? new Date(message.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "", ts: message.ts, senderName: message.senderName, media: message.media ?? [] })) as LiveConversation["messages"];
  }, [detail?.messageHistory, selected?.messages]);
  const calls = useMemo(() => ((detail as { calls?: CallEntry[] } | undefined)?.calls ?? []), [detail]);
  const timeline = useMemo(() => [
    ...detailMessages.map(message => ({ type: "message" as const, timestamp: message.ts ?? 0, message })),
    ...calls.map(call => ({ type: "call" as const, timestamp: call.createdAt, call })),
  ].sort((a, b) => a.timestamp - b.timestamp), [detailMessages, calls]);
  const renderableTimeline = useMemo(() => timeline.filter(entry => entry.type === "call" || Boolean(entry.message.text.trim()) || Boolean(entry.message.media?.length)), [timeline]);
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [renderableTimeline, selected?.id]);

  const sendMessage = trpc.leads.sendMessage.useMutation({
    onSuccess: (_result, variables) => {
      setCompose("");
      const timestamp = Date.now();
      utils.leads.listCsInbox.setData({ showResolved: true }, old => old?.map(row => {
        if (row.id !== variables.sessionId) return row;
        const rowWithHistory = row as typeof row & { messageHistory?: string };
        return {
          ...row,
          messageHistory: JSON.stringify([...(JSON.parse(rowWithHistory.messageHistory ?? "[]") as RawMessage[]), { role: "assistant", content: variables.message, ts: timestamp }]),
          hasUnanswered: false,
          lastSenderRole: "assistant",
          lastMsgTs: timestamp,
        } as unknown as typeof row;
      }));
      utils.leads.getCsConversation.setData({ sessionId: variables.sessionId }, old => old ? { ...old, messageHistory: JSON.stringify([...(JSON.parse(old.messageHistory ?? "[]") as RawMessage[]), { role: "assistant", content: variables.message, ts: timestamp }]) } : old);
    },
  });
  const saveNote = trpc.opsChat.addCsInbox2Note.useMutation({
    onSuccess: (result, variables) => {
      setCompose(""); setComposeMode("reply");
      utils.leads.getCsConversation.setData({ sessionId: variables.sessionId }, old => old ? { ...old, messageHistory: JSON.stringify([...(JSON.parse(old.messageHistory ?? "[]") as RawMessage[]), result.note]) } : old);
    },
  });
  const resolveSession = trpc.leads.resolveSession.useMutation({ onSuccess: (_result, variables) => {
    setResolvingId(variables.sessionId);
    window.setTimeout(() => { setResolvingId(null); setSelected(null); utils.leads.listCsInbox.setData({ showResolved: true }, old => old?.map(row => row.id === variables.sessionId ? ({ ...row, csResolvedAt: new Date() } as unknown as typeof row) : row)); void utils.leads.getUnansweredCsCount.invalidate(); }, 900);
  } });
  const sendCurrent = () => {
    if (!selected || !compose.trim()) return;
    const fromNumberId = getCsInboxReplyPhoneNumberIdForSelectedConversation(selected, conversations);
    sendMessage.mutate({ sessionId: selected.id, message: compose.trim(), fromNumberId, source: "cs_inbox" });
  };
  const saveCurrentNote = () => { if (selected && compose.trim()) saveNote.mutate({ sessionId: selected.id, note: compose.trim() }); };

  const csAutoDraft = trpc.opsChat.csReply.useMutation({ onSuccess: result => { if (typeof result.reply === "string") setCompose(result.reply); } });
  useEffect(() => {
    if (!selected || !detail || detail.sessionId !== selected.id || autoDraftedForRef.current === selected.id) return;
    autoDraftedForRef.current = selected.id;
    const controller = new AbortController();
    streamAbortRef.current?.abort(); streamAbortRef.current = controller;
    const conversationContext = detailMessages.slice(-20).map(message => `${message.sender === "client" ? "Customer" : "Agent"}: ${message.text}`).join("\n");
    const classifyContext = detailMessages.slice(-5).map(message => `${message.sender === "client" ? "Customer" : "Agent"}: ${message.text}`).join("\n");
    const jobContext = clientProfile?.todayJob ? `${clientProfile.todayJob.serviceType ?? "Service"}\n${clientProfile.todayJob.jobAddress ?? ""}` : "";
    void (async () => {
      try {
        const response = await fetch("/api/cs-reply-stream", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ conversationContext, classifyContext, customerName: selected.name, jobContext, sessionId: selected.id }), signal: controller.signal });
        if (!response.ok || !response.body) throw new Error("Stream unavailable");
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffered = ""; let accumulated = "";
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          if (selectedRef.current?.id !== selected.id) { void reader.cancel(); return; }
          buffered += decoder.decode(value, { stream: true }); const lines = buffered.split("\n"); buffered = lines.pop() ?? "";
          for (const line of lines) { if (!line.trim().startsWith("data:")) continue; const token = JSON.parse(line.trim().slice(5).trim()) as { token?: string }; if (token.token) { accumulated += token.token; setCompose(accumulated); } }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") csAutoDraft.mutate({ conversationContext, customerName: selected.name, jobContext });
      }
    })();
    return () => controller.abort();
  // The existing draft behavior intentionally fires once when fresh detail loads for the selected conversation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, detail?.sessionId]);

  const selectConversation = (conversation: LiveConversation) => { window.dispatchEvent(new Event("review-workspace-collapse")); autoDraftedForRef.current = null; setSelected(conversation); setCompose(""); setComposeMode("reply"); setShowTools(false); setActiveMission(null); };
  const openTools = () => setShowTools(true);
  const ticketConversations = useMemo(() => conversations.filter(conversation => detailFilter === "All" || detailFilter === "Teams" ? detailFilter === "All" || isTeamMember(conversation) : !isTeamMember(conversation)).filter(conversation => `${conversation.name} ${conversation.phone} ${conversation.lastMessage}`.toLowerCase().includes(detailSearch.toLowerCase())), [conversations, detailFilter, detailSearch]);

  if (selected) {
    return <><div className="sms-review sms-exact-live"><main className="operations-crm-review cic-shell" data-live-sms="true"><CrmSidebar total={activeConversations.length} needsResponse={needsResponseCount} atRisk={atRiskCount} teams={teamCount} /><section className="cic-detail-layout">
      <aside className="cic-ticket-list"><header><button type="button" onClick={() => setSelected(null)}><ChevronLeft />Back to board</button><div><span>Customer inbox</span><h2>Needs Response <b>{needsResponseCount}</b></h2></div><label><Search size={14} /><input value={detailSearch} onChange={event => setDetailSearch(event.target.value)} placeholder="Search conversations" /></label><nav><button type="button" className={detailFilter === "All" ? "is-active" : ""} onClick={() => setDetailFilter("All")}>All</button><button type="button" className={detailFilter === "Leads" ? "is-active" : ""} onClick={() => setDetailFilter("Leads")}>Leads</button><button type="button" className={detailFilter === "Teams" ? "is-active" : ""} onClick={() => setDetailFilter("Teams")}>Teams</button></nav></header><div>{ticketConversations.map(conversation => <button type="button" className={conversation.id === selected.id ? "is-selected" : ""} onClick={() => selectConversation(conversation)} key={conversation.id}><LiveAvatar conversation={conversation} className="cic-ticket-avatar" /><span><b>{conversation.name}</b><small>{conversation.lastMessage || "No messages yet"}</small></span><time>{conversation.wait}</time></button>)}</div></aside>
      <main className="cic-thread-main"><header className="cic-thread-head"><LiveAvatar conversation={selected} className="cic-thread-avatar" /><div><h2>{selected.name}</h2><span>{selected.phone} · {isTeamMember(selected) ? "Team Member" : "Customer"}</span></div><div className="cic-thread-actions"><button type="button" onClick={() => setShowTools(true)}><MoreHorizontal /></button><button className="cic-resolve" type="button" disabled={resolveSession.isPending} onClick={() => resolveSession.mutate({ sessionId: selected.id })}><Check />{resolveSession.isPending ? "Resolving…" : "Resolve"}</button></div></header>
        <section className="cic-context"><div><Sparkles size={14} /><strong>Madison</strong><span>{selected.lastMessage || "No recent message is available for this conversation."}</span></div><p><span>● {selected.hasUnanswered ? "Needs response" : "Waiting on customer"}</span>{selected.chips.map(chip => <i key={chip}>{chip.replaceAll("_", " ")}</i>)}</p></section>
        <section className="cic-message-thread" ref={threadRef as React.RefObject<HTMLElement>}><div className="cic-day">Conversation</div>{renderableTimeline.map((entry, index) => entry.type === "call" ? <article className="cic-ai-call cic-live-call" key={`call-${entry.call.id}`}><header><span><Sparkles size={13} />AI Call</span><em>{entry.call.outcome?.replaceAll("_", " ") || "Completed"}</em></header><div><button type="button" onClick={() => setExpandedCalls(current => { const next = new Set(current); next.has(entry.call.id) ? next.delete(entry.call.id) : next.add(entry.call.id); return next; })}><span>▶</span></button><i>{Array.from({ length: 18 }, (_, item) => <b key={item} style={{ height: `${5 + ((item * 7) % 13)}px` }} />)}</i><time>{Math.floor((entry.call.durationSeconds ?? 0) / 60)}:{String((entry.call.durationSeconds ?? 0) % 60).padStart(2, "0")}</time><ChevronDown size={14} /></div>{expandedCalls.has(entry.call.id) && <div className="cic-live-call-detail">{entry.call.recordingUrl ? <audio controls src={proxyRecordingUrl(entry.call.recordingUrl) ?? undefined} /> : <small>No recording available.</small>}{entry.call.summary && <p>{entry.call.summary}</p>}{entry.call.transcript && <pre>{entry.call.transcript}</pre>}</div>}</article> : entry.message.sender === "note" ? <article className="cic-note" key={`message-${index}`}><header><Lock size={12} />Internal note <i>{entry.message.senderName ?? "Agent"}</i><time>{entry.message.time}</time></header>{entry.message.text.trim() && <p>{entry.message.text}</p>}</article> : <article className={`cic-message ${entry.message.sender === "agent" ? "outgoing" : "incoming"}`} key={`message-${index}`}><div className="cic-message-meta"><LiveAvatar conversation={entry.message.sender === "agent" ? { ...selected, name: entry.message.senderName ?? "Agent", initials: (entry.message.senderName ?? "Agent").split(/\s+/).map(word => word[0]).join("").slice(0, 2), personType: "customer" } : selected} className="cic-message-identity" showPortrait={entry.message.sender !== "agent"} /><span>{entry.message.sender === "agent" ? entry.message.senderName ?? "Agent" : selected.name} · {entry.message.time}</span></div>{entry.message.text.trim() && <p>{entry.message.text}</p>}{entry.message.media?.length ? <div className="cic-live-media">{entry.message.media.map(url => isVideoMedia(url) ? <video controls preload="metadata" key={url} src={mediaDisplayUrl(url)}>Your browser cannot play this video.</video> : <button type="button" key={url} onClick={() => { const photos = imageMediaUrls(entry.message.media ?? []); setMmsLightbox({ urls: photos, index: photos.indexOf(url) }); }} title="Click to enlarge"><img src={mediaDisplayUrl(url)} alt="MMS photo" /></button>)}</div> : null}</article>)}{!renderableTimeline.length && <div className="cic-live-empty">No messages yet.</div>}</section>
        <footer className={`cic-composer ${composeMode === "note" ? "is-note" : ""}`}><FAQPanel open={faqOpen} onClose={() => setFaqOpen(false)} context="CS Chat" theme="dark" /><InsertResponseModal open={responsesOpen} onClose={() => setResponsesOpen(false)} onInsert={text => { setCompose(text); setResponsesOpen(false); }} customerFirstName={selected.name.split(" ")[0]} theme="dark" /><ObjectionsPanel open={objectionsOpen} onClose={() => setObjectionsOpen(false)} theme="dark" /><WorldClassReplyPanel open={worldClassOpen} onClose={() => setWorldClassOpen(false)} onInsert={text => { setCompose(text); setWorldClassOpen(false); }} conversationContext={detailMessages.slice(-5).map(message => `${message.sender === "client" ? "Customer" : "Agent"}: ${message.text}`).join("\n")} customerName={selected.name} jobContext={clientProfile?.todayJob ? `${clientProfile.todayJob.serviceType ?? "Service"}\n${clientProfile.todayJob.jobAddress ?? ""}` : ""} theme="dark" />
          <div className="cic-compose-top"><button type="button" className={composeMode === "reply" ? "is-active" : ""} onClick={() => setComposeMode("reply")}>Reply</button><button type="button" className={composeMode === "note" ? "is-active" : ""} onClick={() => setComposeMode("note")}><Lock size={11} />Internal Note</button></div><textarea value={compose} onChange={event => setCompose(event.target.value)} placeholder={composeMode === "note" ? "Add an internal note…" : `Reply to ${selected.name.split(" ")[0]}…`} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); composeMode === "note" ? saveCurrentNote() : sendCurrent(); } }} /><div className="cic-compose-actions"><div>{composeMode === "reply" && <><button type="button" onClick={() => { setWorldClassOpen(true); setFaqOpen(false); setObjectionsOpen(false); }}><Sparkles />World-Class</button><button type="button" onClick={() => setFaqOpen(true)}><BookOpen />FAQ</button><button type="button" onClick={() => setResponsesOpen(true)}><FileText />Responses</button><button type="button" onClick={() => setObjectionsOpen(true)}><ShieldAlert />Objections</button><span className="cic-live-emoji" ref={emojiRef}><button type="button" onClick={() => setShowEmojiPicker(open => !open)}><Smile /></button>{showEmojiPicker && <span className="cic-live-emoji-picker"><Picker data={emojiData} onEmojiSelect={(emoji: { native: string }) => { setCompose(current => current + emoji.native); setShowEmojiPicker(false); }} theme="dark" previewPosition="none" skinTonePosition="none" /></span>}</span></>}</div><button className="cic-send" type="button" disabled={composeMode === "note" ? saveNote.isPending || !compose.trim() : sendMessage.isPending || !compose.trim()} onClick={composeMode === "note" ? saveCurrentNote : sendCurrent}>{composeMode === "note" ? saveNote.isPending ? "Saving…" : "Save note" : sendMessage.isPending ? "Sending…" : "Send"}<Send size={13} /></button></div></footer>
      </main>
      {isTeamMember(selected) ? <LiveTeamPanel conversation={selected} openTools={() => openTools()} /> : <LiveCustomerPanel conversation={selected} openTools={openTools} activeMission={activeMission} setActiveMission={setActiveMission} />}
    </section>{showTools && <LiveToolDialog conversation={selected} close={() => setShowTools(false)} setCompose={setCompose} messages={detailMessages} />}</main></div>{mmsLightbox && mmsLightboxUrl && <div className="cic-mms-lightbox" role="dialog" aria-modal="true" aria-label="MMS photo viewer" onClick={closeMmsLightbox}><button className="cic-mms-lightbox-close" type="button" onClick={closeMmsLightbox} aria-label="Close photo"><X /></button><a className="cic-mms-lightbox-original" href={mmsLightbox.urls[mmsLightbox.index]} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} aria-label="Open original photo"><ExternalLink /></a>{mmsLightbox.index > 0 && <button className="cic-mms-lightbox-previous" type="button" onClick={event => { event.stopPropagation(); previousMmsPhoto(); }} aria-label="Previous photo"><ChevronLeft /></button>}{mmsLightbox.index < mmsLightbox.urls.length - 1 && <button className="cic-mms-lightbox-next" type="button" onClick={event => { event.stopPropagation(); nextMmsPhoto(); }} aria-label="Next photo"><ChevronRight /></button>}{mmsLightbox.urls.length > 1 && <span className="cic-mms-lightbox-count">{mmsLightbox.index + 1} / {mmsLightbox.urls.length}</span>}<img src={mmsLightboxUrl} alt="MMS photo enlarged" onClick={event => event.stopPropagation()} /></div>}</>;
  }

  return <div className="sms-review sms-exact-live"><main className="operations-crm-review cic-shell" data-live-sms="true"><CrmSidebar total={activeConversations.length} needsResponse={needsResponseCount} atRisk={atRiskCount} teams={teamCount} /><section className="cic-workspace"><header className="ocr-header"><div className="ocr-page-title"><h1>SMS</h1><span><i />Live workspace</span></div><div className="ocr-header-actions"><button type="button" onClick={() => refetchInbox()} aria-label="Refresh conversations"><Search /></button><button className="has-notification" type="button" aria-label="Notifications"><Bell /></button><button className="ocr-profile" type="button"><i>MA</i><span>Madison</span><ChevronDown size={13} /></button></div></header><nav className="cic-top-tabs"><button className="is-active" type="button">Conversations</button><button type="button" onClick={() => { window.location.href = "/admin/cs-inbox-2"; }}>Email</button><button type="button" onClick={() => { window.location.href = "/admin/cs-inbox-2"; }}>Next Best Action</button></nav><section className="cic-toolbar"><div><label><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search any customer, phone..." /></label><button type="button">Filter active <ChevronDown /></button><button type="button">Last 90 days <ChevronDown /></button><button type="button"><Tag />Filters</button></div><span><button type="button" onClick={() => refetchInbox()} aria-label="Refresh">↻</button><button className="cic-new" type="button" onClick={() => setShowNewMessage(true)}><Plus />New Message</button></span></section><section className="cic-board-scroll"><div className="cic-board">{columns.map(column => <section className="cic-lane" key={column.label}><header><span style={{ background: LANE_COLORS[column.label] }} /><b>{column.label}</b><small>{column.conversations.length}</small><button type="button"><ChevronDown size={15} /></button></header><div className="cic-lane-cards">{column.conversations.map(conversation => resolvingId === conversation.id ? <div className="cic-card cic-live-resolving" key={conversation.id}>Resolved</div> : <button type="button" onClick={() => selectConversation(conversation)} className="cic-card" key={conversation.id}><div className="cic-card-head"><LiveAvatar conversation={conversation} className="cic-avatar" /><strong>{conversation.name}</strong><time className={column.label === "At Risk" ? "is-risk" : ""}>{conversation.wait}</time></div>{conversation.latestInteractionType === "call" && <span className="cic-call-label"><Sparkles size={11} />AI Call · {conversation.latestCallDuration ? `${Math.floor(conversation.latestCallDuration / 60)}m ${conversation.latestCallDuration % 60}s` : "Call"}</span>}<p>{conversation.latestInteractionType === "call" ? conversation.latestCallSummary || conversation.lastMessage : conversation.lastMessage || "No messages yet"}</p><div className="cic-chips">{conversation.chips.slice(0, 2).map(chip => <span key={chip} className={/risk|urgent/i.test(chip) ? "is-warn" : ""}>{chip.replaceAll("_", " ")}</span>)}</div><footer><span>{isTeamMember(conversation) ? "Team" : "Customer"}</span><LastAgentBadge name={lastAgentNameBySessionId[conversation.id] ?? null} photoUrl={lastAgentNameBySessionId[conversation.id] ? agentPhotoMap[lastAgentNameBySessionId[conversation.id]!] ?? null : null} /></footer></button>)}{!column.conversations.length && <div className="cic-empty-card">{inboxLoading ? "Loading conversations…" : "No conversations"}</div>}<button className="cic-add-card" type="button" onClick={() => setShowNewMessage(true)}><Plus size={13} />Add Conversation</button></div></section>)}</div></section><footer className="cic-stats"><div><small>Total Conversations</small><b>{activeConversations.length}</b></div><div><small>Needs Response</small><b>{needsResponseCount}</b></div><div><small>Unanswered</small><b>{atRiskCount}</b></div><div><small>Hot Leads</small><b>{activeConversations.filter(conversation => conversation.csStatusTier === "hot_lead").length}</b></div><div><small>Teams</small><b>{teamCount}</b></div></footer></section>{showNewMessage && <LiveNewMessageModal close={() => setShowNewMessage(false)} refresh={() => { void refetchInbox(); }} />}</main></div>;
}

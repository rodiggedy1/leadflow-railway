import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  AudioLines,
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CircleDollarSign,
  Clock3,
  FileText,
  Flame,
  Heart,
  Headphones,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Play,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Users,
  Wand2,
  X,
  Zap,
} from "lucide-react";
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

type View = "chat" | "issues" | "calls";

const leads = [
  { id: 1, initials: "JR", name: "Jordan Reeves", stage: "Quote requested", source: "Web form", service: "Recurring home service", value: "$184", signal: "Follow up now", tone: "violet", preview: "Can the team still make the 10:00 AM window?", at: "9:41 AM", unread: true },
  { id: 2, initials: "MB", name: "Morgan Bell", stage: "New lead", source: "Google", service: "Deep home service", value: "$246", signal: "Needs response", tone: "teal", preview: "New lead from Google needs a weekend deep clean.", at: "8:57 AM", unread: true },
  { id: 3, initials: "AR", name: "Amelia Ross", stage: "Estimate sent", source: "Referral", service: "Move-in service", value: "$312", signal: "Follow up today", tone: "orange", preview: "Client added fridge and oven details to the request.", at: "8:22 AM", unread: false },
  { id: 4, initials: "DT", name: "Devon Turner", stage: "Qualified", source: "Website chat", service: "Recurring home service", value: "$168", signal: "Select a time", tone: "pink", preview: "Website chat follow-up is ready for a time choice.", at: "Yesterday", unread: false },
  { id: 5, initials: "SB", name: "Sophia Bell", stage: "High intent", source: "Google", service: "Deep home service", value: "$260", signal: "Ready to book", tone: "blue", preview: "Ready to book — high intent for this week.", at: "Yesterday", unread: false },
];

const CHANNELS = [
  { name: "# ops-updates", preview: "Team schedule updated for today", at: "Yesterday", tone: "amber" },
  { name: "# general", preview: "One internal update from Madison", at: "Yesterday", tone: "neutral" },
];

const INBOX_THREADS = [
  { id: "jordan", leadId: 1, name: "Jordan Reeves", preview: "Can the team still make the 10:00 AM window?", at: "9:41 AM", unread: true },
  { id: "harper", kind: "team", name: "Team Harper", preview: "On the way. Arrival update is ready.", at: "9:38 AM", unread: true },
  { id: "morgan", leadId: 2, name: "Morgan Bell", preview: "New lead from Google needs a weekend deep clean.", at: "8:57 AM", unread: true },
  { id: "amelia", leadId: 3, name: "Amelia Ross", preview: "Client added fridge and oven details to the request.", at: "8:22 AM", unread: false },
  { id: "devon", leadId: 4, name: "Devon Turner", preview: "Website chat follow-up is ready for a time choice.", at: "Yesterday", unread: false },
  { id: "sophia", leadId: 5, name: "Sophia Bell", preview: "Ready to book — high intent for this week.", at: "Yesterday", unread: false },
];

const LEAD_PORTRAITS: Record<string, string> = {
  "Jordan Reeves": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/xDBqJDhyFPziPsOt.png",
  "Morgan Bell": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/gUCwvRBUvWDZUkGx.png",
  "Amelia Ross": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/TtZGSsKomHzKvXmE.png",
  "Devon Turner": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bvdqcqtPZSJhgtqq.png",
  "Sophia Bell": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png",
};

type GroupMessageKind = "customer" | "dispatch" | "team" | "system";
type GroupMessageSide = "left" | "right";

const LEAD_MESSAGES: Record<number, { from: string; role?: string; at: string; body: string; kind: GroupMessageKind; side?: GroupMessageSide; reaction?: string }[]> = {
  1: [
    { from: "Jordan Reeves", at: "9:41 AM", body: "Hi — can the team still make the 10:00 AM window today?", kind: "customer" },
    { from: "Madison", at: "9:43 AM", body: "I’m checking the route now. I’ll confirm the arrival window in a moment.", kind: "dispatch", side: "right" },
    { from: "System", at: "9:47 AM", body: "Team Harper marked prior job complete · ETA recalculated", kind: "system" },
    { from: "Team Harper", at: "9:48 AM", body: "On the way. We should arrive between 10:05–10:15 AM.", kind: "team", reaction: "3" },
    { from: "Madison", at: "9:49 AM", body: "Confirmed — your team is on the way and will arrive around 10:10 AM.", kind: "dispatch", side: "right" },
    { from: "Jordan Reeves", at: "9:50 AM", body: "Perfect, thank you!", kind: "customer" },
  ],
  2: [
    { from: "MIB Dispatch", role: "Coordinator", at: "9:20 AM", body: "Morgan is looking for a deep service before guests arrive this weekend.", kind: "dispatch" },
    { from: "System", at: "9:22 AM", body: "Scheduling update · available windows are being reviewed for the requested service", kind: "system" },
    { from: "Madison", role: "Dispatch", at: "9:25 AM", body: "I found a couple of viable service windows. I’m preparing the short service brief for review.", kind: "dispatch", side: "right", reaction: "Brief ready" },
    { from: "System", at: "9:27 AM", body: "Internal brief ready · service scope, timing preference, and estimate context grouped together", kind: "system" },
  ],
  3: [
    { from: "MIB Dispatch", role: "Coordinator", at: "9:02 AM", body: "Amelia asked whether the Thursday estimate option can remain available.", kind: "dispatch" },
    { from: "System", at: "9:04 AM", body: "Scheduling update · Thursday remains held while the estimate is open", kind: "system" },
    { from: "Madison", role: "Dispatch", at: "9:07 AM", body: "The next reply can keep the estimate warm without making a scheduling commitment yet.", kind: "dispatch", side: "right", reaction: "Keep warm" },
    { from: "System", at: "9:09 AM", body: "Quote momentum review · estimate opened, Thursday held, no response logged", kind: "system" },
  ],
  4: [
    { from: "MIB Dispatch", role: "Coordinator", at: "8:54 AM", body: "Devon is ready to review recurring-plan time windows.", kind: "dispatch" },
    { from: "System", at: "8:56 AM", body: "Scheduling update · two suitable recurring windows are ready for internal review", kind: "system" },
    { from: "Madison", role: "Dispatch", at: "8:59 AM", body: "I’ve condensed the two options into a simple choice set before we send anything.", kind: "dispatch", side: "right", reaction: "2 options" },
    { from: "System", at: "9:01 AM", body: "Scheduling choice prepared · two recurring windows, one selected team preference", kind: "system" },
  ],
  5: [
    { from: "MIB Dispatch", role: "Coordinator", at: "8:38 AM", body: "Sophia needs a deep-service opening this week.", kind: "dispatch" },
    { from: "System", at: "8:40 AM", body: "Scheduling update · one opening matches the service request", kind: "system" },
    { from: "Madison", role: "Dispatch", at: "8:43 AM", body: "The opening, service request, and pre-booking details are ready for a quick handoff review.", kind: "dispatch", side: "right", reaction: "Ready" },
    { from: "System", at: "8:45 AM", body: "Booking readiness check · opening matched, service context present, confirmation still required", kind: "system" },
  ],
};

const COMMAND_NOTICES: Record<number, { body: string; at: string }> = {
  1: { body: "Arrival update ready · Team Harper ETA awaits a human reply", at: "Now" },
  2: { body: "Service brief grouped · timing preference and estimate context are ready", at: "Now" },
  3: { body: "Quote momentum · Thursday is held and a response is pending", at: "Now" },
  4: { body: "Scheduling choice ready · two recurring windows prepared", at: "Now" },
  5: { body: "Booking handoff ready · service context and opening aligned", at: "Now" },
};

// Fixed review-only waveform geometry echoes the AI Calls evidence card without loading audio.
const VOICE_HANDOFF_BARS = [42, 78, 57, 88, 49, 68, 91, 61, 76, 45, 70, 83, 54, 66, 79, 51, 87, 47, 72, 59, 82, 53, 74, 64, 46, 77, 55, 84, 50, 69, 80, 58, 73, 48, 86, 62, 75, 56, 81, 52, 67, 89, 60, 74, 44, 65, 78, 54, 71, 46, 63, 80, 52, 68, 43, 75, 57, 82, 48, 65] as const;

function CrmMark() {
  return (
    <span className="ccc-mark" aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

function Avatar({ initials, tone = "violet" }: { initials: string; tone?: string }) {
  return <span className={`ccc-avatar ccc-avatar-${tone}`}>{initials}</span>;
}

function LeadPortrait({ name, initials, tone }: { name: string; initials: string; tone: string }) {
  const portrait = LEAD_PORTRAITS[name];
  if (portrait) return <img className="ccc-lead-portrait" src={portrait} alt={`${name} static review portrait`} />;
  return <Avatar initials={initials} tone={tone} />;
}

function GroupMessageAvatar({ from, kind }: { from: string; kind: Exclude<GroupMessageKind, "system"> }) {
  if (from === "Madison") return <img className="ccc-group-avatar ccc-group-avatar-dispatch" src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png" alt="Madison static review portrait" />;
  if (kind === "customer" && LEAD_PORTRAITS[from]) return <img className="ccc-group-avatar ccc-group-avatar-customer" src={LEAD_PORTRAITS[from]} alt={`${from} static review portrait`} />;
  if (kind === "team") return <span className="ccc-group-avatar ccc-group-avatar-team" aria-label="Team Harper static review avatar"><Users /></span>;
  const initials = from.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <span className={`ccc-group-avatar ccc-group-avatar-${kind}`}>{initials}</span>;
}

function StaticVoiceHandoff({ onPlay }: { onPlay: () => void }) {
  return <article className="ccc-voice-handoff" aria-label="Static AI call handoff for Jordan Reeves">
    <header><div className="ccc-voice-handoff-identity"><img src={LEAD_PORTRAITS["Jordan Reeves"]} alt="Jordan Reeves static review portrait" /><span><strong>Jordan Reeves</strong><small><AudioLines />AI-handled inbound call</small></span></div><b>Callback requested</b></header>
    <div className="ccc-voice-handoff-player"><button aria-label="Play static call handoff" onClick={onPlay}><Play fill="currentColor" /></button><span className="ccc-voice-handoff-waveform" aria-hidden="true">{VOICE_HANDOFF_BARS.map((height, index) => <i key={index} className={index < 11 ? "is-blue" : index < 30 ? "is-olive" : index < 41 ? "is-amber" : "is-silver"} style={{ height: `${height}%` }} />)}</span><time>2:18</time></div>
    <footer><span><Headphones />Static recording visualization</span><time>Today · 9:39 AM</time></footer>
  </article>;
}

function QuietAction({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button className="ccc-quiet-action" onClick={onClick}>{children}</button>;
}

export default function CommandChatCRMReview() {
  const [view, setView] = useState<View>("chat");
  const [selectedLead, setSelectedLead] = useState(1);
  const [notice, setNotice] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [smsRecipient, setSmsRecipient] = useState<number | "team" | null>(null);
  const [smsDraft, setSmsDraft] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationFilter, setConversationFilter] = useState<"all" | "unread">("all");
  const [reply, setReply] = useState("");
  const [pulseVisible, setPulseVisible] = useState(true);

  const active = leads.find((item) => item.id === selectedLead) ?? leads[0];
  const activeMessages = LEAD_MESSAGES[active.id] ?? LEAD_MESSAGES[1];
  const activeNotice = COMMAND_NOTICES[active.id] ?? COMMAND_NOTICES[1];
  const smsTarget = smsRecipient === "team" ? { name: "Team Harper", initials: "TH", tone: "teal", preview: "On the way. Arrival update is ready.", contact: "Team update thread", isTeam: true } : smsRecipient ? (() => { const lead = leads.find((item) => item.id === smsRecipient) ?? leads[0]; return { ...lead, contact: "Customer SMS", isTeam: false }; })() : null;
  const visibleThreads = useMemo(() => {
    const term = conversationSearch.trim().toLowerCase();
    const matching = term ? INBOX_THREADS.filter((item) => `${item.name} ${item.preview}`.toLowerCase().includes(term)) : INBOX_THREADS;
    return conversationFilter === "unread" ? matching.filter((item) => item.unread) : matching;
  }, [conversationFilter, conversationSearch]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  return (
    <main className="ccc-app ccc-widget-app">
      <aside className="ccc-nav" aria-label="CRM navigation">
        <div className="ccc-nav-brand">
          <CrmMark />
          <div><strong>Sales CRM</strong><span>Command workspace</span></div>
        </div>

        <nav className="ccc-nav-scroll">
          <button className="ccc-nav-item"><span className="ccc-iconbox"><Users /></span>Companies <em>241</em></button>
          <button className="ccc-nav-item"><span className="ccc-iconbox"><FileText /></span>Deals Board</button>
          <button className="ccc-nav-item"><span className="ccc-iconbox"><Activity /></span>Forecast <em>9</em></button>
          <button className="ccc-nav-item ccc-nav-active"><span className="ccc-iconbox"><MessageSquare /></span>Workspace Chat <em>4</em></button>
          <button className="ccc-nav-item"><span className="ccc-iconbox"><Users /></span>Contacts <em>38</em></button>
          <button className="ccc-nav-item"><span className="ccc-iconbox"><Mail /></span>Email Sequences</button>

          <div className="ccc-nav-group"><p>TEAM</p><button><CircleDot />Strategic AEs</button><button><Users />Mid Market</button><button><Users />SDR Team</button></div>
          <div className="ccc-nav-group"><p>REPORTING</p><button><Activity />Q1 Forecast</button><button><AlertTriangle />Slipping Deals</button></div>
          <div className="ccc-nav-group"><p>PIPELINES</p><button><b className="ccc-dot ccc-dot-yellow" />North America</button><button><b className="ccc-dot ccc-dot-pink" />EMEA Enterprise</button><button><b className="ccc-dot ccc-dot-purple" />APAC Expansion</button></div>
        </nav>

        <div className="ccc-nav-utility"><button><Users />Invite teammates</button><button><MessageCircle />Help</button></div>
        <div className="ccc-nav-billing"><div><strong>14 Days</strong><span>Left on trial</span></div><button onClick={() => showNotice("Billing is review-only on this page.")}><FileText />Add Billings</button></div>
      </aside>

      <section className="ccc-workspace">
        <header className="ccc-page-header">
          <div className="ccc-title-band">
            <div className="ccc-title"><h1>Workspace Chat</h1><span><i />Static preview</span></div>
            <div className="ccc-header-actions"><button aria-label="Search"><Search /></button><button aria-label="Notifications"><Bell /><b /></button><button className="ccc-profile"><Avatar initials="MA" tone="pink" /><span>Madison Anders</span><ChevronDown /></button></div>
          </div>
          <div className="ccc-tabs"><button className="ccc-tab-active">Workspace Chat</button><button>Issues <b>2</b></button><button>Call Log</button><button>Follow-ups</button></div>
          <div className="ccc-toolbar">
            <div className="ccc-view-toggle"><button className={view === "chat" ? "selected" : ""} onClick={() => setView("chat")}><MessageSquare />Messages</button><button className={view === "issues" ? "selected" : ""} onClick={() => setView("issues")}><ShieldAlert />Issues <b>2</b></button><button className={view === "calls" ? "selected" : ""} onClick={() => setView("calls")}><Phone />Calls</button></div>
            <div className="ccc-toolbar-actions"><button onClick={() => showNotice("Filters are local to this review page.")}><span>Filter</span> All activity <ChevronDown /></button><button className="ccc-primary" onClick={() => setComposeOpen(true)}><Plus />New message</button></div>
          </div>
        </header>

        <div className="ccc-command-grid">
          <aside className="ccc-command-panel ccc-left-panel">
            <div className="ccc-command-navigation"><div className="ccc-command-brand"><div><Sparkles /><span><strong>MIB Command</strong><small>Operate. Serve. Grow.</small></span></div><button aria-label="Open static command menu" onClick={() => showNotice("Command menu is static in this review.")}><Plus /></button></div><nav aria-label="MIB Command review destinations"><a href="/review/sms"><MessageSquare />SMS</a><a href="/review/bookings-crm"><CalendarClock />Bookings CRM</a><a href="/review/leads-crm"><Users />Leads CRM</a><a href="/review/schedule-crm"><CalendarClock />Schedule</a><a href="/review/ai-calls"><Phone />AI Calls</a><a href="/review/payroll-summary"><Activity />Payroll Summary</a><a href="/review/settings"><MoreHorizontal />Settings</a></nav></div>
            <div className="ccc-left-section ccc-conversations-section"><div className="ccc-panel-heading ccc-conversation-heading"><div><span>CONVERSATIONS</span></div><button aria-label="Search static conversations" onClick={() => showNotice("Conversation search is static on this review page.")}><Search /></button></div><label className="ccc-search ccc-conversation-search"><Search /><input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search teammates..." /></label><div className="ccc-conversation-filters" aria-label="Static conversation filters"><button className={conversationFilter === "all" ? "active" : ""} onClick={() => setConversationFilter("all")}>All <b>12</b></button><button className={conversationFilter === "unread" ? "active" : ""} onClick={() => setConversationFilter("unread")}>Unread <b>3</b></button><button onClick={() => showNotice("Team groups are static in this review.")}>Teams <ChevronDown /></button></div><div className="ccc-conversation-list ccc-inbox-list">
              {visibleThreads.map((item) => item.kind === "team" ? <button className="ccc-conversation ccc-team-thread" key={item.id} onClick={() => { setSmsRecipient("team"); setSmsDraft(""); }} aria-label="Open static SMS composer for Team Harper"><span className="ccc-team-thread-avatar"><Users /></span><span className="ccc-conv-copy ccc-inbox-copy"><strong>{item.name}</strong><small>{item.preview}</small></span><span className="ccc-conv-meta ccc-inbox-meta"><time>{item.at}</time>{item.unread && <i className="ccc-team-presence" aria-label="Unread static team conversation" />}</span></button> : <button key={item.id} className={`ccc-conversation ${item.leadId === active.id ? "active" : ""}`} onClick={() => { setSmsRecipient(item.leadId ?? 1); setSmsDraft(""); }} aria-label={`Open static SMS composer for ${item.name}`}><LeadPortrait name={item.name} initials={leads.find((lead) => lead.id === item.leadId)?.initials ?? ""} tone={leads.find((lead) => lead.id === item.leadId)?.tone ?? "blue"} /><span className="ccc-conv-copy ccc-inbox-copy"><strong>{item.name}</strong><small>{item.preview}</small></span><span className="ccc-conv-meta ccc-inbox-meta"><time>{item.at}</time>{item.unread && <i aria-label="Unread static conversation" />}</span></button>)}
              {CHANNELS.map((channel) => <button className={`ccc-conversation ccc-channel-thread ccc-channel-thread-${channel.tone}`} key={channel.name} onClick={() => showNotice(`${channel.name} is static in this review.`)}><span className="ccc-channel-thread-icon">#</span><span className="ccc-conv-copy ccc-inbox-copy"><strong>{channel.name}</strong><small>{channel.preview}</small></span><span className="ccc-conv-meta ccc-inbox-meta"><time>{channel.at}</time></span></button>)}
            </div></div>
          </aside>

          <section className="ccc-command-panel ccc-center-panel">
            <div className="ccc-reference-chat-header">
              <div className="ccc-reference-chat-top">
                <div className="ccc-reference-chat-identity">
                  <span className="ccc-command-glyph"><MessageSquare /></span>
                  <div className="ccc-reference-command-info"><strong>MIB Command</strong><div className="ccc-reference-header-metrics" aria-label="Static workspace metrics: 14 leads, 6 bookings, 1840 dollars booked today, 3 mentions"><span><Users /><b>14</b> Leads</span><span><CalendarClock /><b>6</b> Bookings</span><span className="ccc-header-metric-money"><CircleDollarSign /><b>$1,840</b> Today</span><span className="ccc-header-metric-mentions"><Bell /><b>3</b> Mentions</span></div></div>
                </div>
                <div className="ccc-reference-chat-actions"><div className="ccc-presence" aria-label="Four static command participants"><img className="ccc-presence-portrait" src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png" alt="Madison static review portrait" /><img className="ccc-presence-portrait" src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/xDBqJDhyFPziPsOt.png" alt="Jordan static review portrait" /><img className="ccc-presence-portrait" src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/TtZGSsKomHzKvXmE.png" alt="Sophia static review portrait" /><span>+3</span></div><i className="ccc-reference-action-divider" aria-hidden="true" /><button aria-label="Call static MIB Command" onClick={() => showNotice("Calls are disabled in this review.")}><Phone /></button><button aria-label="More static MIB Command options" onClick={() => showNotice("More options are static in this review.")}><MoreHorizontal /></button></div>
              </div>
            </div>
            {view === "issues" ? <IssueView onBack={() => setView("chat")} /> : view === "calls" ? <CallsView onBack={() => setView("chat")} /> : <>
              {pulseVisible && <div className="ccc-service-pulse"><Clock3 /><div><strong>Today’s service pulse</strong><span>Three teams are on route. One arrival needs a client update before 10:00 AM.</span></div><button className="ccc-pulse-action" onClick={() => showNotice("Route view is review-only.")}>View route <ChevronRight /></button><button className="ccc-pulse-dismiss" aria-label="Dismiss static service pulse" onClick={() => setPulseVisible(false)}><X /></button></div>}
              <div className="ccc-day-divider"><span>Today</span></div>
              <div className="ccc-message-stream">
                {activeMessages.map((message, index) => message.kind === "system" ? <div className="ccc-message ccc-message-system" key={`${active.id}-${message.at}-${index}`}><span><Activity />{message.body}<time>{message.at}</time></span></div> : <article className={`ccc-group-message ccc-group-message-${message.kind} ccc-group-message-${message.side ?? "left"}`} key={`${active.id}-${message.at}-${index}`}><GroupMessageAvatar from={message.from} kind={message.kind} /><div><div className="ccc-message-meta"><strong>{message.from}</strong>{message.role && <em>{message.role}</em>}<time>{message.at}</time></div><p>{message.body}</p>{message.reaction && (message.kind === "team" ? <span className="ccc-team-message-reactions"><span className="ccc-message-reaction"><Heart fill="currentColor" />{message.reaction}</span><span className="ccc-team-reaction-members"><Users /></span></span> : <span className="ccc-message-reaction"><Sparkles />{message.reaction}</span>)}</div></article>)}
                {active.id === 1 && <StaticVoiceHandoff onPlay={() => showNotice("Playback is unavailable in this static review. The waveform is visual call context only.")} />}
                <div className="ccc-message ccc-message-system ccc-command-notice" aria-label="Static contextual operational notice"><span><Activity />{activeNotice.body}<time>{activeNotice.at}</time></span></div>
              </div>
              <div className="ccc-quick-actions"><button onClick={() => showNotice("Issue form is review-only.")}><AlertTriangle />Open issue</button><button onClick={() => showNotice("Reminder is review-only.")}><CalendarClock />Set reminder</button><button onClick={() => showNotice("Pin note is review-only.")}><Pin />Pin a note</button><button onClick={() => showNotice("Booking announcement is review-only.")}><Sparkles />Announce booking</button><button onClick={() => showNotice("Broadcast is review-only.")}><Megaphone />Broadcast</button></div>
              <div className="ccc-composer"><div><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Message today’s service desk..." /><div className="ccc-composer-tools"><span><button onClick={() => showNotice("Attachments are disabled in review mode.")}><Paperclip /></button><button onClick={() => showNotice("Voice messages are disabled in review mode.")}><Mic /></button><button onClick={() => showNotice("Emoji are disabled in review mode.")}><span>☺</span></button></span><button className="ccc-send" onClick={() => { setReply(""); showNotice("Messages are not sent from this review page."); }}><Send />Send</button></div></div></div>
            </>}
          </section>

          <aside className="ccc-command-panel ccc-right-panel">
            <div className="ccc-lead-context-topline"><strong>Lead context</strong><button onClick={() => showNotice("Lead selector is static in this review.")}>{active.name}<ChevronDown /></button></div>
            <article className="ccc-context-card ccc-context-lead"><div className="ccc-context-lead-summary"><LeadPortrait name={active.name} initials={active.initials} tone={active.tone} /><div><strong>{active.name}</strong><span>{active.stage} · {active.source}</span><small><i />Active now</small></div><b>{active.value}</b></div><div className="ccc-context-actions"><button className="ccc-context-primary" onClick={() => showNotice("Lead details are static in this review.")}>View lead <ChevronRight /></button><button aria-label="Call static lead" onClick={() => showNotice("Calls are disabled in this review.")}><Phone /></button><button aria-label="Message static lead" onClick={() => showNotice("Messages are disabled in this review.")}><MessageSquare /></button><button aria-label="More static lead actions" onClick={() => showNotice("More actions are static in this review.")}><MoreHorizontal /></button></div></article>
            <article className="ccc-context-card ccc-context-lead-mini"><button onClick={() => showNotice("Sophia’s lead is static in this review.")}><LeadPortrait name="Sophia Bell" initials="SB" tone="blue" /><span><strong>Sophia Bell</strong><small>High intent · Ready to book</small></span><b>$260</b><ChevronRight /></button></article>
            <article className="ccc-context-card ccc-context-lead-mini"><button onClick={() => showNotice("Amelia’s lead is static in this review.")}><LeadPortrait name="Amelia Ross" initials="AR" tone="orange" /><span><strong>Amelia Ross</strong><small>Estimate sent · Follow up today</small></span><b>$312</b><ChevronRight /></button></article>
            <article className="ccc-context-card"><header><span><CalendarClock />New bookings</span><b>Today</b></header><p className="ccc-context-time"><CalendarClock />10:00 AM – 12:00 PM</p><p><MapPin />1234 14th St NW, Washington, DC</p><p><Users />Team Harper</p><button className="ccc-context-primary ccc-context-full" onClick={() => showNotice("New bookings are static in this review.")}>View bookings <ChevronRight /></button></article>
            <article className="ccc-context-card ccc-context-moves"><header><span><Sparkles />Madison’s Moves</span><b>3</b></header><div className="ccc-context-move-list"><button className="ccc-context-move ccc-context-move-priority" onClick={() => showNotice("Review reply is static in this review.")}><span>Priority</span><strong>Confirm Jordan’s arrival window</strong><em>Review reply <ChevronRight /></em></button><button className="ccc-context-move ccc-context-move-opportunity" onClick={() => showNotice("Open lead is static in this review.")}><span>Opportunity</span><strong>Sophia Bell was ready to book</strong><em>Open lead <ChevronRight /></em></button><button className="ccc-context-move ccc-context-move-followup" onClick={() => showNotice("Review queue is static in this review.")}><span>Follow-up</span><strong>Three quotes needed a human touch</strong><em>Review queue <ChevronRight /></em></button></div></article>
            <article className="ccc-context-card ccc-context-related"><header><span>Related items</span></header>{[[MessageSquare, "Lead chats", "4"], [Mail, "Emails", "3"], [MessageCircle, "SMS", "1"], [FileText, "Notes", "2"]].map(([Icon, label, count]) => <button key={label as string} onClick={() => showNotice(`${label} are static in this review.`)}><Icon as typeof MessageSquare /><span>{label as string}</span><b>{count as string}</b><ChevronRight /></button>)}</article>
          </aside>
        </div>
      </section>

      {composeOpen && <div className="ccc-modal-backdrop" onMouseDown={() => setComposeOpen(false)}><section className="ccc-static-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><MessageSquare /><span><strong>New message</strong><small>Static review control</small></span></div><button onClick={() => setComposeOpen(false)}><X /></button></header><label>To<input placeholder="Search a static contact..." /></label><label>Message<textarea placeholder="Write a review-only message..." /></label><footer><button onClick={() => setComposeOpen(false)}>Cancel</button><button onClick={() => { setComposeOpen(false); showNotice("Messages are disabled in this review page."); }}><Send />Send message</button></footer></section></div>}
      {smsTarget && <div className="ccc-sms-modal-backdrop" role="presentation" onMouseDown={() => setSmsRecipient(null)}><section className="ccc-sms-modal" role="dialog" aria-modal="true" aria-label={`Static SMS composer for ${smsTarget.name}`} onMouseDown={(event) => event.stopPropagation()}><header><div className="ccc-sms-modal-identity">{smsTarget.isTeam ? <span className="ccc-sms-team-avatar"><Users /></span> : <LeadPortrait name={smsTarget.name} initials={smsTarget.initials} tone={smsTarget.tone} />}<span><small>STATIC SMS COMPOSER</small><strong>Text {smsTarget.name}</strong><em>{smsTarget.contact} · No message will be sent</em></span></div><button aria-label="Close static SMS composer" onClick={() => setSmsRecipient(null)}><X /></button></header><section className="ccc-sms-modal-context"><span><Sparkles />Context ready</span><p>{smsTarget.preview}</p><small>Reply context is static and stays inside this review workspace.</small></section><label className="ccc-sms-message-field"><span>Message</span><textarea value={smsDraft} onChange={(event) => setSmsDraft(event.target.value)} placeholder={`Write a clear text to ${smsTarget.name.split(" ")[0]}…`} autoFocus /></label><footer><div className="ccc-sms-tools"><button onClick={() => showNotice("Templates are static in this review.")}><FileText />Templates</button><button onClick={() => showNotice("AI drafting is static in this review.")}><Wand2 />Draft with AI</button><button aria-label="Attach static file" onClick={() => showNotice("Attachments are disabled in this review.")}><Paperclip /></button></div><button className="ccc-sms-send" onClick={() => { setSmsDraft(""); setSmsRecipient(null); showNotice(`Text to ${smsTarget.name} is review-only and was not sent.`); }}><Send />Send SMS</button></footer></section></div>}
      {notice && <div className="ccc-notice" role="status"><CircleDot />{notice}</div>}
    </main>
  );
}

function IssueView({ onBack }: { onBack: () => void }) {
  return <div className="ccc-alt-view"><header><div><span>ACTIVE ISSUES</span><h2>Two items need attention</h2></div><button onClick={onBack}>Back to chat</button></header><article className="ccc-large-issue"><span className="ccc-alert-icon"><AlertTriangle /></span><div><span>High priority</span><h3>Team Maya needs a building access code</h3><p>Client has not replied to the cleaner’s last message. The scheduled entry window is in 18 minutes.</p><footer><b>Owner: Madison</b><button>Review issue <ChevronRight /></button></footer></div></article><article className="ccc-large-issue amber"><span className="ccc-alert-icon"><Clock3 /></span><div><span>Arrival update</span><h3>Jordan Reeves needs an ETA confirmation</h3><p>Team Harper is moving between jobs. A customer update is ready for review.</p><footer><b>Response window: 2 min</b><button>Review update <ChevronRight /></button></footer></div></article></div>;
}

function CallsView({ onBack }: { onBack: () => void }) {
  return <div className="ccc-alt-view"><header><div><span>CALL COMMAND CENTER</span><h2>Today’s calls</h2></div><button onClick={onBack}>Back to chat</button></header>{[["10:02 AM", "Team Harper", "Cleaner ETA check", "Completed"], ["9:44 AM", "Jordan Reeves", "Arrival update", "Queued"], ["9:18 AM", "Sophia Bell", "New lead callback", "Missed"]].map(([time, name, reason, state]) => <article className="ccc-call-row" key={name}><span><Phone /></span><div><strong>{name}</strong><small>{reason} · {time}</small></div><b className={state.toLowerCase()}>{state}</b><button><ChevronRight /></button></article>)}</div>;
}

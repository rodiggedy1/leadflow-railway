import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { MadisonSmsDraftCard } from "@/components/CommandChat";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { useOpsStream } from "@/hooks/useOpsStream";
import "./ai-team-review.css";

type Tab = "overview" | "agents" | "activity";
type ActivityAudit = {
  kind: "madison_reply" | "madison_task";
  draftId?: number | null;
  originalMessage?: string | null;
  incomingMessage?: string | null;
  generatedDraft?: string | null;
  approvedText?: string | null;
  edited?: boolean;
  task?: string | null;
  recommendation?: string | null;
  status?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | string | null;
  sentAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  issueId?: number | null;
};
type ActivityItem = { id: number; ts: number; title: string; detail: string; kind: "madison"; audit: ActivityAudit };
type Agent = {
  id: string;
  name: string;
  role: string;
  status: "working" | "available";
  task: string;
  person: string;
  quote: string;
  stats: string[];
  color: "violet" | "coral" | "green";
  mission: string;
  capabilities: string[];
  approvals: string[];
};

const AGENTS: Agent[] = [
  {
    id: "madison",
    name: "MADISON",
    role: "Sales & Booking Agent",
    status: "working",
    task: "Converting a Thumbtack lead",
    person: "Sarah Mitchell",
    quote: "I can do Thursday but what time would they arrive?",
    stats: ["47 conversations", "11 bookings", "$3,240 booked"],
    color: "violet",
    mission: "Turn every qualified lead into a booked customer.",
    capabilities: ["Reply to leads", "Quote cleanings", "Offer available times", "Apply discounts up to 15%", "Follow up with leads", "Create bookings", "Answer FAQs"],
    approvals: ["Discounts over 15%", "Refunds", "Jobs over $1,000"],
  },
  {
    id: "care",
    name: "CUSTOMER CARE",
    role: "Customer Support Agent",
    status: "working",
    task: "Handling a reschedule request",
    person: "David Williams",
    quote: "Moving booking from Friday → Saturday",
    stats: ["28 conversations", "91% handled without human"],
    color: "coral",
    mission: "Keep customers informed, supported, and confident.",
    capabilities: ["Answer customer questions", "Check booking details", "Suggest available times", "Create support follow-ups"],
    approvals: ["Cancellation exceptions", "Credits over $40", "Refunds"],
  },
  {
    id: "operations",
    name: "OPERATIONS",
    role: "Scheduling & Team Management Agent",
    status: "working",
    task: "Finding replacement cleaner",
    person: "Tomorrow's 8:30 AM job",
    quote: "Cleaner called out 4 minutes ago",
    stats: ["18 jobs monitored", "6 teams available"],
    color: "green",
    mission: "Protect the schedule and keep every job covered.",
    capabilities: ["Monitor schedule risks", "Find available teams", "Recommend reassignments", "Confirm arrival updates"],
    approvals: ["Higher-cost replacements", "Customer-facing schedule changes", "Overtime exceptions"],
  },
];

const ACTIVITY = [
  ["1:24 PM", "Madison replied to Thumbtack lead", "Sarah asked about move-out cleaning.", "madison"],
  ["1:23 PM", "Follow-up Agent recovered abandoned quote", "$329 booking confirmed ✓", "followup"],
  ["1:21 PM", "Operations reassigned a job", "Team 3 → Team 6", "operations"],
  ["1:18 PM", "Customer Care issued $25 credit", "Within authorized limit", "care"],
  ["1:16 PM", "ETA Agent called Team 4", "Arrival confirmed for 1:45 PM", "eta"],
  ["1:12 PM", "Madison sent follow-up", "Lead had not responded for 2 hours", "madison"],
] as const;

function formatConversationTime(ts: number | null | undefined): string | null {
  if (!ts) return null;
  const milliseconds = ts < 1_000_000_000_000 ? ts * 1000 : ts;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatActivityTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

function formatShadowValue(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatDecisionOutcome(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "Unavailable";
  const words = value.replace(/^blocked_/, "blocked: ").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatFactValue(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function AgentAvatar({ agent, large = false }: { agent: Agent; large?: boolean }) {
  return <div className={`ai-team-avatar ai-team-avatar--${agent.color} ${large ? "is-large" : ""}`}><Sparkles size={large ? 23 : 17} /></div>;
}

function AgentCard({ agent, onOpen }: { agent: Agent; onOpen: (agent: Agent) => void }) {
  return (
    <button className="ai-team-agent-card" type="button" onClick={() => onOpen(agent)}>
      <div className="ai-team-card-top"><AgentAvatar agent={agent} /><span className={`ai-team-status ai-team-status--${agent.status}`}><i />{agent.status === "working" ? "WORKING" : "AVAILABLE"}</span></div>
      <div className="ai-team-agent-heading"><div><h3>{agent.name}</h3><p>{agent.role}</p></div><ChevronRight size={18} /></div>
      <div className="ai-team-current"><small>CURRENTLY</small><strong>{agent.task} · {agent.person}</strong><em>“{agent.quote}”</em></div>
      <div className="ai-team-card-stats">{agent.stats.map(stat => <span key={stat}>{stat}</span>)}</div>
      <div className="ai-team-card-link">View {agent.name === "MADISON" ? "Madison" : "agent"} <ArrowRight size={14} /></div>
    </button>
  );
}

export default function AiTeamReview() {
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(null);
  const [autonomy, setAutonomy] = useState("assist");
  const [resolved, setResolved] = useState<string[]>([]);
  const { agentName } = useAgentPermissions();
  const utils = trpc.useUtils();
  const { data: focusCards = [], isLoading: focusLoading } = trpc.opsChat.getFocusCards.useQuery(undefined, { refetchInterval: 30_000, refetchOnWindowFocus: false });
  const { data: unansweredSms, isLoading: unansweredLoading } = trpc.leads.getUnansweredCsCount.useQuery(undefined, { refetchInterval: 30_000, refetchOnWindowFocus: false });
  const { data: activityFeed } = trpc.activity.getFeed.useQuery({ limit: 100, sinceDays: 30 }, { refetchInterval: 30_000, refetchOnWindowFocus: false });
  const { data: dashboardStats } = trpc.commandCenter.getDashboardStats.useQuery({ range: "today" }, { refetchInterval: 30_000, refetchOnWindowFocus: false });
  useOpsStream({
    onNewMessage: channel => {
      if (channel === "command") {
        void utils.opsChat.getFocusCards.invalidate();
        void utils.leads.getUnansweredCsCount.invalidate();
        void utils.opsChat.getSmsDraft.invalidate();
        void utils.opsChat.getSmsDraftConversation.invalidate();
      }
    },
  }, { label: "ai-team-madison-queue" });
  const cardBySessionId = new Map<number, (typeof focusCards)[number]>();
  for (const card of focusCards) {
    if (card.quickAction !== "madison_sms_draft") continue;
    try {
      const sessionId = Number((JSON.parse(card.metadata ?? "{}").sessionId));
      if (Number.isFinite(sessionId)) cardBySessionId.set(sessionId, card);
    } catch { /* ignore malformed card metadata */ }
  }
  const liveSmsCards = (unansweredSms?.sessions ?? []).map(session => {
    const card = cardBySessionId.get(session.id);
    return {
      id: card?.id ?? session.id,
      ts: Date.now() - session.ageMs,
      body: session.lastMessagePreview,
      metadata: card?.metadata ?? JSON.stringify({ sessionId: session.id }),
    };
  });
  const activityItems: ActivityItem[] = (activityFeed?.items ?? []).map(item => ({
    id: item.id,
    ts: new Date(item.createdAt).getTime(),
    title: item.title,
    detail: item.body ?? item.eventType.replace(/_/g, " "),
    kind: "madison",
    audit: item.meta as ActivityAudit,
  }));
  const refreshLiveQueue = () => {
    void utils.opsChat.getFocusCards.invalidate();
    void utils.leads.getUnansweredCsCount.invalidate();
  };

  const actionPreview = (id: string, action: string) => {
    setResolved(items => items.includes(id) ? items : [...items, id]);
    toast.success(`${action} is a review-only preview. Nothing was sent, booked, charged, or changed.`);
  };

  return (
    <main className="ai-team-page">
      <header className="ai-team-header">
        <div className="ai-team-eyebrow"><span className="ai-team-orb"><Bot size={17} /></span><span>AI TEAM</span><b><i />7 agents working</b></div>
        <div className="ai-team-header-row"><div><h1>Your business is being handled.</h1><p>Supervise the decisions that need you. Everything else stays moving.</p></div><button className="ai-team-notice" type="button" onClick={() => toast.info("This is a visual review page with synthetic data.")}><ShieldCheck size={16} />Review only</button></div>
        <nav className="ai-team-tabs" aria-label="AI Team sections">{(["overview", "agents", "activity"] as Tab[]).map(item => <button key={item} type="button" className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
      </header>

      {tab === "overview" && <>
        <section className="ai-team-summary"><div><strong>{activityFeed ? activityFeed.todayActions : "—"}</strong><span>actions handled today</span></div><div><strong>{activityFeed ? activityFeed.todayLeadsAnswered : "—"}</strong><span>leads answered</span></div><div><strong>{dashboardStats ? dashboardStats.bookedJobs : "—"}</strong><span>bookings made</span></div><div><strong>{dashboardStats ? `$${dashboardStats.bookedRevenue.toLocaleString()}` : "—"}</strong><span>booked today</span></div><div><strong>{liveSmsCards.length}</strong><span>need you</span></div></section>
        <section className="ai-team-section"><div className="ai-team-section-heading"><div><span>SUPERVISE THE COMPANY</span><h2>Needs you <b>{liveSmsCards.length}</b></h2></div><p>AI escalates only the decisions outside its authority.</p></div><div className="ai-team-needs-grid">{focusLoading || unansweredLoading ? <article className="ai-team-need-card"><div className="ai-team-need-copy"><strong>Loading Madison’s queue…</strong></div></article> : liveSmsCards.length === 0 ? <article className="ai-team-need-card"><div className="ai-team-need-icon"><ShieldCheck size={17} /></div><div className="ai-team-need-copy"><strong>You’re all caught up</strong><p>No active Madison SMS approvals are waiting.</p></div></article> : liveSmsCards.map(card => <MadisonSmsDraftCard key={card.id} msg={{ id: card.id, body: card.body, metadata: card.metadata, createdAt: new Date(card.ts) }} callerName={agentName ?? "Owner"} onActed={refreshLiveQueue} />)}</div></section>
        <section className="ai-team-section"><div className="ai-team-section-heading"><div><span>YOUR AI TEAM</span><h2>Who is handling what</h2></div><button type="button" className="ai-team-text-button" onClick={() => setTab("agents")}>View all agents <ArrowRight size={14} /></button></div><div className="ai-team-agent-grid">{AGENTS.map(agent => <AgentCard key={agent.id} agent={agent} onOpen={setSelectedAgent} />)}</div></section>
        <section className="ai-team-section ai-team-activity-section"><div className="ai-team-section-heading"><div><span>LIVE ACTIVITY</span><h2>What is happening right now</h2></div><button type="button" className="ai-team-text-button" onClick={() => setTab("activity")}>See all activity <ArrowRight size={14} /></button></div><ActivityList compact items={activityItems} onOpen={setSelectedActivity} /></section>
      </>}

      {tab === "agents" && <section className="ai-team-section ai-team-tab-section"><div className="ai-team-section-heading"><div><span>AI TEAM</span><h2>Employees, not automations</h2></div><p>Each agent has a mission, authority, and clear escalation boundary.</p></div><div className="ai-team-agent-grid">{AGENTS.map(agent => <AgentCard key={agent.id} agent={agent} onOpen={setSelectedAgent} />)}</div></section>}
      {tab === "activity" && <section className="ai-team-section ai-team-tab-section"><div className="ai-team-section-heading"><div><span>LIVE ACTIVITY</span><h2>A clear record of what got done</h2></div><p>Open an item to see the reasoning, context, and action.</p></div><ActivityList items={activityItems} onOpen={setSelectedActivity} /></section>}

      <section className="ai-team-autonomy"><div><span>AUTONOMY</span><h2>How much should AI handle?</h2><p>Configure the default. Set tighter rules for individual actions in each agent’s authority.</p></div><div className="ai-team-autonomy-control"><div className="ai-team-autonomy-track">{["observe", "assist", "act", "run business"].map(item => <button type="button" key={item} className={autonomy === item ? "is-active" : ""} onClick={() => { setAutonomy(item); toast.info("Autonomy control is a visual review state only."); }}>{item}</button>)}</div><small>{autonomy === "observe" ? "AI recommends actions but does not take them." : autonomy === "assist" ? "AI handles conversations and asks before operational changes." : autonomy === "act" ? "AI handles routine operations independently." : "AI only escalates exceptions outside its authority."}</small></div></section>

      {selectedActivity && <div className="ai-team-drawer-backdrop" role="presentation" onClick={() => setSelectedActivity(null)}><aside className="ai-team-drawer" role="dialog" aria-modal="true" aria-label={`${selectedActivity.title} details`} onClick={event => event.stopPropagation()}><button className="ai-team-drawer-close" type="button" onClick={() => setSelectedActivity(null)} aria-label="Close activity details"><X size={18} /></button><div className="ai-team-drawer-agent"><div className="ai-team-avatar ai-team-avatar--violet"><MessageSquare size={22} /></div><div><span>AI TEAM · MADISON ACTIVITY</span><h2>{selectedActivity.title}</h2><p>{formatActivityTime(selectedActivity.ts)}</p></div></div><div className="ai-team-drawer-block"><span>STATUS</span><strong>{selectedActivity.audit.kind === "madison_task" ? "Task approved" : "Approved and sent"}</strong><p className="ai-team-activity-detail">{selectedActivity.audit.kind === "madison_task" ? "The booking remained unchanged. A human-approved customer-care task was created." : selectedActivity.audit.edited ? "A human edited Madison’s draft before it was sent." : "Madison’s approved reply was sent to the customer."}</p></div><div className="ai-team-drawer-block"><span>CUSTOMER MESSAGE</span><p className="ai-team-activity-detail">{selectedActivity.audit.originalMessage ?? selectedActivity.audit.incomingMessage ?? "No original message was stored."}</p></div>{selectedActivity.audit.kind === "madison_reply" ? <>{selectedActivity.audit.edited && <div className="ai-team-drawer-block"><span>ORIGINAL MADISON DRAFT</span><p className="ai-team-activity-detail">{selectedActivity.audit.generatedDraft}</p></div>}<div className="ai-team-drawer-block"><span>{selectedActivity.audit.edited ? "FINAL APPROVED REPLY" : "APPROVED REPLY"}</span><p className="ai-team-activity-detail">{selectedActivity.audit.approvedText ?? selectedActivity.detail}</p></div></> : <div className="ai-team-drawer-block"><span>RECOMMENDED TASK</span><strong>{selectedActivity.audit.task ?? selectedActivity.title}</strong><p className="ai-team-activity-detail">{selectedActivity.audit.recommendation ?? selectedActivity.detail}</p>{selectedActivity.audit.issueId && <p className="ai-team-audit-meta">Issue ID: {selectedActivity.audit.issueId}</p>}</div>}<div className="ai-team-drawer-block"><span>APPROVAL</span><p className="ai-team-audit-meta">Approved by: {selectedActivity.audit.approvedBy ?? "Owner"}</p><p className="ai-team-audit-meta">Approved: {selectedActivity.audit.approvedAt ? formatActivityTime(new Date(selectedActivity.audit.approvedAt).getTime()) : formatActivityTime(selectedActivity.ts)}</p>{selectedActivity.audit.kind === "madison_reply" && selectedActivity.audit.deliveredAt && <p className="ai-team-audit-meta">Delivered: {formatActivityTime(new Date(selectedActivity.audit.deliveredAt).getTime())}</p>}</div><button type="button" className="ai-team-drawer-footer" onClick={() => setSelectedActivity(null)}>Close detail <X size={15} /></button></aside></div>}
      {selectedAgent && <div className="ai-team-drawer-backdrop" role="presentation" onClick={() => setSelectedAgent(null)}><aside className="ai-team-drawer" role="dialog" aria-modal="true" aria-label={`${selectedAgent.name} details`} onClick={event => event.stopPropagation()}><button className="ai-team-drawer-close" type="button" onClick={() => setSelectedAgent(null)} aria-label="Close agent details"><X size={18} /></button><div className="ai-team-drawer-agent"><AgentAvatar agent={selectedAgent} large /><div><span>AI TEAM · AGENT PROFILE</span><h2>{selectedAgent.name}</h2><p>{selectedAgent.role}</p></div></div><div className="ai-team-drawer-block"><span>MISSION</span><strong>{selectedAgent.mission}</strong></div><div className="ai-team-drawer-block"><span>CAN DO</span><div className="ai-team-check-list">{selectedAgent.capabilities.map(item => <p key={item}><Check size={14} />{item}</p>)}</div></div><div className="ai-team-drawer-block ai-team-drawer-escalate"><span>REQUIRES YOUR APPROVAL</span>{selectedAgent.approvals.map(item => <p key={item}><AlertTriangle size={14} />{item}</p>)}</div><button type="button" className="ai-team-drawer-footer" onClick={() => toast.info("Conversation detail is part of the next review iteration.")}>Watch current conversation <ArrowRight size={15} /></button></aside></div>}
    </main>
  );
}

function ActivityList({ compact = false, items, onOpen }: { compact?: boolean; items: ActivityItem[]; onOpen: (item: ActivityItem) => void }) {
  if (items.length === 0) return <div className="ai-team-activity-list"><div className="ai-team-activity-empty">No activity has been recorded in the last 30 days.</div></div>;
  return <div className={`ai-team-activity-list ${compact ? "is-compact" : ""}`}>{items.map(item => <button type="button" className="ai-team-activity-row" key={item.id} onClick={() => onOpen(item)}><time dateTime={new Date(item.ts).toISOString()}>{formatActivityTime(item.ts)}</time><span className={`ai-team-activity-dot is-${item.kind}`} /> <div><strong>{item.title}</strong><p>{item.detail}</p></div><ChevronRight size={15} /></button>)}</div>;
}

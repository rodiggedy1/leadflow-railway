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
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import "./ai-team-review.css";

type Tab = "overview" | "agents" | "activity";
type IssueCategory = "Reschedule" | "Cancellation" | "Service issue" | "Refund / credit" | "General question" | "Booking request";
type ActivityItem = { id: number; ts: number; title: string; detail: string; kind: "madison" };
const ISSUE_CATEGORIES: IssueCategory[] = ["Reschedule", "Cancellation", "Service issue", "Refund / credit", "General question", "Booking request"];
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

function getCustomerCareProposal(message: string) {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (/(^|\b)(cancel|cancellation|call off|don'?t need the clean)(\b|$)/.test(normalized)) {
    return { title: "Cancellation request", task: "Verify the customer’s request, then cancel the booking", recommendation: "Do not change the booking until the request is verified." };
  }
  if (/(^|\b)(reschedule|reschedul|move my|change my|different date|different time|another day)(\b|$)/.test(normalized)) {
    return { title: "Reschedule request", task: "Verify the requested date/time, check openings, then reschedule", recommendation: "Do not change the booking until availability is verified." };
  }
  if (/(^|\b)(problem|issue|missed|complaint|not happy|broken|damaged|refund|credit|special request|extra instruction)(\b|$)/.test(normalized)) {
    return { title: "Customer-care request", task: "Review the issue and decide the appropriate customer resolution", recommendation: "Human follow-up is required before offering a credit, refund, or return visit." };
  }
  return null;
}

function getIssueCategory(message: string): IssueCategory {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (/(^|\b)(reschedule|reschedul|move my|change my|different date|different time|another day)(\b|$)/.test(normalized)) return "Reschedule";
  if (/(^|\b)(cancel|cancellation|call off|don'?t need the clean)(\b|$)/.test(normalized)) return "Cancellation";
  if (/(^|\b)(refund|credit|money back|charged twice|charge me)(\b|$)/.test(normalized)) return "Refund / credit";
  if (/(^|\b)(problem|issue|missed|complaint|not happy|broken|damaged|dirty|didn'?t clean)(\b|$)/.test(normalized)) return "Service issue";
  if (/(^|\b)(book|booking|quote|price|estimate|availability|available|schedule a clean|start service)(\b|$)/.test(normalized)) return "Booking request";
  return "General question";
}

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

function LiveNeedCard({ card, agentName, onChanged }: { card: { id: number; ts: number; metadata: string | null; body: string }; agentName: string; onChanged: () => void }) {
  const utils = trpc.useUtils();
  const [showConversation, setShowConversation] = useState(false);
  let metadata: { draftId?: number } = {};
  try { metadata = JSON.parse(card.metadata ?? "{}"); } catch { /* malformed legacy card */ }
  const draftId = metadata.draftId;
  const { data: draft, isLoading } = trpc.opsChat.getSmsDraft.useQuery(
    { draftId: draftId! },
    { enabled: Boolean(draftId), refetchOnWindowFocus: false },
  );
  const { data: conversation = [], isLoading: conversationLoading } = trpc.opsChat.getSmsDraftConversation.useQuery(
    { draftId: draftId!, limit: 20 },
    { enabled: Boolean(draftId) && showConversation, refetchOnWindowFocus: false },
  );
  const approveReply = trpc.opsChat.approveSmsDraft.useMutation({
    onSuccess: result => {
      if (result.ok) {
        toast.success("Madison's reply was approved and sent.");
        void utils.opsChat.getFocusCards.invalidate();
        void utils.madison.getActiveSmsQueue.invalidate();
        onChanged();
      } else toast.error(`Reply was not sent: ${result.reason ?? "already handled"}`);
    },
  });
  const { data: actionApproval } = trpc.madison.getActionApproval.useQuery(
    { draftId: draftId! },
    { enabled: Boolean(draftId), refetchOnWindowFocus: false },
  );
  const approveActionTask = trpc.madison.approveActionTask.useMutation({
    onSuccess: result => {
      if (result.ok) {
        toast.success(result.alreadyApproved ? "This customer-care task was already approved." : "Customer-care task approved. The booking was not changed.");
        void utils.madison.getActionApproval.invalidate({ draftId });
        onChanged();
      } else toast.error(`Task was not approved: ${result.reason}`);
    },
    onError: error => toast.error(error.message),
  });
  const resolveCard = trpc.madison.resolveSmsCard.useMutation({
    onMutate: async ({ messageId }) => {
      await utils.madison.getActiveSmsQueue.cancel();
      const previous = utils.madison.getActiveSmsQueue.getData();
      utils.madison.getActiveSmsQueue.setData(undefined, cards => cards?.filter(card => card.id !== messageId));
      return { previous };
    },
    onSuccess: result => {
      if (result.ok) {
        toast.success("Removed from the active queue. No message was sent and the booking was unchanged.");
      } else {
        toast.error(result.reason === "already_resolved" ? "This request was already resolved." : "Unable to resolve this request.");
      }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) utils.madison.getActiveSmsQueue.setData(undefined, context.previous);
      toast.error(error.message);
    },
    onSettled: () => {
      void utils.madison.getActiveSmsQueue.invalidate();
      onChanged();
    },
  });
  if (!draftId || isLoading) return <article className="ai-team-need-card"><div className="ai-team-need-copy"><strong>Loading Madison request…</strong></div></article>;
  if (!draft) return null;
  const proposal = actionApproval ?? getCustomerCareProposal(draft.originalMessage ?? "");
  const customerName = draft.senderName ?? "Customer";
  const latestCardTime = formatConversationTime(card.ts);
  return (
    <article className="ai-team-need-card">
      <div className="ai-team-need-icon"><MessageSquare size={17} /></div>
      <div className="ai-team-need-copy">
        <strong>{proposal?.title ?? "Madison reply approval"}</strong>
        <p>{customerName}: “{draft.originalMessage}”{latestCardTime && <time className="ai-team-card-time" dateTime={new Date(card.ts).toISOString()}>Received {latestCardTime}</time>}</p>
        <em>{proposal ? <><b>Recommended task:</b> {proposal.task}<br /><span>Madison recommends: {proposal.recommendation}</span></> : "Approve the drafted reply below."}</em>
        <div style={{ marginTop: 10, color: "#6f675e", fontSize: 12, lineHeight: 1.45 }}>{draft.generatedDraft ?? "Draft is still being prepared."}</div>
        <button type="button" className="ai-team-conversation-button" onClick={() => setShowConversation(value => !value)}><MessageSquare size={13} /> {showConversation ? "Hide conversation" : "View conversation"}</button>
        {showConversation && <div className="ai-team-conversation" aria-label="Madison conversation history">
          {conversationLoading ? <span>Loading conversation…</span> : conversation.length === 0 ? <span>No conversation history is available.</span> : conversation.map((message, index) => { const messageTime = formatConversationTime(message.ts); return <div className={`ai-team-conversation-message is-${message.role}`} key={`${message.ts ?? 0}-${index}`}><div className="ai-team-conversation-meta"><small>{message.senderName ?? (message.role === "user" ? customerName : "Madison")}</small>{messageTime && <time dateTime={new Date(message.ts).toISOString()}>{messageTime}</time>}</div><p>{message.content}</p></div>; })}
        </div>}
      </div>
      <div className="ai-team-need-actions">
        <button type="button" onClick={() => approveReply.mutate({ draftId, approvedText: draft.generatedDraft ?? "", approvedBy: agentName })} disabled={approveReply.isPending || !draft.generatedDraft}>{approveReply.isPending ? "Sending…" : "Approve reply"}</button>
        {proposal && <button type="button" className="is-quiet" onClick={() => approveActionTask.mutate({ draftId, approvedBy: agentName ?? "Owner" })} disabled={approveActionTask.isPending || actionApproval?.status === "APPROVED" || actionApproval?.status === "APPROVING"}>{actionApproval?.status === "APPROVED" ? "Task approved" : actionApproval?.status === "APPROVING" || approveActionTask.isPending ? "Approving…" : "Approve task"}</button>}
        <button type="button" className="is-resolve" onClick={() => resolveCard.mutate({ messageId: card.id, resolutionReason: "no_reply_needed" })} disabled={resolveCard.isPending}>{resolveCard.isPending ? "Resolving…" : "No reply needed"}</button>
      </div>
    </article>
  );
}

export default function AiTeamReview() {
  const [tab, setTab] = useState<Tab>("overview");
  const [issueFilter, setIssueFilter] = useState<IssueCategory | "All issues">("All issues");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [autonomy, setAutonomy] = useState("assist");
  const [resolved, setResolved] = useState<string[]>([]);
  const { agentName } = useAgentPermissions();
  const utils = trpc.useUtils();
  const { data: focusCards = [], isLoading: focusLoading } = trpc.madison.getActiveSmsQueue.useQuery(undefined, { refetchInterval: 30_000, refetchOnWindowFocus: false });
  const liveSmsCards = focusCards.filter(card => card.quickAction === "madison_sms_draft");
  const activityItems: ActivityItem[] = liveSmsCards.slice(0, 6).map(card => ({
    id: card.id,
    ts: card.ts,
    title: "Madison SMS awaiting review",
    detail: card.body,
    kind: "madison",
  }));
  const filteredSmsCards = issueFilter === "All issues" ? liveSmsCards : liveSmsCards.filter(card => getIssueCategory(card.body) === issueFilter);
  const refreshLiveQueue = () => { void utils.madison.getActiveSmsQueue.invalidate(); };

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
        <section className="ai-team-summary"><div><strong>184</strong><span>actions handled today</span></div><div><strong>37</strong><span>leads answered</span></div><div><strong>12</strong><span>bookings made</span></div><div><strong>$4,821</strong><span>booked today</span></div><div><strong>{liveSmsCards.length}</strong><span>need you</span></div></section>
        <section className="ai-team-section"><div className="ai-team-section-heading"><div><span>SUPERVISE THE COMPANY</span><h2>Needs you <b>{liveSmsCards.length}</b></h2></div><p>AI escalates only the decisions outside its authority.</p></div><div className="ai-team-issue-pills" aria-label="Filter Madison queue by issue"><button type="button" className={issueFilter === "All issues" ? "is-active" : ""} onClick={() => setIssueFilter("All issues")}>All issues <b>{liveSmsCards.length}</b></button>{ISSUE_CATEGORIES.map(category => <button type="button" key={category} className={issueFilter === category ? "is-active" : ""} onClick={() => setIssueFilter(category)}>{category} <b>{liveSmsCards.filter(card => getIssueCategory(card.body) === category).length}</b></button>)}</div><div className="ai-team-needs-grid">{focusLoading ? <article className="ai-team-need-card"><div className="ai-team-need-copy"><strong>Loading Madison’s queue…</strong></div></article> : liveSmsCards.length === 0 ? <article className="ai-team-need-card"><div className="ai-team-need-icon"><ShieldCheck size={17} /></div><div className="ai-team-need-copy"><strong>You’re all caught up</strong><p>No active Madison SMS approvals are waiting.</p></div></article> : filteredSmsCards.length === 0 ? <article className="ai-team-need-card"><div className="ai-team-need-icon"><ShieldCheck size={17} /></div><div className="ai-team-need-copy"><strong>No {issueFilter.toLowerCase()} requests</strong><p>Choose another issue pill to view the active Madison queue.</p></div></article> : filteredSmsCards.map(card => <LiveNeedCard key={card.id} card={card} agentName={agentName ?? "Owner"} onChanged={refreshLiveQueue} />)}</div></section>
        <section className="ai-team-section"><div className="ai-team-section-heading"><div><span>YOUR AI TEAM</span><h2>Who is handling what</h2></div><button type="button" className="ai-team-text-button" onClick={() => setTab("agents")}>View all agents <ArrowRight size={14} /></button></div><div className="ai-team-agent-grid">{AGENTS.map(agent => <AgentCard key={agent.id} agent={agent} onOpen={setSelectedAgent} />)}</div></section>
        <section className="ai-team-section ai-team-activity-section"><div className="ai-team-section-heading"><div><span>LIVE ACTIVITY</span><h2>What is happening right now</h2></div><button type="button" className="ai-team-text-button" onClick={() => setTab("activity")}>See all activity <ArrowRight size={14} /></button></div><ActivityList compact items={activityItems} /></section>
      </>}

      {tab === "agents" && <section className="ai-team-section ai-team-tab-section"><div className="ai-team-section-heading"><div><span>AI TEAM</span><h2>Employees, not automations</h2></div><p>Each agent has a mission, authority, and clear escalation boundary.</p></div><div className="ai-team-agent-grid">{AGENTS.map(agent => <AgentCard key={agent.id} agent={agent} onOpen={setSelectedAgent} />)}</div></section>}
      {tab === "activity" && <section className="ai-team-section ai-team-tab-section"><div className="ai-team-section-heading"><div><span>LIVE ACTIVITY</span><h2>A clear record of what got done</h2></div><p>Open an item to see the reasoning, context, and action.</p></div><ActivityList items={activityItems} /></section>}

      <section className="ai-team-autonomy"><div><span>AUTONOMY</span><h2>How much should AI handle?</h2><p>Configure the default. Set tighter rules for individual actions in each agent’s authority.</p></div><div className="ai-team-autonomy-control"><div className="ai-team-autonomy-track">{["observe", "assist", "act", "run business"].map(item => <button type="button" key={item} className={autonomy === item ? "is-active" : ""} onClick={() => { setAutonomy(item); toast.info("Autonomy control is a visual review state only."); }}>{item}</button>)}</div><small>{autonomy === "observe" ? "AI recommends actions but does not take them." : autonomy === "assist" ? "AI handles conversations and asks before operational changes." : autonomy === "act" ? "AI handles routine operations independently." : "AI only escalates exceptions outside its authority."}</small></div></section>

      {selectedAgent && <div className="ai-team-drawer-backdrop" role="presentation" onClick={() => setSelectedAgent(null)}><aside className="ai-team-drawer" role="dialog" aria-modal="true" aria-label={`${selectedAgent.name} details`} onClick={event => event.stopPropagation()}><button className="ai-team-drawer-close" type="button" onClick={() => setSelectedAgent(null)} aria-label="Close agent details"><X size={18} /></button><div className="ai-team-drawer-agent"><AgentAvatar agent={selectedAgent} large /><div><span>AI TEAM · AGENT PROFILE</span><h2>{selectedAgent.name}</h2><p>{selectedAgent.role}</p></div></div><div className="ai-team-drawer-block"><span>MISSION</span><strong>{selectedAgent.mission}</strong></div><div className="ai-team-drawer-block"><span>CAN DO</span><div className="ai-team-check-list">{selectedAgent.capabilities.map(item => <p key={item}><Check size={14} />{item}</p>)}</div></div><div className="ai-team-drawer-block ai-team-drawer-escalate"><span>REQUIRES YOUR APPROVAL</span>{selectedAgent.approvals.map(item => <p key={item}><AlertTriangle size={14} />{item}</p>)}</div><button type="button" className="ai-team-drawer-footer" onClick={() => toast.info("Conversation detail is part of the next review iteration.")}>Watch current conversation <ArrowRight size={15} /></button></aside></div>}
    </main>
  );
}

function ActivityList({ compact = false, items }: { compact?: boolean; items: ActivityItem[] }) {
  if (items.length === 0) return <div className="ai-team-activity-list"><div className="ai-team-activity-empty">No active Madison activity is waiting for review.</div></div>;
  return <div className={`ai-team-activity-list ${compact ? "is-compact" : ""}`}>{items.map(item => <button type="button" className="ai-team-activity-row" key={item.id} onClick={() => toast.info("Open the Madison card above to review this item.")}><time>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(item.ts))}</time><span className={`ai-team-activity-dot is-${item.kind}`} /> <div><strong>{item.title}</strong><p>{item.detail}</p></div><ChevronRight size={15} /></button>)}</div>;
}

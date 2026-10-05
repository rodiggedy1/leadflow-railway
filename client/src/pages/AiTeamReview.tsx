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
import "./ai-team-review.css";

type Tab = "overview" | "agents" | "activity";
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

const NEEDS_YOU = [
  { id: "refund", type: "Refund request", detail: "Customer says the kitchen wasn't cleaned properly.", recommendation: "$40 credit + return visit.", action: "Approve", secondary: "Review", icon: "refund" },
  { id: "replacement", type: "Cleaner replacement", detail: "Maria called out for tomorrow's 8:30 AM job.", recommendation: "Team 7 is available but costs $28 more.", action: "Assign", secondary: "Review", icon: "team" },
  { id: "discount", type: "VIP discount request", detail: "Customer has completed 14 bookings · $4,820 lifetime.", recommendation: "Maximum automatic discount: 15%.", action: "Approve", secondary: "Decline", icon: "vip" },
];

const ACTIVITY = [
  ["1:24 PM", "Madison replied to Thumbtack lead", "Sarah asked about move-out cleaning.", "madison"],
  ["1:23 PM", "Follow-up Agent recovered abandoned quote", "$329 booking confirmed ✓", "followup"],
  ["1:21 PM", "Operations reassigned a job", "Team 3 → Team 6", "operations"],
  ["1:18 PM", "Customer Care issued $25 credit", "Within authorized limit", "care"],
  ["1:16 PM", "ETA Agent called Team 4", "Arrival confirmed for 1:45 PM", "eta"],
  ["1:12 PM", "Madison sent follow-up", "Lead had not responded for 2 hours", "madison"],
] as const;

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
  const [autonomy, setAutonomy] = useState("assist");
  const [resolved, setResolved] = useState<string[]>([]);

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
        <section className="ai-team-summary"><div><strong>184</strong><span>actions handled today</span></div><div><strong>37</strong><span>leads answered</span></div><div><strong>12</strong><span>bookings made</span></div><div><strong>$4,821</strong><span>booked today</span></div><div><strong>3</strong><span>need you</span></div></section>
        <section className="ai-team-section"><div className="ai-team-section-heading"><div><span>SUPERVISE THE COMPANY</span><h2>Needs you <b>3</b></h2></div><p>AI escalates only the decisions outside its authority.</p></div><div className="ai-team-needs-grid">{NEEDS_YOU.map(item => <article className={`ai-team-need-card ${resolved.includes(item.id) ? "is-resolved" : ""}`} key={item.id}><div className="ai-team-need-icon"><AlertTriangle size={17} /></div><div className="ai-team-need-copy"><strong>{item.type}</strong><p>{item.detail}</p><em>Madison recommends: {item.recommendation}</em></div><div className="ai-team-need-actions">{resolved.includes(item.id) ? <span className="ai-team-resolved"><Check size={14} />Previewed</span> : <><button type="button" onClick={() => actionPreview(item.id, item.action)}>{item.action}</button><button type="button" className="is-quiet" onClick={() => actionPreview(item.id, item.secondary)}>{item.secondary}</button></>}</div></article>)}</div></section>
        <section className="ai-team-section"><div className="ai-team-section-heading"><div><span>YOUR AI TEAM</span><h2>Who is handling what</h2></div><button type="button" className="ai-team-text-button" onClick={() => setTab("agents")}>View all agents <ArrowRight size={14} /></button></div><div className="ai-team-agent-grid">{AGENTS.map(agent => <AgentCard key={agent.id} agent={agent} onOpen={setSelectedAgent} />)}</div></section>
        <section className="ai-team-section ai-team-activity-section"><div className="ai-team-section-heading"><div><span>LIVE ACTIVITY</span><h2>What is happening right now</h2></div><button type="button" className="ai-team-text-button" onClick={() => setTab("activity")}>See all activity <ArrowRight size={14} /></button></div><ActivityList compact /></section>
      </>}

      {tab === "agents" && <section className="ai-team-section ai-team-tab-section"><div className="ai-team-section-heading"><div><span>AI TEAM</span><h2>Employees, not automations</h2></div><p>Each agent has a mission, authority, and clear escalation boundary.</p></div><div className="ai-team-agent-grid">{AGENTS.map(agent => <AgentCard key={agent.id} agent={agent} onOpen={setSelectedAgent} />)}</div></section>}
      {tab === "activity" && <section className="ai-team-section ai-team-tab-section"><div className="ai-team-section-heading"><div><span>LIVE ACTIVITY</span><h2>A clear record of what got done</h2></div><p>Open an item to see the reasoning, context, and action.</p></div><ActivityList /></section>}

      <section className="ai-team-autonomy"><div><span>AUTONOMY</span><h2>How much should AI handle?</h2><p>Configure the default. Set tighter rules for individual actions in each agent’s authority.</p></div><div className="ai-team-autonomy-control"><div className="ai-team-autonomy-track">{["observe", "assist", "act", "run business"].map(item => <button type="button" key={item} className={autonomy === item ? "is-active" : ""} onClick={() => { setAutonomy(item); toast.info("Autonomy control is a visual review state only."); }}>{item}</button>)}</div><small>{autonomy === "observe" ? "AI recommends actions but does not take them." : autonomy === "assist" ? "AI handles conversations and asks before operational changes." : autonomy === "act" ? "AI handles routine operations independently." : "AI only escalates exceptions outside its authority."}</small></div></section>

      {selectedAgent && <div className="ai-team-drawer-backdrop" role="presentation" onClick={() => setSelectedAgent(null)}><aside className="ai-team-drawer" role="dialog" aria-modal="true" aria-label={`${selectedAgent.name} details`} onClick={event => event.stopPropagation()}><button className="ai-team-drawer-close" type="button" onClick={() => setSelectedAgent(null)} aria-label="Close agent details"><X size={18} /></button><div className="ai-team-drawer-agent"><AgentAvatar agent={selectedAgent} large /><div><span>AI TEAM · AGENT PROFILE</span><h2>{selectedAgent.name}</h2><p>{selectedAgent.role}</p></div></div><div className="ai-team-drawer-block"><span>MISSION</span><strong>{selectedAgent.mission}</strong></div><div className="ai-team-drawer-block"><span>CAN DO</span><div className="ai-team-check-list">{selectedAgent.capabilities.map(item => <p key={item}><Check size={14} />{item}</p>)}</div></div><div className="ai-team-drawer-block ai-team-drawer-escalate"><span>REQUIRES YOUR APPROVAL</span>{selectedAgent.approvals.map(item => <p key={item}><AlertTriangle size={14} />{item}</p>)}</div><button type="button" className="ai-team-drawer-footer" onClick={() => toast.info("Conversation detail is part of the next review iteration.")}>Watch current conversation <ArrowRight size={15} /></button></aside></div>}
    </main>
  );
}

function ActivityList({ compact = false }: { compact?: boolean }) {
  return <div className={`ai-team-activity-list ${compact ? "is-compact" : ""}`}>{ACTIVITY.map(([time, title, detail, kind]) => <button type="button" className="ai-team-activity-row" key={`${time}-${title}`} onClick={() => toast.info("Activity detail is a review-only interaction.")}><time>{time}</time><span className={`ai-team-activity-dot is-${kind}`} /> <div><strong>{title}</strong><p>{detail}</p></div><ChevronRight size={15} /></button>)}</div>;
}

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  ContactRound,
  Crosshair,
  Download,
  Filter,
  List,
  Mail,
  MessageCircleMore,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Target,
  TriangleAlert,
  UserPlus,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import "./operations-crm-review.css";
import "./operations-crm-reference-fit.css";
import "./operations-crm-owner-portraits.css";
import "./leads-crm-exact-live.css";

type LeadRow = {
  id: number;
  name: string | null;
  phone: string;
  email: string | null;
  source: string | null;
  stage: string;
  ownerName: string | null;
  serviceType: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  address: string | null;
  quotedPrice: string | null;
  bookedAmount: number | null;
  isBooked: boolean;
  messageCount: number;
  lastMessage: string | null;
  lastMessageRole: string | null;
  lastActivityAt: number;
  createdAt: number;
  hasUnread: boolean;
  activity: number[];
};

type MenuKey = "sort" | "owner" | "stage" | "period" | null;
type SortMode = "newest" | "oldest" | "newest-created";
type PeriodMode = "all" | "90d" | "30d" | "7d";

const PRIMARY_NAV = [
  { label: "Leads", icon: Building2 },
  { label: "Deals Board", icon: ClipboardList },
  { label: "Forecast", icon: BarChart3 },
  { label: "Activities", icon: List },
  { label: "Contacts", icon: ContactRound },
  { label: "Email Sequences", icon: Mail },
] as const;

const NAV_GROUPS = [
  { label: "TEAM", items: [{ label: "Strategic AEs", icon: Target }, { label: "Mid Market", icon: Crosshair }, { label: "SDR Team", icon: UsersRound }] },
  { label: "REPORTING", items: [{ label: "Q1 Forecast", icon: ChartNoAxesColumnIncreasing }, { label: "Slipping Deals", icon: TriangleAlert }] },
] as const;

const SOURCE_TONES = ["blue", "green", "amber", "orange", "rose", "violet"] as const;

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function toneFor(value: string) {
  const total = [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return SOURCE_TONES[total % SOURCE_TONES.length];
}

function humanize(value: string | null | undefined, fallback = "Direct") {
  if (!value) return fallback;
  return value.replace(/^campaign:/, "Campaign · ").replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMoney(value: string | number | null) {
  if (value === null || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—";
}

function formatDate(value: number) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function lastActivityLabel(lead: LeadRow) {
  if (!lead.lastActivityAt) return "No messages yet";
  if (lead.lastMessageRole === "user" || lead.lastMessageRole === "customer") return lead.hasUnread ? "New reply" : "Customer reply";
  if (lead.lastMessageRole === "assistant") return "Team reply";
  return "Activity";
}

function LeadActivityBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return <div className="ocr-activity-bars" aria-label="Actual message activity over the last thirty days">{values.map((value, index) => <span key={index} className={value ? "is-live" : ""} style={{ height: `${value ? Math.max(3, Math.round((value / max) * 16)) : 3}px` }} />)}</div>;
}

function FilterControl({ label, value, isOpen, onClick, children }: { label: string; value: string; isOpen: boolean; onClick: () => void; children: React.ReactNode }) {
  return <div className="ocr-live-filter-wrap"><button type="button" className="ocr-filter" aria-expanded={isOpen} onClick={onClick}><span className="ocr-filter-label">{label}</span><strong>{value}</strong><ChevronDown size={14} /></button>{isOpen && <div className="ocr-live-filter-menu">{children}</div>}</div>;
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

  return <main className="ocr-live-login"><form className="ocr-live-login-card" onSubmit={submit}><div className="ocr-live-login-mark"><Building2 /></div><div><strong>Leads CRM</strong><span>Sign in to view incoming leads</span></div><label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p>{error}</p>}<button type="submit" disabled={pending || !email || !password}>{pending ? "Signing in…" : "Sign in"}</button></form></main>;
}

function LeadDetailDrawer({ lead, ownerPhoto, onClose }: { lead: LeadRow; ownerPhoto: string | null; onClose: () => void }) {
  const source = humanize(lead.source);
  const stage = humanize(lead.stage, "New lead");
  const owner = lead.ownerName ?? "Unassigned";
  const lastMessage = lead.lastMessage?.trim() || "No message content has been recorded for this lead.";
  const totalActivity = lead.activity.reduce((total, count) => total + count, 0);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  return <><button type="button" className="ocr-drawer-backdrop" aria-label="Close lead details" onClick={onClose} /><aside className="ocr-detail-drawer ocr-live-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="ocr-detail-title"><header className="ocr-detail-drawer-header"><div><Building2 size={16} strokeWidth={1.5} /><strong>Lead details</strong></div><button type="button" aria-label="Close lead details" onClick={onClose}><X size={18} strokeWidth={1.6} /></button></header><div className="ocr-detail-drawer-scroll"><section className="ocr-detail-identity"><div className="ocr-detail-company-mark"><Building2 size={31} strokeWidth={1.4} /></div><div><h2 id="ocr-detail-title">{lead.name || lead.phone}</h2><div className="ocr-detail-pills"><span className={`ocr-pill ocr-pill-${toneFor(source)}`}>{source}</span><span className={`ocr-pill ocr-pill-${toneFor(stage)}`}>{stage}</span></div></div></section><section className="ocr-detail-section ocr-detail-summary"><h3>Lead summary</h3><div className="ocr-detail-contact">{ownerPhoto ? <img className="ocr-owner-portrait ocr-owner-portrait-detail" src={ownerPhoto} alt={owner} /> : <i>{initials(owner)}</i>}<strong>{owner}</strong><span><Mail size={15} fill="currentColor" />{lead.email || "No email captured"}</span><span><Phone size={15} fill="currentColor" />{lead.phone}</span></div></section><section className="ocr-detail-section ocr-detail-pipeline"><h3>Lead information</h3><strong className="ocr-detail-probability">{formatMoney(lead.quotedPrice)}</strong><p>Quoted amount. A dash means no quote has been captured.</p><div className="ocr-detail-health-list"><div><div><span>Stage</span><strong>{stage}</strong></div></div><div><div><span>Service</span><strong>{lead.serviceType || "Not captured"}</strong></div></div><div><div><span>Booked amount</span><strong>{formatMoney(lead.bookedAmount)}</strong></div></div></div></section><section className="ocr-detail-section ocr-detail-activity"><div className="ocr-detail-section-heading"><h3>Activity trend</h3><button type="button" disabled>Last 30 Days<ChevronDown size={14} strokeWidth={1.5} /></button></div><div className="ocr-detail-activity-total"><strong>{totalActivity}</strong><LeadActivityBars values={lead.activity} /></div><p>Actual messages recorded in the last thirty days.</p><div className="ocr-detail-stat-grid"><div><span><MessageCircleMore size={14} />Messages</span><strong>{lead.messageCount}</strong></div><div><span><CalendarDays size={14} />Last activity</span><strong>{formatDate(lead.lastActivityAt)}</strong></div><div><span><Building2 size={14} />Source</span><strong>{source}</strong></div><div><span><Phone size={14} />Status</span><strong>{lastActivityLabel(lead)}</strong></div></div></section><section className="ocr-detail-section ocr-detail-scorecard"><div className="ocr-detail-section-heading"><h3>Latest message</h3><button type="button" disabled>{formatDate(lead.lastActivityAt)}</button></div><article><strong>{lastActivityLabel(lead)}</strong><p>{lastMessage}</p><footer><span>Created {formatDate(lead.createdAt)}</span><b>{lead.isBooked ? "Booked" : lead.hasUnread ? "Unread" : "Tracked"}</b></footer></article></section></div><footer className="ocr-detail-drawer-footer"><span>Read-only lead view</span><div><button type="button" onClick={onClose}>Close</button></div></footer></aside></>;
}

export default function LeadsCRMExactLive() {
  const utils = trpc.useUtils();
  const { data: agentMe, isLoading: agentLoading, isError: agentError, refetch: refetchAgent } = trpc.agents.me.useQuery(undefined, { staleTime: 5 * 60 * 1000, retry: false });
  const authenticated = Boolean(agentMe);
  const { data: leadRows = [], isLoading: leadsLoading } = trpc.commandCenter.listIncomingLeads.useQuery(undefined, { enabled: authenticated, refetchInterval: 30_000, refetchIntervalInBackground: false });
  const { data: photosData } = trpc.agents.getPhotoMap.useQuery(undefined, { enabled: authenticated, staleTime: 30_000 });
  const [activeNav, setActiveNav] = useState("Leads");
  const [activeTab, setActiveTab] = useState("Leads");
  const [menu, setMenu] = useState<MenuKey>(null);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [period, setPeriod] = useState<PeriodMode>("all");
  const [selected, setSelected] = useState<number[]>([]);
  const [detailLead, setDetailLead] = useState<LeadRow | null>(null);
  const [notice, setNotice] = useState("");

  useOpsStream({ onLeadUpdate: () => void utils.commandCenter.listIncomingLeads.invalidate() }, { enabled: authenticated, label: "LeadsCRMExactLive" });

  const rows = leadRows as LeadRow[];
  const ownerNames = useMemo(() => Array.from(new Set(rows.map((lead) => lead.ownerName).filter((name): name is string => Boolean(name)))).sort(), [rows]);
  const stageNames = useMemo(() => Array.from(new Set(rows.map((lead) => lead.stage))).sort(), [rows]);
  const visibleRows = useMemo(() => {
    const now = Date.now();
    const cutoff = period === "all" ? 0 : now - ({ "90d": 90, "30d": 30, "7d": 7 }[period] * 24 * 60 * 60 * 1000);
    const filtered = rows.filter((lead) => (ownerFilter === "all" || (ownerFilter === "unassigned" ? !lead.ownerName : lead.ownerName === ownerFilter)) && (stageFilter === "all" || lead.stage === stageFilter) && (!cutoff || lead.lastActivityAt >= cutoff));
    return filtered.slice().sort((left, right) => {
      if (sortMode === "oldest") return left.lastActivityAt - right.lastActivityAt;
      if (sortMode === "newest-created") return right.createdAt - left.createdAt;
      return right.lastActivityAt - left.lastActivityAt;
    });
  }, [ownerFilter, period, rows, sortMode, stageFilter]);
  const allSelected = visibleRows.length > 0 && visibleRows.every((lead) => selected.includes(lead.id));
  const toggleAll = () => setSelected(allSelected ? [] : visibleRows.map((lead) => lead.id));
  const toggleRow = (id: number) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const ownerPhotos = photosData?.photos ?? {};

  if (agentLoading) return <main className="ocr-live-loading">Loading Leads CRM…</main>;
  if (agentError || !agentMe) return <LoginGate onSuccess={() => void refetchAgent()} />;

  const filterLabel = (key: MenuKey) => key === "sort" ? (sortMode === "newest" ? "Newest activity" : sortMode === "oldest" ? "Oldest activity" : "Newest lead") : key === "owner" ? (ownerFilter === "all" ? "All owners" : ownerFilter === "unassigned" ? "Unassigned" : ownerFilter) : key === "stage" ? (stageFilter === "all" ? "Any" : humanize(stageFilter)) : period === "all" ? "All time" : period === "90d" ? "90 Days" : period === "30d" ? "30 Days" : "7 Days";
  const choose = (action: () => void) => { action(); setMenu(null); };
  const inactiveNotice = (label: string) => setNotice(`${label} is not part of the first Leads CRM release.`);

  return <div className="operations-crm-review leads-crm-live"><aside className="ocr-sidebar" aria-label="Leads CRM navigation"><div className="ocr-brand"><SalesCrmLogo /><div><strong>Leads CRM</strong><span>Incoming leads</span></div></div><div className="ocr-nav-scroll"><nav className="ocr-nav-primary" aria-label="CRM primary navigation">{PRIMARY_NAV.map(({ label, icon: Icon }) => <button type="button" key={label} className={activeNav === label ? "is-active" : ""} onClick={() => { if (label === "Leads") setActiveNav(label); else inactiveNotice(label); }}><Icon size={14} strokeWidth={1.4} /><span>{label}</span>{label === "Leads" && <b>{rows.length}</b>}</button>)}</nav>{NAV_GROUPS.map((group) => <section className="ocr-nav-group" key={group.label}><p>{group.label}</p>{group.items.map(({ label, icon: Icon }) => <button type="button" key={label} className={activeNav === label ? "is-active" : ""} onClick={() => inactiveNotice(label)}><Icon size={14} strokeWidth={1.4} /><span>{label}</span></button>)}</section>)}<section className="ocr-nav-group ocr-pipelines"><p>PIPELINES</p><button type="button" onClick={() => inactiveNotice("North America")}><i className="dot-yellow" />North America</button><button type="button" onClick={() => inactiveNotice("EMEA Enterprise")}><i className="dot-pink" />EMEA Enterprise</button><button type="button" onClick={() => inactiveNotice("APAC Expansion")}><i className="dot-violet" />APAC Expansion</button></section></div><div className="ocr-nav-utility"><button type="button" onClick={() => inactiveNotice("Invite teammates")}><UserPlus size={14} strokeWidth={1.4} />Invite teammates</button><button type="button" onClick={() => inactiveNotice("Help")}><CircleHelp size={14} strokeWidth={1.4} />Help</button></div><div className="ocr-sidebar-footer"><div className="ocr-trial"><div><strong>{rows.length}</strong><span>Incoming leads</span></div><button type="button" onClick={() => inactiveNotice("Billing")}><WalletCards size={14} strokeWidth={1.4} />Add Billings</button></div></div></aside><main className="ocr-workspace"><header className="ocr-header"><div className="ocr-page-title"><h1>Leads</h1><span><i />Live queue</span></div><div className="ocr-header-actions"><button type="button" aria-label="Search leads" onClick={() => inactiveNotice("Search")}><Search size={18} /></button><button type="button" aria-label="Lead notifications" className={rows.some((lead) => lead.hasUnread) ? "has-notification" : ""} onClick={() => setStageFilter("all")}><Bell size={18} /></button><button type="button" className="ocr-profile"><i>{initials(agentMe.name || "Agent")}</i><span>{agentMe.name || "Agent"}</span><ChevronDown size={14} /></button></div></header><section className="ocr-tabs" aria-label="CRM workspace tabs">{["Leads", "Deals", "Forecast"].map((tab) => <button type="button" key={tab} className={activeTab === tab ? "is-active" : ""} onClick={() => { if (tab === "Leads") setActiveTab(tab); else inactiveNotice(tab); }}>{tab}</button>)}</section><section className="ocr-toolbar" aria-label="Leads CRM toolbar"><div className="ocr-toolbar-filters"><FilterControl label="Sort by" value={filterLabel("sort")} isOpen={menu === "sort"} onClick={() => setMenu(menu === "sort" ? null : "sort")}><button type="button" onClick={() => choose(() => setSortMode("newest"))}>Newest activity</button><button type="button" onClick={() => choose(() => setSortMode("oldest"))}>Oldest activity</button><button type="button" onClick={() => choose(() => setSortMode("newest-created"))}>Newest lead</button></FilterControl><FilterControl label="Filter" value={filterLabel("owner")} isOpen={menu === "owner"} onClick={() => setMenu(menu === "owner" ? null : "owner")}><button type="button" onClick={() => choose(() => setOwnerFilter("all"))}>All owners</button><button type="button" onClick={() => choose(() => setOwnerFilter("unassigned"))}>Unassigned</button>{ownerNames.map((owner) => <button type="button" key={owner} onClick={() => choose(() => setOwnerFilter(owner))}>{owner}</button>)}</FilterControl><FilterControl label="Stage" value={filterLabel("stage")} isOpen={menu === "stage"} onClick={() => setMenu(menu === "stage" ? null : "stage")}><button type="button" onClick={() => choose(() => setStageFilter("all"))}>Any</button>{stageNames.map((stage) => <button type="button" key={stage} onClick={() => choose(() => setStageFilter(stage))}>{humanize(stage)}</button>)}</FilterControl><FilterControl label="Last Activity" value={filterLabel("period")} isOpen={menu === "period"} onClick={() => setMenu(menu === "period" ? null : "period")}><button type="button" onClick={() => choose(() => setPeriod("all"))}>All time</button><button type="button" onClick={() => choose(() => setPeriod("90d"))}>90 days</button><button type="button" onClick={() => choose(() => setPeriod("30d"))}>30 days</button><button type="button" onClick={() => choose(() => setPeriod("7d"))}>7 days</button></FilterControl></div><div className="ocr-toolbar-actions"><button type="button" className="ocr-export" onClick={() => inactiveNotice("Export")}><Download size={16} />Export</button><button type="button" className="ocr-new-company" onClick={() => inactiveNotice("New Lead")}><Plus size={14} />New Lead</button></div></section><section className="ocr-table-shell" aria-label="Incoming lead table"><div className="ocr-table-scroll"><table className="ocr-table ocr-live-table"><thead><tr><th className="ocr-checkbox-column"><button type="button" className={`ocr-checkbox ${allSelected ? "is-selected" : ""}`} onClick={toggleAll} aria-label="Select all visible leads">{allSelected && "✓"}</button></th><th>Leads</th><th>Source &amp; Stage</th><th>Account owner</th><th>Messages</th><th>Quoted amount</th><th>Booked amount</th><th>Activity trend</th><th>Last interaction</th><th aria-label="Actions" /></tr></thead><tbody>{leadsLoading ? <tr><td colSpan={10}><div className="ocr-live-empty">Loading incoming leads…</div></td></tr> : visibleRows.length === 0 ? <tr><td colSpan={10}><div className="ocr-live-empty"><Filter size={16} />No incoming leads match these filters.</div></td></tr> : visibleRows.map((lead) => { const name = lead.name || lead.phone; const source = humanize(lead.source); const stage = humanize(lead.stage, "New lead"); const owner = lead.ownerName || "Unassigned"; const photo = lead.ownerName ? ownerPhotos[lead.ownerName] ?? null : null; const selectedRow = selected.includes(lead.id); return <tr key={lead.id} className={selectedRow ? "is-selected" : ""} onClick={() => setDetailLead(lead)}><td className="ocr-checkbox-column"><button type="button" className={`ocr-checkbox ${selectedRow ? "is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); toggleRow(lead.id); }} aria-label={`Select ${name}`}>{selectedRow && "✓"}</button></td><td className="ocr-company"><button type="button" onClick={() => setDetailLead(lead)}>{name}</button><small>{lead.phone}</small></td><td><div className="ocr-pill-group"><span className={`ocr-pill ocr-pill-${toneFor(source)}`}>{source}</span><span className={`ocr-pill ocr-pill-${toneFor(stage)}`}>{stage}</span></div></td><td><button type="button" className="ocr-owner" onClick={() => setDetailLead(lead)}>{photo ? <img className="ocr-owner-portrait" src={photo} alt={owner} /> : <i>{initials(owner)}</i>}<span>{owner}</span></button></td><td className="ocr-number">{lead.messageCount}</td><td className="ocr-money">{formatMoney(lead.quotedPrice)}</td><td className="ocr-money">{formatMoney(lead.bookedAmount)}</td><td><LeadActivityBars values={lead.activity} /></td><td><div className="ocr-interaction"><CalendarDays size={15} /><span>{formatDate(lead.lastActivityAt)}</span><i />{lead.hasUnread && <b className="ocr-live-unread">New reply</b>}{!lead.hasUnread && <strong>{lastActivityLabel(lead)}</strong>}</div></td><td><button type="button" className="ocr-overflow" aria-label={`Open ${name} details`} onClick={() => setDetailLead(lead)}><MoreHorizontal size={19} /></button></td></tr>; })}</tbody></table></div><footer className="ocr-calculation-footer"><div>{visibleRows.length} incoming lead{visibleRows.length === 1 ? "" : "s"} in view</div><div><Plus size={13} />Unread <strong>{visibleRows.filter((lead) => lead.hasUnread).length}</strong></div><div><Plus size={13} />Booked <strong>{visibleRows.filter((lead) => lead.isBooked).length}</strong></div><button type="button" onClick={() => inactiveNotice("Calculations")}><Plus size={13} />Add calculation</button></footer></section>{notice && <div className="ocr-live-notice" role="status">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={13} /></button></div>}</main>{detailLead && <LeadDetailDrawer lead={detailLead} ownerPhoto={detailLead.ownerName ? ownerPhotos[detailLead.ownerName] ?? null : null} onClose={() => setDetailLead(null)} />}</div>;
}

function SalesCrmLogo() {
  return <svg className="ocr-logo-mark" viewBox="0 0 40 41" fill="none" aria-hidden="true"><rect width="32" height="32" x="4" y="1" fill="#2A2A2A" rx="8" /><path fill="#fff" fillRule="evenodd" d="M17.172 8c-1.016 0-1.99.403-2.708 1.121L11 12.586v1.586c0 1.12.481 2.128 1.248 2.828A3.82 3.82 0 0 0 11 19.828v1.586l3.464 3.465A3.83 3.83 0 0 0 20 24.752a3.828 3.828 0 0 0 5.535.127L29 21.414v-1.586c0-1.12-.481-2.128-1.248-2.828A3.82 3.82 0 0 0 29 14.172v-1.586L25.535 9.12A3.83 3.83 0 0 0 20 9.248 3.82 3.82 0 0 0 17.172 8m5.42 9a4 4 0 0 1-.127-.121L20 14.414l-2.465 2.465a4 4 0 0 1-.127.121q.066.06.127.121L20 19.586l2.465-2.465q.061-.062.127-.121M21 21.414v.758a1.828 1.828 0 0 0 3.121 1.293L27 20.585v-.757a1.828 1.828 0 0 0-3.121-1.293zm-2 0-2.879-2.879A1.828 1.828 0 0 0 13 19.829v.758l2.879 2.879A1.828 1.828 0 0 0 19 22.172zm0-9.586v.758l-2.879 2.878A1.828 1.828 0 0 1 13 14.173v-.758l2.879-2.878A1.828 1.828 0 0 1 19 11.828m4.879 3.637L21 12.584v-.757a1.828 1.828 0 0 1 3.121-1.292L27 13.414v.758a1.828 1.828 0 0 1-3.121 1.292" clipRule="evenodd" /></svg>;
}

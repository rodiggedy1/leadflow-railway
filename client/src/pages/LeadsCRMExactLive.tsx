import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  Download,
  Filter,
  Mail,
  MessageCircleMore,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import { useLocation, useSearch } from "wouter";
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

const DEFAULT_ACTIVITY_TREND = [4, 7, 5, 9, 6, 11, 8, 12, 7, 10, 9, 13];
const DEFAULT_WIN_PROBABILITY = 50;
const SOURCE_TONES = ["blue", "green", "amber", "orange", "rose", "violet"] as const;

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function stableIndex(value: string, length: number) {
  return Math.abs(Array.from(value).reduce((total, character) => total + character.charCodeAt(0), 0)) % length;
}

function customerPortraitFor(value: string) {
  return CUSTOMER_PORTRAITS[stableIndex(value, CUSTOMER_PORTRAITS.length)];
}

function activityTrendFor(values: number[]) {
  return values.some((value) => value > 0) ? values : DEFAULT_ACTIVITY_TREND;
}

function toneFor(value: string) {
  return SOURCE_TONES[stableIndex(value, SOURCE_TONES.length)];
}

function humanize(value: string | null | undefined, fallback = "Direct") {
  if (!value) return fallback;
  return value.replace(/^campaign:/, "Campaign · ").replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayStage(value: string | null | undefined) {
  return value === "QUOTE_SENT" || value?.toLowerCase() === "quote sent" ? "Quote" : humanize(value, "New lead");
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
  const trend = activityTrendFor(values);
  const max = Math.max(...trend, 1);
  return <div className="ocr-activity-bars" aria-label="Lead activity trend">{trend.map((value, index) => <span key={index} className="is-live" style={{ height: `${Math.max(3, Math.round((value / max) * 16))}px` }} />)}</div>;
}

function ProbabilityMeter({ value }: { value: number }) {
  const filled = Math.max(1, Math.round(value / 10));
  return <div className="ocr-probability" aria-label={`${value}% win probability`}><div className="ocr-probability-bars" aria-hidden="true">{Array.from({ length: 10 }).map((_, index) => <span key={index} className={index < filled ? `is-filled tone-${Math.min(3, Math.floor((index / 10) * 4))}` : ""} />)}</div><strong>{value}%</strong></div>;
}

function FilterControl({ label, value, isOpen, onClick, children }: { label: string; value: string; isOpen: boolean; onClick: () => void; children: ReactNode }) {
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

type LeadEditorAgent = { id: number; name: string; isActive: boolean | number };

function LeadDetailDrawer({ lead, ownerPhoto, canEdit, agents, onLeadUpdated, onClose }: { lead: LeadRow; ownerPhoto: string | null; canEdit: boolean; agents: LeadEditorAgent[]; onLeadUpdated: (changes: Partial<Pick<LeadRow, "ownerName" | "phone">>) => void; onClose: () => void }) {
  const name = lead.name || lead.phone;
  const source = humanize(lead.source);
  const stage = displayStage(lead.stage);
  const owner = lead.ownerName ?? "Unassigned";
  const lastMessage = lead.lastMessage?.trim() || "No message content has been recorded for this lead.";
  const totalActivity = lead.activity.reduce((total, count) => total + count, 0);
  const activeAgents = agents.filter((agent) => Boolean(agent.isActive));
  const [editingOwner, setEditingOwner] = useState(false);
  const [editingPhone, setEditingPhone] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [phoneDraft, setPhoneDraft] = useState(lead.phone);
  const [editorError, setEditorError] = useState("");
  const selectedAgent = activeAgents.find((agent) => agent.id === selectedAgentId) ?? null;
  const currentAgentId = activeAgents.find((agent) => agent.name === lead.ownerName)?.id ?? null;
  const assignAgent = trpc.leads.adminAssignAgent.useMutation({
    onSuccess: () => {
      onLeadUpdated({ ownerName: selectedAgent?.name ?? null });
      setEditingOwner(false);
      setEditorError("");
    },
    onError: (error) => setEditorError(error.message),
  });
  const updatePhone = trpc.leads.updateLeadPhone.useMutation({
    onSuccess: (result) => {
      onLeadUpdated({ phone: result.leadPhone });
      setPhoneDraft(result.leadPhone);
      setEditingPhone(false);
      setEditorError("");
    },
    onError: (error) => setEditorError(error.message),
  });

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [onClose]);
  useEffect(() => {
    setSelectedAgentId(activeAgents.find((agent) => agent.name === lead.ownerName)?.id ?? null);
    setPhoneDraft(lead.phone);
    setEditingOwner(false);
    setEditingPhone(false);
    setEditorError("");
  }, [lead.id, lead.ownerName, lead.phone, agents]);

  return <><button type="button" className="ocr-drawer-backdrop" aria-label="Close lead details" onClick={onClose} /><aside className="ocr-detail-drawer ocr-live-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="ocr-detail-title"><header className="ocr-detail-drawer-header"><div><Building2 size={16} strokeWidth={1.5} /><strong>Lead details</strong></div><button type="button" aria-label="Close lead details" onClick={onClose}><X size={18} strokeWidth={1.6} /></button></header><div className="ocr-detail-drawer-scroll"><section className="ocr-detail-identity"><img className="ocr-lead-detail-portrait" src={customerPortraitFor(name)} alt={`Portrait illustration for ${name}`} /><div><h2 id="ocr-detail-title">{name}</h2><div className="ocr-detail-pills"><span className={`ocr-pill ocr-pill-${toneFor(source)}`}>{source}</span><span className={`ocr-pill ocr-pill-${toneFor(stage)}`}>{stage}</span></div></div></section><section className="ocr-detail-section ocr-detail-summary"><h3>Lead summary</h3><div className="ocr-detail-contact">{ownerPhoto ? <img className="ocr-owner-portrait ocr-owner-portrait-detail" src={ownerPhoto} alt={owner} /> : <i>{initials(owner)}</i>}<div className="ocr-live-lead-summary-values">{editingOwner ? <div className="ocr-live-editor"><label>Assignee<select value={selectedAgentId ?? ""} onChange={(event) => setSelectedAgentId(event.target.value ? Number(event.target.value) : null)} disabled={assignAgent.isPending}><option value="">Unassigned</option>{activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><div><button type="button" onClick={() => { setEditingOwner(false); setEditorError(""); }}>Cancel</button><button type="button" className="ocr-live-editor-save" disabled={assignAgent.isPending || selectedAgentId === currentAgentId} onClick={() => assignAgent.mutate({ sessionId: lead.id, agentId: selectedAgentId })}>{assignAgent.isPending ? "Saving…" : "Save assignee"}</button></div></div> : <div className="ocr-live-edit-row"><strong>{owner}</strong>{canEdit && <button type="button" aria-label="Edit lead assignee" onClick={() => { setEditingOwner(true); setEditorError(""); }}><Pencil size={13} /></button>}</div>}<span><Mail size={15} fill="currentColor" />{lead.email || "No email captured"}</span>{editingPhone ? <form className="ocr-live-editor ocr-live-phone-editor" onSubmit={(event) => { event.preventDefault(); updatePhone.mutate({ sessionId: lead.id, leadPhone: phoneDraft }); }}><label>Phone<input type="tel" value={phoneDraft} onChange={(event) => setPhoneDraft(event.target.value)} autoComplete="tel" disabled={updatePhone.isPending} /></label><div><button type="button" onClick={() => { setEditingPhone(false); setPhoneDraft(lead.phone); setEditorError(""); }}>Cancel</button><button type="submit" className="ocr-live-editor-save" disabled={updatePhone.isPending || !phoneDraft.trim() || phoneDraft === lead.phone}>{updatePhone.isPending ? "Saving…" : "Save phone"}</button></div></form> : <div className="ocr-live-edit-row"><span><Phone size={15} fill="currentColor" />{lead.phone}</span>{canEdit && <button type="button" aria-label="Edit lead phone" onClick={() => { setEditingPhone(true); setEditorError(""); }}><Pencil size={13} /></button>}</div>}{editorError && <p className="ocr-live-editor-error" role="alert">{editorError}</p>}</div></div></section><section className="ocr-detail-section ocr-detail-pipeline"><h3>Lead information</h3><strong className="ocr-detail-probability">{formatMoney(lead.quotedPrice)}</strong><p>Pipeline value. A dash means no quote has been captured.</p><div className="ocr-detail-health-list"><div><div><span>Stage</span><strong>{stage}</strong></div></div><div><div><span>Service</span><strong>{lead.serviceType || "Not captured"}</strong></div></div><div><div><span>Win probability</span><strong>50%</strong></div></div></div></section><section className="ocr-detail-section ocr-detail-activity"><div className="ocr-detail-section-heading"><h3>Activity trend</h3><button type="button" disabled>Last 30 Days<ChevronDown size={14} strokeWidth={1.5} /></button></div><div className="ocr-detail-activity-total"><strong>{totalActivity}</strong><LeadActivityBars values={lead.activity} /></div><p>Default trend is shown until message activity is available.</p><div className="ocr-detail-stat-grid"><div><span><MessageCircleMore size={14} />Messages</span><strong>{lead.messageCount}</strong></div><div><span><CalendarDays size={14} />Last activity</span><strong>{formatDate(lead.lastActivityAt)}</strong></div><div><span><Building2 size={14} />Source</span><strong>{source}</strong></div><div><span><Phone size={14} />Status</span><strong>{lastActivityLabel(lead)}</strong></div></div></section><section className="ocr-detail-section ocr-detail-scorecard"><div className="ocr-detail-section-heading"><h3>Latest message</h3><button type="button" disabled>{formatDate(lead.lastActivityAt)}</button></div><article><strong>{lastActivityLabel(lead)}</strong><p>{lastMessage}</p><footer><span>Created {formatDate(lead.createdAt)}</span><b>{lead.isBooked ? "Booked" : lead.hasUnread ? "Unread" : "Tracked"}</b></footer></article></section></div><footer className="ocr-detail-drawer-footer"><span>{canEdit ? "Admin lead editing" : "Lead details"}</span><div><button type="button" onClick={onClose}>Close</button></div></footer></aside></>;
}

export default function LeadsCRMExactLive() {
  const utils = trpc.useUtils();
  const { data: agentMe, isLoading: agentLoading, isError: agentError, refetch: refetchAgent } = trpc.agents.me.useQuery(undefined, { staleTime: 5 * 60 * 1000, retry: false });
  const authenticated = Boolean(agentMe);
  const { data: leadRows = [], isLoading: leadsLoading } = trpc.commandCenter.listIncomingLeads.useQuery(undefined, { enabled: authenticated, refetchInterval: 30_000, refetchIntervalInBackground: false });
  const { data: photosData } = trpc.agents.getPhotoMap.useQuery(undefined, { enabled: authenticated, staleTime: 30_000 });
  const { data: editorAgents = [] } = trpc.agents.list.useQuery(undefined, { enabled: Boolean(agentMe?.isAdmin), staleTime: 30_000 });
  const [activeTab, setActiveTab] = useState("Leads");
  const [menu, setMenu] = useState<MenuKey>(null);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [period, setPeriod] = useState<PeriodMode>("all");
  const [selected, setSelected] = useState<number[]>([]);
  const [detailLead, setDetailLead] = useState<LeadRow | null>(null);
  const [notice, setNotice] = useState("");
  const [, navigate] = useLocation();
  const locationSearch = useSearch();
  const locationParams = useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const requestedLeadId = useMemo(() => {
    const candidate = Number(locationParams.get("leadId"));
    return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
  }, [locationParams]);
  const requestedSearch = locationParams.get("search") ?? "";
  const [leadSearch, setLeadSearch] = useState(requestedSearch);
  const handledLeadDeepLinkRef = useRef<string | null>(null);
  const detailWasOpenRef = useRef(false);

  useOpsStream({ onLeadUpdate: () => void utils.commandCenter.listIncomingLeads.invalidate() }, { enabled: authenticated, label: "LeadsCRMExactLive" });

  const rows = leadRows as LeadRow[];
  useEffect(() => { setLeadSearch(requestedSearch); }, [requestedSearch]);
  useEffect(() => {
    if (!requestedLeadId) { handledLeadDeepLinkRef.current = null; return; }
    if (!authenticated || leadsLoading) return;
    const deepLinkKey = `leadId:${requestedLeadId}`;
    if (handledLeadDeepLinkRef.current === deepLinkKey) return;
    handledLeadDeepLinkRef.current = deepLinkKey;
    const requestedLead = rows.find((lead) => lead.id === requestedLeadId);
    if (requestedLead) setDetailLead(requestedLead);
    else setNotice("That lead is not available in the current Leads view.");
  }, [authenticated, leadsLoading, requestedLeadId, rows]);
  useEffect(() => {
    if (detailLead) {
      detailWasOpenRef.current = true;
      const params = new URLSearchParams(locationSearch);
      if (params.get("leadId") !== String(detailLead.id)) {
        params.set("leadId", String(detailLead.id));
        navigate(`/admin/leads?${params.toString()}`);
      }
      return;
    }
    if (!detailWasOpenRef.current || !requestedLeadId) return;
    detailWasOpenRef.current = false;
    const params = new URLSearchParams(locationSearch);
    params.delete("leadId");
    const query = params.toString();
    navigate(query ? `/admin/leads?${query}` : "/admin/leads");
  }, [detailLead, locationSearch, navigate, requestedLeadId]);
  const ownerNames = useMemo(() => Array.from(new Set(rows.map((lead) => lead.ownerName).filter((name): name is string => Boolean(name)))).sort(), [rows]);
  const stageNames = useMemo(() => Array.from(new Set(rows.map((lead) => lead.stage))).sort(), [rows]);
  const visibleRows = useMemo(() => {
    const now = Date.now();
    const cutoff = period === "all" ? 0 : now - ({ "90d": 90, "30d": 30, "7d": 7 }[period] * 24 * 60 * 60 * 1000);
    const query = leadSearch.trim().toLowerCase();
    const digits = leadSearch.replace(/\D/g, "");
    const filtered = rows.filter((lead) => {
      const matchesFilters = (ownerFilter === "all" || (ownerFilter === "unassigned" ? !lead.ownerName : lead.ownerName === ownerFilter)) && (stageFilter === "all" || lead.stage === stageFilter) && (!cutoff || lead.lastActivityAt >= cutoff);
      if (!matchesFilters || !query) return matchesFilters;
      const searchable = [lead.name, lead.phone, lead.email, lead.source, lead.serviceType, lead.address, lead.ownerName].filter(Boolean).join(" ").toLowerCase();
      return searchable.includes(query) || (digits.length >= 4 && lead.phone.replace(/\D/g, "").includes(digits));
    });
    return filtered.slice().sort((left, right) => {
      if (sortMode === "oldest") return left.lastActivityAt - right.lastActivityAt;
      if (sortMode === "newest-created") return right.createdAt - left.createdAt;
      return right.lastActivityAt - left.lastActivityAt;
    });
  }, [leadSearch, ownerFilter, period, rows, sortMode, stageFilter]);
  const allSelected = visibleRows.length > 0 && visibleRows.every((lead) => selected.includes(lead.id));
  const toggleAll = () => setSelected(allSelected ? [] : visibleRows.map((lead) => lead.id));
  const toggleRow = (id: number) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const ownerPhotos = photosData?.photos ?? {};

  if (agentLoading) return <main className="ocr-live-loading">Loading Leads CRM…</main>;
  if (agentError || !agentMe) return <LoginGate onSuccess={() => void refetchAgent()} />;

  const filterLabel = (key: MenuKey) => key === "sort" ? (sortMode === "newest" ? "Newest activity" : sortMode === "oldest" ? "Oldest activity" : "Newest lead") : key === "owner" ? (ownerFilter === "all" ? "All owners" : ownerFilter === "unassigned" ? "Unassigned" : ownerFilter) : key === "stage" ? (stageFilter === "all" ? "Any" : displayStage(stageFilter)) : period === "all" ? "All time" : period === "90d" ? "90 Days" : period === "30d" ? "30 Days" : "7 Days";
  const choose = (action: () => void) => { action(); setMenu(null); };
  const inactiveNotice = (label: string) => setNotice(`${label} is not part of the first Leads CRM release.`);

  const applyLeadDetailUpdate = (changes: Partial<Pick<LeadRow, "ownerName" | "phone">>) => {
    setDetailLead((current) => current ? { ...current, ...changes } : current);
    void utils.commandCenter.listIncomingLeads.invalidate();
  };

  return <div className="operations-crm-review leads-crm-live"><main className="ocr-workspace"><header className="ocr-header"><div className="ocr-page-title"><h1>Leads</h1><span><i />Live queue</span></div><div className="ocr-header-actions"><label className="ocr-live-lead-search"><Search size={16} /><input value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Search leads" aria-label="Search leads by name, phone, email, source, service, address, or owner" /></label><button type="button" aria-label="Lead notifications" className={rows.some((lead) => lead.hasUnread) ? "has-notification" : ""} onClick={() => setStageFilter("all")}><Bell size={18} /></button><button type="button" className="ocr-profile"><i>{initials(agentMe.name || "Agent")}</i><span>{agentMe.name || "Agent"}</span><ChevronDown size={14} /></button></div></header><section className="ocr-tabs" aria-label="CRM workspace tabs">{["Leads", "Deals", "Forecast"].map((tab) => <button type="button" key={tab} className={activeTab === tab ? "is-active" : ""} onClick={() => { if (tab === "Leads") setActiveTab(tab); else inactiveNotice(tab); }}>{tab}</button>)}</section><section className="ocr-toolbar" aria-label="Leads CRM toolbar"><div className="ocr-toolbar-filters"><FilterControl label="Sort by" value={filterLabel("sort")} isOpen={menu === "sort"} onClick={() => setMenu(menu === "sort" ? null : "sort")}><button type="button" onClick={() => choose(() => setSortMode("newest"))}>Newest activity</button><button type="button" onClick={() => choose(() => setSortMode("oldest"))}>Oldest activity</button><button type="button" onClick={() => choose(() => setSortMode("newest-created"))}>Newest lead</button></FilterControl><FilterControl label="Filter" value={filterLabel("owner")} isOpen={menu === "owner"} onClick={() => setMenu(menu === "owner" ? null : "owner")}><button type="button" onClick={() => choose(() => setOwnerFilter("all"))}>All owners</button><button type="button" onClick={() => choose(() => setOwnerFilter("unassigned"))}>Unassigned</button>{ownerNames.map((owner) => <button type="button" key={owner} onClick={() => choose(() => setOwnerFilter(owner))}>{owner}</button>)}</FilterControl><FilterControl label="Stage" value={filterLabel("stage")} isOpen={menu === "stage"} onClick={() => setMenu(menu === "stage" ? null : "stage")}><button type="button" onClick={() => choose(() => setStageFilter("all"))}>Any</button>{stageNames.map((stage) => <button type="button" key={stage} onClick={() => choose(() => setStageFilter(stage))}>{displayStage(stage)}</button>)}</FilterControl><FilterControl label="Last Activity" value={filterLabel("period")} isOpen={menu === "period"} onClick={() => setMenu(menu === "period" ? null : "period")}><button type="button" onClick={() => choose(() => setPeriod("all"))}>All time</button><button type="button" onClick={() => choose(() => setPeriod("90d"))}>90 days</button><button type="button" onClick={() => choose(() => setPeriod("30d"))}>30 days</button><button type="button" onClick={() => choose(() => setPeriod("7d"))}>7 days</button></FilterControl></div><div className="ocr-toolbar-actions"><button type="button" className="ocr-export" onClick={() => inactiveNotice("Export")}><Download size={16} />Export</button><button type="button" className="ocr-new-company" onClick={() => inactiveNotice("New Lead")}><Plus size={14} />New Lead</button></div></section><section className="ocr-table-shell" aria-label="Incoming lead table"><div className="ocr-table-scroll"><table className="ocr-table ocr-live-table"><thead><tr><th className="ocr-checkbox-column"><button type="button" className={`ocr-checkbox ${allSelected ? "is-selected" : ""}`} onClick={toggleAll} aria-label="Select all visible leads">{allSelected && "✓"}</button></th><th>Leads</th><th>Source &amp; Stage</th><th>Account owner</th><th>Messages</th><th>Pipeline value</th><th>Win probability</th><th>Activity trend</th><th>Last interaction</th><th aria-label="Actions" /></tr></thead><tbody>{leadsLoading ? <tr><td colSpan={10}><div className="ocr-live-empty">Loading incoming leads…</div></td></tr> : visibleRows.length === 0 ? <tr><td colSpan={10}><div className="ocr-live-empty"><Filter size={16} />No incoming leads match these filters or search.</div></td></tr> : visibleRows.map((lead) => { const name = lead.name || lead.phone; const source = humanize(lead.source); const stage = displayStage(lead.stage); const owner = lead.ownerName || "Unassigned"; const photo = lead.ownerName ? ownerPhotos[lead.ownerName] ?? null : null; const selectedRow = selected.includes(lead.id); return <tr key={lead.id} className={selectedRow ? "is-selected" : ""} onClick={() => setDetailLead(lead)}><td className="ocr-checkbox-column"><button type="button" className={`ocr-checkbox ${selectedRow ? "is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); toggleRow(lead.id); }} aria-label={`Select ${name}`}>{selectedRow && "✓"}</button></td><td className="ocr-company"><button type="button" onClick={() => setDetailLead(lead)}><img className="ocr-lead-portrait" src={customerPortraitFor(name)} alt={`Portrait illustration for ${name}`} /><span>{name}</span></button></td><td><div className="ocr-pill-group"><span className={`ocr-pill ocr-pill-${toneFor(source)}`}>{source}</span><span className={`ocr-pill ocr-pill-${toneFor(stage)}`}>{stage}</span></div></td><td><button type="button" className="ocr-owner" onClick={() => setDetailLead(lead)}>{photo ? <img className="ocr-owner-portrait" src={photo} alt={owner} /> : <i>{initials(owner)}</i>}<span>{owner}</span></button></td><td className="ocr-number">{lead.messageCount}</td><td className="ocr-money">{formatMoney(lead.quotedPrice)}</td><td><ProbabilityMeter value={DEFAULT_WIN_PROBABILITY} /></td><td><LeadActivityBars values={lead.activity} /></td><td><div className="ocr-interaction"><CalendarDays size={15} /><span>{formatDate(lead.lastActivityAt)}</span><i />{lead.hasUnread && <b className="ocr-live-unread">New reply</b>}{!lead.hasUnread && <strong>{lastActivityLabel(lead)}</strong>}</div></td><td><button type="button" className="ocr-overflow" aria-label={`Open ${name} details`} onClick={() => setDetailLead(lead)}><MoreHorizontal size={19} /></button></td></tr>; })}</tbody></table></div><footer className="ocr-calculation-footer"><div>{visibleRows.length} incoming lead{visibleRows.length === 1 ? "" : "s"} in view</div><div><Plus size={13} />Unread <strong>{visibleRows.filter((lead) => lead.hasUnread).length}</strong></div><div><Plus size={13} />Booked <strong>{visibleRows.filter((lead) => lead.isBooked).length}</strong></div><button type="button" onClick={() => inactiveNotice("Calculations")}><Plus size={13} />Add calculation</button></footer></section>{notice && <div className="ocr-live-notice" role="status">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={13} /></button></div>}</main>{detailLead && <LeadDetailDrawer lead={detailLead} ownerPhoto={detailLead.ownerName ? ownerPhotos[detailLead.ownerName] ?? null : null} canEdit={agentMe.isAdmin} agents={editorAgents} onLeadUpdated={applyLeadDetailUpdate} onClose={() => setDetailLead(null)} />}</div>;
}

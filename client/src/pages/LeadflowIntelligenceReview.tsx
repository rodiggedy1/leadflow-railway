import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import "./leadflow-intelligence-review.css";

type Stage = { name: string; value: number; color: string };
type Metric = [string, string];

const STAGE_COLORS = ["#607c5b", "#789a69", "#92b979", "#a9d187", "#c5f58a"];
const DEFAULT_MESSAGE = "Hi {{first_name}}, this is Madison from Maids in Black. Just following up on your cleaning request. Would you like help finding an available time?";
const fmt = (value: number) => value.toLocaleString("en-US");

function etDateDaysAgo(daysAgo: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
}
function sourceLabel(source: string | null | undefined) {
  return source === "thumbtack-sms" ? "Thumbtack" : source || "Direct";
}

export default function LeadflowIntelligenceReview() {
  const [selected, setSelected] = useState(2);
  const [period, setPeriod] = useState(30);
  const [channel, setChannel] = useState<"SMS" | "Email">("SMS");
  const [tab, setTab] = useState<"funnel" | "cohorts" | "campaigns">("funnel");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [status, setStatus] = useState("");

  const dateRange = useMemo(() => ({ dateFrom: etDateDaysAgo(Math.max(0, period - 1)), dateTo: etDateDaysAgo(0) }), [period]);
  const statsQuery = trpc.leads.stats.useQuery(dateRange, { refetchOnWindowFocus: false, refetchInterval: 60_000, staleTime: 30_000 });
  const stats = statsQuery.data;
  const total = Number(stats?.total ?? 0);
  const booked = Number(stats?.bookedCount ?? 0);
  const bookedRevenue = Number(stats?.bookedRevenue ?? 0);
  const contacted = Number(stats?.contactedCount ?? 0);
  const engaged = Number(stats?.engagedCount ?? 0);
  const quoted = Number(stats?.quotedCount ?? 0);

  const stages: Stage[] = useMemo(() => {
    return [
      ["New Leads", total], ["Contacted", contacted], ["Engaged", engaged], ["Quoted", quoted], ["Booked", booked],
    ].map(([name, value], index) => ({ name: name as string, value: Number(value), color: STAGE_COLORS[index] }));
  }, [booked, contacted, engaged, quoted, total]);

  const count = (index: number) => stages[index]?.value ?? 0;
  const conversion = (index: number) => index ? `${(total > 0 ? (count(index) / total) * 100 : 0).toFixed(1)}%` : "Entry";
  const activeStage = stages[selected] ?? stages[0];
  const exactConversion = total > 0 ? (booked / total) * 100 : 0;
  const metrics: Metric[] = [
    ["TOTAL LEADS", fmt(total)], ["BOOKINGS", fmt(booked)],
    ["FUNNEL CONVERSION", `${exactConversion.toFixed(1)}%`],
    ["BOOKED VALUE", `$${fmt(Math.round(bookedRevenue))}`],
  ];
  const audienceOptions = stages.map((stage, index) => ({ ...stage, index, count: stage.value }));
  const sampleLeads = (stats?.leadList ?? []).slice(0, 4);
  const selectTab = (nextTab: typeof tab) => { setTab(nextTab); setStatus(""); };
  const reset = () => { setSelected(2); setPeriod(30); setChannel("SMS"); setTab("funnel"); setMessage(DEFAULT_MESSAGE); setStatus(""); };
  const rewrite = () => { setMessage("Hi {{first_name}}! Madison from Maids in Black here. Your cleaning request is still on our radar. Would you like me to find an appointment that works for you?"); setStatus("Suggested rewrite added for your review."); };
  const openCanonicalCampaigns = () => {
    if (channel !== "SMS") { setStatus("Email campaigns are not enabled by this workspace. Select SMS to use the existing approved campaign flow."); return; }
    if (!message.trim()) { setStatus("Enter a message first."); return; }
    setStatus("Opening the canonical SMS Campaigns workspace. The selected funnel stage and this draft message are not transferred automatically; review and build the audience there before saving.");
    window.location.assign("/admin/sms-campaigns");
  };

  return (
    <div className="leadflow-intelligence-review">
      <header className="lir-header"><div><h1>▣ LeadFlow <span className="lir-muted">/ Intelligence</span></h1><small>Revenue Operations Command Center</small></div><div className="lir-flex lir-header-controls"><select aria-label="Reporting period" value={period} onChange={(event) => setPeriod(Number(event.target.value))}><option value={30}>Last 30 days</option><option value={7}>Last 7 days</option><option value={90}>Last 90 days</option></select><button type="button" onClick={reset}>↻ Reset</button><button type="button" onClick={() => document.documentElement.requestFullscreen?.()}>⛶ Fullscreen</button></div></header>
      <nav className="lir-tabs" aria-label="Intelligence sections">{([["funnel", "◈ Funnel Intelligence"], ["cohorts", "◎ Cohort Explorer"], ["campaigns", "↗ Campaigns"]] as const).map(([value, label]) => <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => selectTab(value)}>{label}</button>)}</nav>
      <main className="lir-main">
        <div className="lir-metrics">{metrics.map(([label, value]) => <div className="lir-panel" key={label}><small>{label}</small><div className="lir-metric">{statsQuery.isLoading ? "—" : value}</div>{label === "FUNNEL CONVERSION" && <small className="lir-green">Lead → confirmed</small>}</div>)}</div>
        {tab === "funnel" && <section>{statsQuery.isError ? <div className="lir-panel lir-status" role="alert"><b>Live lead data is unavailable.</b><br />The analytics request failed, so the funnel is not showing zeroes as if that were real data.<br /><button type="button" onClick={() => statsQuery.refetch()}>Retry</button></div> : <div className="lir-layout"><div className="lir-panel lir-funnel-panel"><div className="lir-flex"><div><h2>Live conversion funnel</h2><small>Click any stage to select its audience</small></div><span className="lir-green">● Live data</span></div><svg className="lir-funnel" viewBox="0 0 700 620" role="img" aria-label="Interactive lead conversion funnel">{stages.map((stage, index) => { const width = 570 - index * 75; const y = 20 + index * 97; const x = (700 - width) / 2; const nextWidth = 570 - (index + 1) * 75; const nextX = (700 - nextWidth) / 2; const points = index === stages.length - 1 ? `${x},${y} ${x + width},${y} ${x + width - 20},${y + 81} ${x + 20},${y + 81}` : `${x},${y} ${x + width},${y} ${nextX + nextWidth},${y + 81} ${nextX},${y + 81}`; const isSelected = index === selected; return <g className={`lir-stage ${isSelected ? "selected" : ""}`} key={stage.name} onClick={() => setSelected(index)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelected(index); }}><polygon points={points} fill={stage.color} stroke={isSelected ? "#f2ffd9" : "#90b881"} strokeWidth={isSelected ? 3 : 1} /><text x="350" y={y + 32} textAnchor="middle" fontSize="16" fontWeight="700" fill="#182519">{stage.name.toUpperCase()}</text><text x="350" y={y + 62} textAnchor="middle" fontSize="28" fontWeight="800" fill="#182519">{fmt(count(index))}</text>{index > 0 && <><rect x="572" y={y - 15} width="115" height="29" rx="14" fill="#243226" stroke="#4a6548" /><text x="629" y={y + 4} textAnchor="middle" fill="#c5f58a" fontSize="14">{conversion(index)} ↓</text></>}</g>; })}</svg></div>
        <div className="lir-panel lir-inspector"><small>ACTIVE COHORT · 0{selected + 1}/05</small><h2>{activeStage?.name ?? "—"}</h2><div className="lir-metric">{fmt(count(selected))} <small>leads</small></div><div className="lir-row lir-flex"><span className="lir-muted">Share of new leads</span><b className="lir-green">{conversion(selected)}</b></div><div className="lir-row lir-flex"><span className="lir-muted">Share of all leads</span><b>{total ? ((100 * count(selected)) / total).toFixed(1) : "0.0"}%</b></div><div className="lir-row lir-flex"><span className="lir-muted">Drop-off from previous</span><b>{selected ? fmt(Math.max(0, count(selected - 1) - count(selected))) : "—"}</b></div><div className="lir-btnrow"><button type="button" className="primary" onClick={() => selectTab("campaigns")}>✉ Message cohort ↗</button><button type="button" onClick={() => selectTab("cohorts")}>Explore cohorts</button></div><h3 className="lir-activity-title">Recent lead activity</h3>{sampleLeads.map((lead, index) => <div className="lir-row lir-flex" key={`${lead.leadName}-${lead.leadPhone}`}><span>{lead.leadName ?? "Unknown"}<br /><small>{lead.isBooked ? "Booked" : "Lead"} · {index + 1} recent</small></span><button type="button" onClick={() => selectTab("campaigns")}>↗</button></div>)}{sampleLeads.length === 0 && <small className="lir-muted">No leads in this reporting window.</small>}</div></div>}</section>}
        {tab === "cohorts" && <section className="lir-section"><h2>Cohort Explorer</h2><p className="lir-muted">Choose any cohort to start a targeted campaign.</p><div className="lir-cohorts">{audienceOptions.map((stage) => <button type="button" className="lir-panel lir-cohort" key={stage.name} onClick={() => { setSelected(stage.index); selectTab("campaigns"); }}><small>STAGE 0{stage.index + 1}</small><h3>{stage.name}</h3><div className="lir-metric">{fmt(stage.count)}</div><small>Share of new leads: {conversion(stage.index)}</small><p className="lir-green">Message cohort ↗</p></button>)}</div></section>}
        {tab === "campaigns" && <section className="lir-section"><h2>Campaign Studio</h2><div className="lir-panel lir-campaign-panel"><h3>New outreach campaign</h3><small>Uses the existing LeadFlow SMS Campaigns workflow</small><label htmlFor="lir-audience">Target audience</label><select id="lir-audience" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{audienceOptions.map((stage) => <option value={stage.index} key={stage.name}>{stage.name} · {fmt(stage.count)} leads</option>)}</select><p className="lir-green">{fmt(count(selected))} leads in selected funnel stage</p><label>Channel</label><div className="lir-btnrow">{(["SMS", "Email"] as const).map((value) => <button type="button" className={channel === value ? "active" : ""} key={value} onClick={() => setChannel(value)}>{value}</button>)}</div><label htmlFor="lir-message">Message</label><textarea id="lir-message" value={message} onChange={(event) => setMessage(event.target.value)} /><div className="lir-btnrow"><button type="button" onClick={rewrite}>✦ AI rewrite preview</button><button type="button" onClick={() => setStatus(`Live reporting window: ${dateRange.dateFrom} through ${dateRange.dateTo}. The canonical SMS workspace performs consent, opt-out, duplicate, and recent-contact checks.`)}>Preview audience</button><button type="button" className="primary" onClick={openCanonicalCampaigns}>Open SMS Campaigns ↗</button></div>{status && <div className="lir-status" role="status">{status}</div>}<label>Message preview</label><div className="lir-panel lir-message-preview">{message}</div></div></section>}
      </main>
    </div>
  );
}

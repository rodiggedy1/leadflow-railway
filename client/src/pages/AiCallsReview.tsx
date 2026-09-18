import { useMemo, useState } from "react";
import { Bell, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, FileText, Filter, Headphones, MessageSquareText, Mic, Phone, PhoneIncoming, PlayCircle, RefreshCw, Search, Sparkles, UserRound } from "lucide-react";
import "./voice-workspaces-review.css";
import "./ai-calls-command-deck.css";

type Outcome = "callback_requested" | "quote_given" | "faq_answered" | "booked" | "transferred" | "missed" | "no_action";
type Callback = { id: number; caller: string; phone: string; outcome: Outcome; preferredTime: string; duration: string; created: string; notes?: string; summary: string; transcript?: string; completed?: boolean };
type VoiceCall = { id: number; caller: string; phone: string; outcome: Outcome; duration: string; date: string; period: "today" | "week" | "month"; success?: boolean; endedReason: string; summary: string; transcript?: string; hasRecording?: boolean };

const LABELS: Record<Outcome, string> = { callback_requested: "Callback requested", quote_given: "Quote given", faq_answered: "FAQ answered", booked: "Booked", transferred: "Transferred", missed: "Missed", no_action: "No action" };
const CALLBACKS: Callback[] = [
  { id: 1, caller: "Jordan Lee", phone: "(202) 555-0147", outcome: "callback_requested", preferredTime: "Today · 2:00–4:00 PM", duration: "2:18", created: "Today · 10:42 AM", notes: "Asked for a quick call after a meeting. Interested in recurring home service.", summary: "Caller asked to discuss availability and a recurring schedule before deciding on next steps.", transcript: "Caller: I am between meetings right now. Could someone call me later this afternoon?\nAgent: Absolutely. What time works best for you?\nCaller: Sometime between two and four would be great." },
  { id: 2, caller: "Avery Morgan", phone: "(301) 555-0173", outcome: "quote_given", preferredTime: "Today · after 5:30 PM", duration: "4:06", created: "Today · 9:18 AM", notes: "Wants to compare the quote with a partner before booking.", summary: "Quote was discussed. Caller requested a follow-up after work to confirm timing." },
  { id: 3, caller: "Casey Rivera", phone: "(703) 555-0129", outcome: "faq_answered", preferredTime: "Tomorrow · 10:00–11:00 AM", duration: "3:41", created: "Yesterday · 4:26 PM", summary: "Caller received service-area answers and requested a morning check-in before submitting a request.", transcript: "Caller: Do you service my neighborhood?\nAgent: We can confirm availability by area.\nCaller: Great, please call tomorrow morning so I can coordinate at home." },
  { id: 4, caller: "Taylor Brooks", phone: "(240) 555-0195", outcome: "booked", preferredTime: "Tomorrow · 12:00–1:00 PM", duration: "5:12", created: "Yesterday · 1:08 PM", notes: "Requested a quick follow-up regarding an optional service add-on.", summary: "A booking request is noted in this static preview. The follow-up is about an additional service question.", completed: true },
];
const CALLS: VoiceCall[] = [
  { id: 11, caller: "Jordan Lee", phone: "(202) 555-0147", outcome: "callback_requested", duration: "2:18", date: "Today · 10:42 AM", period: "today", endedReason: "caller requested follow-up", summary: "Caller asked to be contacted after a meeting to discuss recurring home-service availability.", transcript: "Caller: I need to jump into a meeting.\nAgent: No problem. When should we call you back?\nCaller: Later this afternoon would work best.", hasRecording: true },
  { id: 12, caller: "Avery Morgan", phone: "(301) 555-0173", outcome: "quote_given", success: true, duration: "4:06", date: "Today · 9:18 AM", period: "today", endedReason: "call completed", summary: "Discussed a sample quote range and next steps. Caller requested time to review before confirming.", hasRecording: true },
  { id: 13, caller: "Casey Rivera", phone: "(703) 555-0129", outcome: "faq_answered", success: true, duration: "3:41", date: "Yesterday · 4:26 PM", period: "week", endedReason: "call completed", summary: "Answered coverage and scheduling questions. Caller asked for a follow-up window the next morning.", transcript: "Caller: Do you service my neighborhood?\nAgent: We can confirm availability by area.\nCaller: Great, please call tomorrow morning so I can coordinate at home.", hasRecording: true },
  { id: 14, caller: "Taylor Brooks", phone: "(240) 555-0195", outcome: "booked", success: true, duration: "5:12", date: "Yesterday · 1:08 PM", period: "week", endedReason: "call completed", summary: "The sample call concluded with a requested service appointment and a question about an optional add-on.", hasRecording: true },
  { id: 15, caller: "Morgan Price", phone: "(202) 555-0156", outcome: "transferred", duration: "1:55", date: "Sep 11 · 3:34 PM", period: "week", endedReason: "transferred to team", summary: "Caller asked for a team member to review a service detail directly.", hasRecording: true },
  { id: 16, caller: "Riley Chen", phone: "(571) 555-0188", outcome: "missed", duration: "0:00", date: "Sep 10 · 11:07 AM", period: "week", endedReason: "no answer", summary: "The sample inbound call was not completed. No follow-up action exists in this review.", hasRecording: false },
  { id: 17, caller: "Drew Parker", phone: "(301) 555-0122", outcome: "no_action", duration: "0:48", date: "Sep 6 · 9:22 AM", period: "month", endedReason: "call completed", summary: "Caller received general information and did not request a subsequent action.", hasRecording: true },
  { id: 18, caller: "Jamie Flores", phone: "(703) 555-0164", outcome: "quote_given", duration: "3:26", date: "Aug 29 · 2:41 PM", period: "month", endedReason: "call completed", summary: "A sample quote conversation ended with the caller deciding to compare service timing.", hasRecording: true },
];

const CALLER_PORTRAITS: Record<string, string> = {
  "Jordan Lee": "/manus-storage/leads-crm-owner-james-taylor_6fac06b4.png",
  "Avery Morgan": "/manus-storage/leads-crm-owner-kate-chen_1285ffcf.png",
  "Casey Rivera": "/manus-storage/leads-crm-owner-hannah-mills_c84fd53e.png",
  "Taylor Brooks": "/manus-storage/leads-crm-owner-mark-darnalds_cf661d0b.png",
  "Morgan Price": "/manus-storage/leads-crm-owner-emma-green_55d28723.png",
  "Riley Chen": "/manus-storage/leads-crm-owner-alex-santos_8f730ad0.png",
  "Drew Parker": "/manus-storage/leads-crm-owner-oliver-chan_8454e8e9.png",
  "Jamie Flores": "/manus-storage/leads-crm-owner-sarah-nguyen_2fbb7d63.png",
};

function CallerPortrait({ caller, className }: { caller: string; className: string }) {
  return <img className={className} src={CALLER_PORTRAITS[caller]} alt={`Static review portrait for ${caller}`} />;
}

function StaticWaveform({ label = "Static recording" }: { label?: string }) {
  return <div className="voice-brief-evidence"><span><PlayCircle size={18} />{label}</span><div className="voice-brief-waveform">{Array.from({ length: 19 }, (_, index) => <i key={index} />)}</div><small>Playback unavailable in review</small></div>;
}

function urgencyLabel(item: Callback) {
  return item.preferredTime.startsWith("Today") ? "Today" : "Next window";
}

export default function AiCallsReview() {
  const [view, setView] = useState<"callbacks" | "all">("callbacks");
  const [callbacks, setCallbacks] = useState(CALLBACKS);
  const [showCompleted, setShowCompleted] = useState(false);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<"Today" | "Last 7 days" | "Last 30 days" | "All time">("Last 30 days");
  const [outcome, setOutcome] = useState<Outcome | "all">("all");
  const [page, setPage] = useState(0);
  const [openTranscript, setOpenTranscript] = useState<number | null>(null);
  const [selectedCallbackId, setSelectedCallbackId] = useState(CALLBACKS[0].id);
  const [notice, setNotice] = useState("Static review workspace · no calls, callbacks, recordings, or transcripts are connected");

  const pending = callbacks.filter((item) => !item.completed).length;
  const callbackItems = useMemo(() => callbacks.filter((item) => {
    const query = search.trim().toLowerCase();
    return (showCompleted || !item.completed) && (!query || [item.caller, item.phone, item.summary, item.notes].filter(Boolean).join(" ").toLowerCase().includes(query));
  }), [callbacks, search, showCompleted]);
  const rankedCallbacks = useMemo(() => [...callbackItems].sort((a, b) => Number(b.preferredTime.startsWith("Today")) - Number(a.preferredTime.startsWith("Today")) || Number(Boolean(b.notes)) - Number(Boolean(a.notes))), [callbackItems]);
  const selectedCallback = rankedCallbacks.find((item) => item.id === selectedCallbackId) ?? rankedCallbacks[0] ?? null;
  const callItems = useMemo(() => CALLS.filter((item) => {
    const periodMatch = period === "All time" || (period === "Today" && item.period === "today") || (period === "Last 7 days" && ["today", "week"].includes(item.period)) || (period === "Last 30 days" && ["today", "week", "month"].includes(item.period));
    const query = search.trim().toLowerCase();
    return periodMatch && (outcome === "all" || item.outcome === outcome) && (!query || [item.caller, item.phone, item.summary, item.outcome].join(" ").toLowerCase().includes(query));
  }), [outcome, period, search]);
  const pages = Math.max(1, Math.ceil(callItems.length / 4));
  const activePage = Math.min(page, pages - 1);
  const displayCalls = callItems.slice(activePage * 4, activePage * 4 + 4);

  const markDone = (id: number) => {
    const selected = callbacks.find((item) => item.id === id);
    if (!selected) return;
    setCallbacks((items) => items.map((item) => item.id === id ? { ...item, completed: true } : item));
    setNotice(`${selected.caller} was marked complete in this static preview only. No callback record changed.`);
  };
  const changeView = (next: "callbacks" | "all") => {
    setView(next);
    setOpenTranscript(null);
    setNotice(`${next === "callbacks" ? "Callbacks" : "All Calls"} is shown with static review examples only.`);
  };

  return <main className="voice-review" data-review-only="true">
    <header className="voice-utility"><label className="voice-search"><Search size={17} /><input aria-label="Search static AI calls" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search AI calls…" /><kbd>⌘ K</kbd></label><div><button type="button" className="voice-utility-bell" aria-label="Static AI call notifications" onClick={() => setNotice("Static preview only — notifications are not connected.")}><Bell size={18} /><i /></button><span className="voice-owner">RG</span></div></header>
    <div className="voice-content voice-content--calls">
      <section className="voice-page-head"><div><span className="voice-eyebrow">Voice operations · Static preview</span><h1><Mic size={27} />AI Calls</h1><p>One workspace for callback requests and AI-handled call history—built for fast review without splitting the voice workflow.</p></div><button type="button" className="voice-refresh" onClick={() => setNotice("Static preview refreshed. No live call data was requested.")}><RefreshCw size={15} />Refresh</button></section>
      <p className="voice-page-status voice-page-status--wide"><Sparkles size={14} />{notice}</p>
      <nav className="voice-segmented" aria-label="Static AI Calls views"><button type="button" className={view === "callbacks" ? "is-active" : ""} onClick={() => changeView("callbacks")}><PhoneIncoming size={15} />Callbacks <b>{pending}</b></button><button type="button" className={view === "all" ? "is-active" : ""} onClick={() => changeView("all")}><Headphones size={15} />All Calls <b>{CALLS.length}</b></button></nav>

      {view === "callbacks" ? <>
        <section className="voice-command-metrics" aria-label="Static callback triage metrics">
          <article className="is-attention"><span>Due now</span><div className="voice-command-metric-value"><strong>{pending}</strong><small>Callbacks needing a decision</small></div></article>
          <article className="is-amber"><span>Today</span><div className="voice-command-metric-value"><strong>{callbacks.filter((item) => !item.completed && item.preferredTime.startsWith("Today")).length}</strong><small>Preferred time windows</small></div></article>
          <article className="is-blue"><span>Human context</span><div className="voice-command-metric-value"><strong>{callbacks.filter((item) => !item.completed && item.notes).length}</strong><small>With agent notes</small></div></article>
          <article className="is-mint"><span>Completed</span><div className="voice-command-metric-value"><strong>{callbacks.filter((item) => item.completed).length}</strong><small>Static examples resolved</small></div></article>
        </section>
        <section className="voice-command-deck" aria-label="Static callback command deck">
          <aside className="voice-callback-queue">
            <header><div><span className="voice-eyebrow">Ranked callback queue</span><h2>Decide what happens next</h2><small className="voice-queue-active-count">{rankedCallbacks.length} active callbacks</small></div><label className="voice-completed-toggle"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} /><span>Completed</span></label></header>
            {rankedCallbacks.length === 0 ? <div className="voice-empty"><PhoneIncoming size={28} /><strong>No callback examples match this view</strong><p>Clear the local search or include completed examples.</p></div> : <div className="voice-queue-list">{rankedCallbacks.map((item, index) => <button type="button" key={item.id} onClick={() => { setSelectedCallbackId(item.id); setOpenTranscript(null); }} className={`voice-queue-row voice-queue-row--${item.outcome} ${selectedCallback?.id === item.id ? "is-selected" : ""} ${item.completed ? "is-completed" : ""}`}><span className="voice-queue-rank">0{index + 1}</span><CallerPortrait caller={item.caller} className="voice-caller-portrait voice-caller-portrait--queue" /><span className="voice-queue-copy"><strong>{item.caller}</strong><small>{item.summary}</small><em><Clock3 size={11} />{item.preferredTime}</em></span><span className="voice-queue-signal"><b>{urgencyLabel(item)}</b><i className={`voice-outcome voice-outcome--${item.outcome}`}>{LABELS[item.outcome]}</i></span></button>)}</div>}
          </aside>
          {selectedCallback ? <article className={`voice-call-brief voice-call-brief--${selectedCallback.outcome}`}>
            <header className="voice-brief-head"><div className="voice-brief-person"><CallerPortrait caller={selectedCallback.caller} className="voice-caller-portrait voice-caller-portrait--brief" /><div><span className="voice-eyebrow">Selected call brief</span><h2>{selectedCallback.caller}</h2><p>{selectedCallback.phone} <i /> {selectedCallback.duration} conversation</p></div></div><div className="voice-brief-status"><em className={`voice-outcome voice-outcome--${selectedCallback.outcome}`}>{LABELS[selectedCallback.outcome]}</em><strong><Clock3 size={14} />{selectedCallback.preferredTime}</strong></div></header>
            <div className="voice-brief-body"><section className="voice-brief-intent"><div><span>Caller intent</span><p>{selectedCallback.summary}</p></div><div><span>Agent context</span><p>{selectedCallback.notes ?? "No static agent note attached to this callback."}</p></div></section><StaticWaveform label="Conversation evidence" /></div>
            <section className="voice-brief-decision"><div className="voice-brief-decision-copy"><span>Recommended next step</span><strong>{selectedCallback.outcome === "quote_given" ? "Follow up after the quoted review window" : selectedCallback.outcome === "faq_answered" ? "Confirm the preferred morning check-in" : "Call within the caller’s preferred window"}</strong></div><div className="voice-brief-decision-actions"><button type="button" className="voice-deck-action" onClick={() => setNotice(`Calling ${selectedCallback.caller} is review-only in this preview.`)}><Phone size={14} />Call window</button><button type="button" className="voice-deck-action" onClick={() => setNotice(`Follow-up preparation for ${selectedCallback.caller} is review-only in this preview.`)}><MessageSquareText size={14} />Prepare follow-up</button>{!selectedCallback.completed && <button type="button" className="voice-deck-action is-primary" onClick={() => markDone(selectedCallback.id)}><CheckCircle2 size={14} />Mark resolved</button>}</div></section>
            <footer className="voice-brief-foot">{selectedCallback.transcript ? <button type="button" className="voice-transcript-toggle" aria-expanded={openTranscript === selectedCallback.id} onClick={() => setOpenTranscript((open) => open === selectedCallback.id ? null : selectedCallback.id)}><FileText size={14} />{openTranscript === selectedCallback.id ? "Hide transcript" : "Open transcript evidence"}{openTranscript === selectedCallback.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button> : <span><Headphones size={14} />No static transcript attached</span>}<span>{selectedCallback.created}</span></footer>
            {openTranscript === selectedCallback.id && selectedCallback.transcript && <pre className="voice-transcript">{selectedCallback.transcript}</pre>}
          </article> : <div className="voice-empty voice-review-surface"><PhoneIncoming size={28} /><strong>Select a static callback</strong><p>Choose a queue item to review its call brief.</p></div>}
        </section>
      </> : <>
        <section className="voice-calls-toolbar voice-review-surface"><div className="voice-periods" aria-label="Static date filters">{(["Today", "Last 7 days", "Last 30 days", "All time"] as const).map((item) => <button type="button" key={item} className={period === item ? "is-active" : ""} onClick={() => { setPeriod(item); setPage(0); setNotice(`${item} is selected locally. This review view does not load call history.`); }}>{item}</button>)}</div><label className="voice-outcome-filter"><Filter size={14} /><span>Outcome</span><select aria-label="Filter static AI call outcomes" value={outcome} onChange={(event) => { setOutcome(event.target.value as Outcome | "all"); setPage(0); setNotice(`${event.target.value === "all" ? "All outcomes" : LABELS[event.target.value as Outcome]} is selected locally. No call record changed.`); }}><option value="all">All outcomes</option>{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={14} /></label></section>
        <section className="voice-call-history voice-call-history--timeline" aria-label="Static AI call history">{displayCalls.length === 0 ? <div className="voice-empty voice-review-surface"><Mic size={28} /><strong>No static calls match these filters</strong><p>Try a wider local date range or select a different outcome.</p></div> : displayCalls.map((item) => <article className={`voice-review-surface voice-history-card voice-history-card--timeline voice-history-card--${item.outcome}`} key={item.id}><div className="voice-history-rail"><span /><small>{item.period === "today" ? "Today" : item.period === "week" ? "This week" : "Earlier"}</small></div><div className="voice-history-head"><CallerPortrait caller={item.caller} className="voice-caller-portrait voice-caller-portrait--history" /><div><div className="voice-history-title"><strong>{item.caller}</strong><span>{item.phone}</span><em className={`voice-outcome voice-outcome--${item.outcome}`}>{LABELS[item.outcome]}</em>{item.success && <em className="voice-evaluation is-success">Successful</em>}</div><p><Clock3 size={13} />{item.date}<i /><Phone size={13} />{item.duration}<i />{item.endedReason}</p></div></div><p className="voice-history-summary"><Sparkles size={14} />{item.summary}</p>{item.hasRecording ? <StaticWaveform /> : <p className="voice-no-recording"><Headphones size={15} />No static recording available</p>}{item.transcript && <div className="voice-history-foot"><button type="button" className="voice-transcript-toggle" aria-expanded={openTranscript === item.id} onClick={() => setOpenTranscript((open) => open === item.id ? null : item.id)}><FileText size={14} />{openTranscript === item.id ? "Hide transcript" : "View transcript"}{openTranscript === item.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button><span>Static AI call example</span></div>}{openTranscript === item.id && item.transcript && <pre className="voice-transcript">{item.transcript}</pre>}</article>)}</section>
        {callItems.length > 4 && <nav className="voice-pagination" aria-label="Static AI call history pages"><button type="button" disabled={activePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft size={16} />Previous</button><span>Page {activePage + 1} of {pages}</span><button type="button" disabled={activePage >= pages - 1} onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}>Next<ChevronRight size={16} /></button></nav>}
      </>}
    </div>
  </main>;
}

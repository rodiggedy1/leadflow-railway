import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownLeft, ArrowRight, AudioLines, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, FileText, History, Menu, MessageSquare, Mic, MoreHorizontal, Pause, PhoneCall, Play, Search, Settings2, ShieldCheck, Users, Workflow, X } from "lucide-react";
import type { AiCallerSession, AiCallerStart } from "../hooks/useAiCallerSession";
import { normalizeDialPhone } from "../../../server/utils/phone";
import { matchesCallerContactSearch, normalizeContactSearchQuery } from "../../../shared/aiCallerContactSearch";
import { formatAiCallerError } from "../../../shared/aiCallerErrors";
import "./ai-caller-workspace.css";

export type CallerContact = {
  id: string; name: string; initials: string; phone: string | null;
  type: "Customer" | "Lead" | "Team"; location: string;
  leadflowJobId: number | null; jobDate: string;
  scripts: { label: string; text: string }[];
};
export type CallerRecord = {
  id: string; person: CallerContact; reason: string; outcome: string;
  durationSeconds: number | null; time: string | null;
  transcript: string | null; summary: string | null; recordingUrl: string | null;
};
export type AiCallerWorkspaceProps = {
  review: boolean; contacts: CallerContact[]; recent: CallerRecord[];
  session: AiCallerSession | null; onStartCall: (params: AiCallerStart) => Promise<void>;
  onDismissSession: () => void; onRefresh?: () => void;
  businessDate?: string; onConfigure?: () => void;
  loading?: boolean; error?: string | null; historyLoading?: boolean; historyError?: string | null;
  onSearchChange?: (query: string) => void;
  searchResults?: { query: string; contacts: CallerContact[]; loading: boolean; error?: string | null };
};
const bars = [9,16,24,12,30,40,19,32,46,28,16,36,52,32,22,44,28,38,18,31,49,26,17,39,54,35,23,43,28,19,34,47,30,18,37,24,42,27,14,29,19,12,23,10];
function Avatar({ person, small = false }: { person: CallerContact; small?: boolean }) { return <span className={`avatar ${small ? "small" : ""}`} aria-hidden="true">{person.initials}</span>; }
function Step({ number, title, subtitle, children }: { number: number; title: string; subtitle: string; children: ReactNode }) {
  return <section className="step"><div className="step-heading"><span className="step-number">{number}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div><div className="step-content">{children}</div></section>;
}
function formatDuration(value: number | null | undefined) { return value == null ? "—" : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`; }
function statusLabel(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()); }
// Speaker recognition copied from the existing AI Calls transcript workspace.
function transcriptTurns(value: string | null | undefined) {
  return (value ?? "").split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => {
    const match = line.match(/^([^:]{1,42}):\s*(.+)$/);
    if (!match) return { speaker: "Recorded transcript", text: line, ai: false };
    const ai = /^(ava|madison|assistant|ai|ai assistant)$/i.test(match[1].trim());
    return { speaker: ai ? "AI assistant" : match[1].trim(), text: match[2].trim(), ai };
  });
}

/** The approved three-step review layout; only data/actions vary between adapters. */
export function AiCallerWorkspace({ review, contacts, recent, session, onStartCall, onDismissSession, onRefresh, businessDate, onConfigure, loading, error, historyLoading, historyError, onSearchChange, searchResults }: AiCallerWorkspaceProps) {
  const [contactId, setContactId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<CallerContact | null>(null);
  const [manualPhone, setManualPhone] = useState("");
  const [useTypedNumber, setUseTypedNumber] = useState(false);
  const [today] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState(false);
  const [preset, setPreset] = useState(0);
  const [instructions, setInstructions] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState("Make a call");
  const [playing, setPlaying] = useState(false);
  const [confirmation, setConfirmation] = useState<AiCallerStart | null>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const normalizedPhone = normalizeDialPhone(manualPhone);
  const contact: CallerContact | null = useTypedNumber ? {
    id: "entered-number", name: normalizedPhone ?? "Entered number", initials: "PN",
    phone: normalizedPhone, type: "Customer", location: "Typed number",
    leadflowJobId: null, jobDate: businessDate ?? today, scripts: [],
  } : contacts.find(item => item.id === contactId) ?? (selectedContact?.id === contactId ? selectedContact : null);
  const locked = session?.phase === "active";
  useEffect(() => {
    if (!useTypedNumber && contactId === null && contacts.length) {
      setContactId(contacts[0].id);
      setInstructions(current => current || contacts[0].scripts[0]?.text || "");
    }
  }, [contacts, contactId, useTypedNumber]);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
  function notify(message: string) { setNotice(message); if (noticeTimer.current) clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(""), 4500); }
  function navigate(label: string) {
    setMobileNav(false);
    if (label === "Make a call") { setActiveNav(label); document.getElementById("composer")?.scrollIntoView({ behavior: "smooth" }); }
    else if (label === "Call history") { setActiveNav(label); document.getElementById("recent-calls")?.scrollIntoView({ behavior: "smooth" }); }
    else if (label === "Contacts") { setPicker(true); document.getElementById("composer")?.scrollIntoView({ behavior: "smooth" }); }
    else if (onConfigure) onConfigure();
    else notify("Call flows and provider settings remain in the existing AI call configuration.");
  }
  function chooseContact(person: CallerContact) {
    if (locked) return;
    setUseTypedNumber(false); setManualPhone("");
    setContactId(person.id); setSelectedContact(person); setPreset(0);
    setInstructions(current => person.scripts[0]?.text ?? (current === contact?.scripts[preset]?.text ? "" : current));
    setPicker(false); changeSearch("");
  }
  function changeSearch(value: string) {
    setSearch(value); onSearchChange?.(normalizeContactSearchQuery(value));
  }
  function closePicker() {
    setPicker(false); changeSearch("");
  }
  function typePhone(value: string) {
    if (locked) return;
    if (!useTypedNumber && instructions === contact?.scripts[preset]?.text) setInstructions("");
    setUseTypedNumber(true); setManualPhone(value); setContactId(null); setSelectedContact(null); setPreset(0); closePicker();
  }
  function requestCall() {
    if (!contact?.phone || instructions.trim().length < 10 || session !== null) return;
    const payload: AiCallerStart = {
      leadflowJobId: contact.leadflowJobId, jobDate: contact.jobDate,
      personName: contact.name, phone: contact.phone,
      scenario: contact.scripts[preset]?.label ?? "Custom instructions",
      script: instructions.trim(), audience: contact.type === "Team" ? "cleaner" : "customer", language: "en",
    };
    setConfirmation(payload);
    confirm.current?.showModal();
  }
  async function confirmCall() {
    if (!confirmation || session !== null) return;
    confirm.current?.close();
    const payload = confirmation;
    setConfirmation(null); setSelectedRecordId(null);
    try { await onStartCall(payload); }
    catch (error) { notify(formatAiCallerError(error)); }
  }
  const record = recent.find(item => item.id === selectedRecordId) ?? recent[0] ?? null;
  const previewPerson = session ? { name: session.customerName, phone: session.phone, initials: session.customerName.split(" ").map(part => part[0]).join("").slice(0,2) } : record?.person;
  const previewReason = session?.scenario ?? record?.reason ?? "No call selected";
  const transcript = transcriptTurns(session ? session.outcome?.transcript : record?.transcript);
  const recordingUrl = session ? session.outcome?.recordingUrl : record?.recordingUrl;
  const outcome = session?.status ?? record?.outcome ?? "Ready";
  const summary = session ? session.outcome?.error ?? session.outcome?.summary : record?.summary;
  const duration = session ? session.outcome?.durationSeconds : record?.durationSeconds;
  const query = normalizeContactSearchQuery(search);
  const localMatches = contacts.filter(person => matchesCallerContactSearch(person, query));
  const currentSearch = query && searchResults?.query === query ? searchResults : null;
  const searchLoading = !!query && !!onSearchChange && (!currentSearch || currentSearch.loading);
  const seenContacts = new Set<string>();
  const filteredContacts = [...localMatches, ...(currentSearch?.contacts ?? [])].filter(person => {
    const key = `${person.type}:${normalizeDialPhone(person.phone ?? "") ?? person.id}`;
    if (seenContacts.has(key)) return false;
    seenContacts.add(key); return true;
  });
  useEffect(() => { audio.current?.pause(); setPlaying(false); }, [recordingUrl, session?.vapiCallId, selectedRecordId]);
  function togglePlayback() {
    if (!audio.current || !recordingUrl) return;
    if (audio.current.paused) void audio.current.play().catch(() => notify("Recording playback could not start."));
    else audio.current.pause();
  }

  return <div className="ai-caller-workspace"><div className="app-shell">
    {mobileNav && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? "nav-open" : ""}`}>
      <div className="brand"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><strong>Baseboard</strong><button className="icon-button close-nav" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace-switch"><div className="workspace-icon">M</div><div><strong>Maids in Black</strong><span>LeadFlow workspace</span></div><ChevronDown size={15}/></div>
      <div className="nav-heading">AI CALLER</div>
      <nav aria-label="AI caller navigation">{[[PhoneCall, "Make a call"], [History, "Call history"], [Users, "Contacts"], [Workflow, "Call flows"]].map(([Icon, label]) => { const NavIcon = Icon as typeof PhoneCall; const text = label as string; return <button key={text} className={activeNav === text ? "active" : ""} onClick={() => navigate(text)} aria-current={activeNav === text ? "page" : undefined}><NavIcon size={17}/><span>{text}</span>{text === "Make a call" && <ChevronRight size={14}/>}</button>; })}</nav>
      <div className="sidebar-bottom"><div className="review-note"><ShieldCheck size={18}/><div><strong>{review ? "Review setup" : "Existing AI call engine"}</strong><p>{review ? <>Sample data only.<br/>No real calls are connected.</> : <>Existing call provider.<br/>Explicit confirmation required.</>}</p></div></div><button onClick={() => navigate("Settings")}><Settings2 size={17}/>Settings</button><button onClick={() => notify(review ? "This review exercises the copied call lifecycle with synthetic responses only. No phone number is dialed." : "Choose a person, review the existing script, and confirm the exact call before dialing.")}><CircleHelp size={17}/>Help & support</button><div className="profile"><span className="profile-avatar">RG</span><div><strong>Rohan G</strong><span>Workspace admin</span></div><MoreHorizontal size={17}/></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20}/></button>{review ? <span>Customer communication</span> : <a href="/admin/command-chat">Command Chat</a>}<ChevronRight size={13}/><strong>AI Caller</strong></div><span className="review-badge"><span/>{review ? "Review only" : "AI calls"}</span></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">AI CALLER</div><h1>Make an AI call</h1><p>A clear purpose. A natural conversation. Every detail in one place.</p></div><button className="secondary-button history-link" onClick={() => navigate("Call history")}><History size={15}/>Call history<ArrowRight size={14}/></button></div>
        <div className="call-grid">
          <div className="composer panel" id="composer">
            <div className="panel-heading"><div><PhoneCall size={17}/><h2>New outbound call</h2></div><span className="quiet-label">One call, one purpose</span></div>
            <Step number={1} title="Who are we calling?" subtitle="Type a number or choose an existing contact.">
              <label className="dial-number" htmlFor="dial-number"><span>Phone number</span><input id="dial-number" type="tel" inputMode="tel" autoComplete="off" placeholder="(202) 555-0100" maxLength={30} value={manualPhone} disabled={locked} aria-invalid={useTypedNumber && !!manualPhone && !normalizedPhone} aria-describedby="dial-number-hint" onChange={event => typePhone(event.target.value)}/></label>
              <p id="dial-number-hint" className="field-hint">{useTypedNumber && manualPhone ? normalizedPhone ? `Calling ${normalizedPhone}` : "Enter a valid number; use +country code for international calls." : "Call a new customer or lead — no booking or saved contact needed."}</p>
              <div className="contact-option-label">Or choose an existing contact</div>
              <div className="contact-select-wrap"><button className="contact-select" disabled={locked} aria-expanded={picker} aria-controls="contact-picker" onClick={() => picker ? closePicker() : setPicker(true)}>{contact ? <><Avatar person={contact}/><span className="contact-copy"><strong>{contact.name}<span className="mini-tag">{contact.type}</span></strong><span>{contact.phone ?? "No phone on file"}<i/>{contact.location}</span></span></> : <span>{loading ? "Loading contacts…" : "Choose a person"}</span>}<ChevronDown size={17}/></button>
              {picker && <div id="contact-picker" className="contact-picker"><div className="search-field"><Search size={15}/><input aria-label={review ? "Search sample contacts" : "Search customers, leads and teams"} autoFocus placeholder="Search by name or phone…" maxLength={100} value={search} onChange={event => changeSearch(event.target.value)}/><button className="icon-button" aria-label="Close contacts" onClick={closePicker}><X size={14}/></button></div>{filteredContacts.map(person => <button key={person.id} disabled={locked} onClick={() => chooseContact(person)}><Avatar person={person} small/><span><strong>{person.name} · {person.type}</strong><small>{person.phone ?? "No phone on file"}</small></span>{contactId === person.id && <Check size={16}/>}</button>)}{searchLoading && <p className="no-results" role="status">Searching contacts…</p>}{currentSearch?.error && <p className="no-results" role="alert">{currentSearch.error}</p>}{!filteredContacts.length && !searchLoading && !currentSearch?.error && <p className="no-results">{query ? "No contacts match." : loading ? "Loading…" : "Search by name or phone to find customers, leads and teams."}</p>}</div>}</div>
              <div className="field-hint"><ShieldCheck size={12}/>{review ? "Fictional contacts for this review" : "Search customers, leads and teams — not limited to today's jobs"}</div>{error && <p className="no-results" role="alert">{error}</p>}
            </Step>
            <Step number={2} title="What should the AI do?" subtitle="Review the existing call script before starting.">
              <div className="presets" aria-label="Instruction presets">{contact?.scripts.map((item, index) => <button key={item.label} disabled={locked} className={preset === index ? "selected" : ""} aria-pressed={preset === index} onClick={() => { setPreset(index); setInstructions(item.text); }}>{item.label}</button>)}</div>
              <label className="sr-only" htmlFor="instructions">Call script</label><textarea id="instructions" value={instructions} disabled={locked} onChange={event => { setInstructions(event.target.value); }} spellCheck={false}/>
              <div className="textarea-footer"><span><FileText size={12}/>The existing caller uses this as its opening script.</span><span>{instructions.length} characters</span></div>
            </Step>
            <Step number={3} title="Voice & conversation style" subtitle="Reuse the existing provider configuration.">
              <div className="voice-fields"><label><span>AI voice</span><div className="select-field"><Mic size={16}/><select value="Ava" disabled aria-label="Existing AI voice"><option>Ava</option></select><ChevronDown size={14}/></div></label><label><span>Conversation style</span><div className="select-field"><AudioLines size={15}/><select value="Warm, concise & professional" disabled aria-label="Existing conversation style"><option>Warm, concise & professional</option></select><ChevronDown size={14}/></div></label></div>
              <div className="voice-detail"><span><AudioLines size={15}/>Ava · English · Existing voice</span><span>Provider settings unchanged</span></div>
            </Step>
            <div className="composer-footer">{session?.phase === "terminal" ? <button className="call-button" onClick={() => { onDismissSession(); setSelectedRecordId(null); }}><PhoneCall size={18}/><span>Prepare another call</span><ArrowRight size={17}/></button> : <button className="call-button" disabled={!contact?.phone || instructions.trim().length < 10 || session !== null} onClick={requestCall}><PhoneCall size={18}/><span>{locked ? statusLabel(session.status) : "Call now"}</span><ArrowRight size={17}/></button>}<p><ShieldCheck size={12}/>{review ? "Review demo — this button will not dial anyone." : "You will confirm the exact recipient and script before dialing."}</p></div>
          </div>
          <aside className="call-preview panel" aria-label={review ? "Example call preview" : "Call preview"}>
            <div className="panel-heading"><div><AudioLines size={17}/><h2>Call preview</h2></div><span className="sample-badge">{review ? "EXAMPLE" : "CALL RECORD"}</span></div>
            <div className="preview-summary"><div className="preview-status"><span><i/>{statusLabel(outcome)}</span><span><Clock3 size={12}/>{formatDuration(duration)}</span></div>{previewPerson && <div className="preview-person"><span className="avatar">{previewPerson.initials}</span><div><h3>{previewPerson.name}</h3><p>{previewPerson.phone}</p></div><span className="outgoing-icon"><ArrowDownLeft size={17}/></span></div>}<div className="waveform" aria-hidden="true">{bars.map((height,index) => <i key={index} style={{height: `${height}px`}}/>)}</div><div className="wave-caption"><span>{previewReason}</span><span>{review ? "Sample conversation" : "Stored conversation"}</span></div>{recordingUrl && <><button className="secondary-button recording-control" onClick={togglePlayback}>{playing ? <Pause size={12}/> : <Play size={12}/>} {playing ? "Pause recording" : "Play recording"}</button><audio ref={audio} src={recordingUrl} controls preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => notify("Recording could not load.")}/></>}</div>
            <div className="transcript-heading"><h3><MessageSquare size={14}/>Transcript</h3><span>Speaker-separated</span></div>
            <div className="transcript">{transcript.length ? transcript.map((turn,index) => <div className={`turn ${turn.ai ? "ai" : "customer"}`} key={index}><span className="speaker-mark">{turn.ai ? <AudioLines size={13}/> : previewPerson?.initials ?? "?"}</span><div><div className="speaker-label"><strong>{turn.speaker}</strong></div><p>{turn.text}</p></div></div>) : <p className="no-results">{locked ? "Transcript and outcome will appear when the call finishes." : "No transcript stored for this call."}</p>}</div>
            <div className="outcome"><span className="outcome-check"><CheckCheck size={18}/></span><div><div className="outcome-label">{review ? "EXAMPLE OUTCOME" : "CALL OUTCOME"}</div><strong>{statusLabel(outcome)}</strong><p>{summary ?? (locked ? "Call in progress. Waiting for the existing provider's result." : "No summary stored for this call.")}</p></div></div>
            <div className="preview-footer"><ShieldCheck size={12}/>{review ? "Synthetic provider responses. No live call or recording." : "Existing call transcript, summary, and recording."}</div>
          </aside>
        </div>
        <section className="recent-section panel" id="recent-calls"><div className="recent-heading"><div><History size={17}/><h2>Recent calls</h2><span className="count">{recent.length}</span></div>{onRefresh ? <button className="secondary-button" onClick={onRefresh} disabled={historyLoading}>{historyLoading ? "Loading…" : "Refresh"}</button> : <span className="quiet-label">{review ? "Sample history" : "Existing call history"}</span>}</div>{historyError && <p className="no-results" role="alert">{historyError}</p>}<div className="call-table"><div className="table-header"><span>Recipient</span><span>Purpose</span><span>Outcome</span><span>Time</span><span>Recording</span></div>{recent.map(call => <div className="call-row" key={call.id}><div className="row-person"><Avatar person={call.person} small/><span><strong>{call.person.name}</strong><small>{call.person.phone}</small></span></div><span className="row-purpose">{call.reason}</span><span className={`outcome-pill ${call.outcome === "voicemail" || call.outcome === "no_answer" || call.outcome === "failed" ? "amber" : "green"}`}><i/>{statusLabel(call.outcome)}</span><span className="row-time">{call.time ?? "—"}<small>{formatDuration(call.durationSeconds)} duration</small></span><div className="row-recording"><button className="play-button" disabled={locked || !call.recordingUrl} aria-label={`Open recording for ${call.person.name}`} onClick={() => { onDismissSession(); setSelectedRecordId(call.id); document.querySelector(".call-preview")?.scrollIntoView({behavior:"smooth",block:"center"}); }}><Play size={12}/></button><div className="mini-wave" aria-hidden="true">{bars.slice(0,19).map((height,index) => <i key={index} style={{height:`${height/3}px`}}/>)}</div><button className="icon-button" disabled={locked} aria-label={`View transcript for ${call.person.name}`} onClick={() => { onDismissSession(); setSelectedRecordId(call.id); document.querySelector(".call-preview")?.scrollIntoView({behavior:"smooth",block:"center"}); }}><ChevronRight size={16}/></button></div></div>)}{!recent.length && <p className="no-results">{historyLoading ? "Loading call history…" : "No calls recorded yet."}</p>}</div><div className="recent-footer"><span>{review ? "Example records, not actual call history." : "Existing inbound and outbound AI calls."}</span><span>{review ? "No sample recording is connected." : "Select a record to listen and read its transcript."}</span></div></section>
        <footer className="page-footer"><span>LeadFlow / AI Caller</span><span>{review ? "Isolated review · No Production changes" : "Existing AI call workflow"}</span></footer>
      </main>
    </div>
    <dialog ref={confirm} className="confirmation" onClose={() => setConfirmation(null)}><div className="dialog-top"><span className="dialog-icon"><PhoneCall size={20}/></span><button className="icon-button" aria-label="Close confirmation" onClick={() => confirm.current?.close()}><X size={18}/></button></div><div className="eyebrow">{review ? "REVIEW DEMO" : "CONFIRM OUTBOUND CALL"}</div><h2>Review this call</h2><p>{review ? "Synthetic call lifecycle only. No call will be placed." : "This places a real outbound call using the existing AI caller."}</p>{confirmation && <><div className="confirm-person"><span className="avatar">{confirmation.personName.split(" ").map(part => part[0]).join("").slice(0,2)}</span><div><strong>{confirmation.personName}</strong><span>{confirmation.phone}{review && " · Fictional number"}</span></div></div><div className="confirm-instructions"><span>CALL SCRIPT · {confirmation.scenario}</span><p>{confirmation.script}</p></div></>}<div className="confirm-voice"><Mic size={14}/>Ava · English · Existing configuration</div><div className="dialog-actions"><button className="secondary-button" onClick={() => confirm.current?.close()}>Keep editing</button><button className="call-button" disabled={!confirmation || session !== null} onClick={() => void confirmCall()}>{review ? "Run review example" : "Yes, start call"}<ArrowRight size={14}/></button></div></dialog>
    {notice && <div className="toast" role="status"><ShieldCheck size={17}/><span>{notice}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={15}/></button></div>}
  </div></div>;
}

import { proxyRecordingUrl } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  AudioLines,
  Bell,
  CheckCircle2,
  Clock3,
  FileText,
  Headphones,
  Phone,
  PhoneIncoming,
  Play,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import "./voice-workspaces-review.css";
import "./ai-calls-transcript-review.css";
import "./ai-calls-exact-live.css";

type Audience = "customer" | "cleaner";
type WorkspaceView = "matrix" | "queue" | "templates";
type CallStatus = "idle" | "firing" | "queued" | "ringing" | "in_progress" | "completed" | "voicemail" | "no_answer" | "failed";
type TranscriptSpeaker = "assistant" | "caller" | "system" | "record";

type Scenario = { title: string; description: string; tag: string };
type CustomerRow = {
  cleanerJobId: number;
  name: string;
  phone: string | null;
  meta: string;
  jobTime: string;
  eta: string;
  pay: string;
  access: string;
  risk: string;
};
type CleanerRow = {
  teamName: string;
  phone: string | null;
  meta: string;
  jobCount: number;
  risk: string;
  hasNoCheckIn: boolean;
  hasUnconfirmed: boolean;
  hasPhotoMissing: boolean;
};
type PersonItem = {
  id: string;
  cleanerJobId: number;
  name: string;
  phone: string | null;
  meta: string;
  jobTime: string;
  eta: string;
  pay: string;
  access: string;
  risk: string;
};
type HistoryRow = {
  id: number;
  step: string;
  calledPhone: string | null;
  outcome: string;
  durationSeconds: number | null;
  transcript: string | null;
  summary: string | null;
  endedReason: string | null;
  recordingUrl: string | null;
  createdAt: string | null;
  vapiCallId: string | null;
};
type TemplateRow = {
  id: number;
  scenario: string;
  audience: Audience;
  title: string;
  body: string;
  updatedAt: Date | string;
};
type TranscriptTurn = { speaker: TranscriptSpeaker; label: string; text: string };

const SCENARIOS: Record<Audience, Scenario[]> = {
  customer: [
    { title: "Team running late", description: "Apologize, give updated ETA, ask flexibility, offer status text.", tag: "Urgent" },
    { title: "Running significantly late", description: "Team is 2+ hrs behind — offer to keep or reschedule.", tag: "Urgent" },
    { title: "Team at address / access needed", description: "Ask how to access home, lockbox, gate, concierge, parking.", tag: "Now" },
    { title: "Parking instructions", description: "Team is heading over — need parking details before arrival.", tag: "Now" },
    { title: "Put card on file", description: "Ask client to call Maids in Black or securely add a card before service.", tag: "Payment" },
    { title: "Payment failed", description: "Card pre-auth declined — need new card or retry same card.", tag: "Payment" },
    { title: "Confirm address", description: "Verify address, unit, parking, entry instructions, and special notes.", tag: "Prep" },
    { title: "Scope clarification", description: "Extra areas noted — confirm scope before team arrives.", tag: "Prep" },
    { title: "Client ETA update", description: "Tell client cleaner ETA and confirm window still works.", tag: "Update" },
    { title: "Earlier arrival available", description: "Slot opened up earlier — offer customer the option to move up.", tag: "Update" },
    { title: "Home not ready / team turned away", description: "Team arrived but could not start — reschedule immediately.", tag: "Issue" },
    { title: "Job paused — issue on site", description: "Team stopped mid-clean — inform customer and decide next step.", tag: "Issue" },
  ],
  cleaner: [
    { title: "ETA request", description: "Ask cleaner exact ETA, traffic issue, and whether client needs alert.", tag: "Urgent" },
    { title: "Schedule confirmation", description: "Confirm cleaner is working tomorrow and number of jobs accepted.", tag: "Daily" },
    { title: "Job status reminder", description: "Ask if they arrived, started, paused, or need office help.", tag: "Ops" },
    { title: "Confirm job completion", description: "Confirm job is finished, photos uploaded, and client walkthrough done.", tag: "Closeout" },
  ],
};

const QUEUE_ROWS = [
  { name: "Chris Patel", reason: "Missing card. Job today at 1 PM. Call before dispatch.", scenario: "Put card on file" },
  { name: "Team Ana", reason: "GPS stale and Angela has late-risk job. Need ETA.", scenario: "ETA request" },
  { name: "Erica Johnson", reason: "Gate code missing for large post-construction job.", scenario: "Team at address / access needed" },
  { name: "Madison Lee", reason: "Tomorrow booking not fully confirmed.", scenario: "Confirm address" },
];

const SCENARIO_SLUG: Record<string, string> = {
  "Team running late": "running_late",
  "Running significantly late": "running_significantly_late",
  "Team at address / access needed": "access_needed",
  "Parking instructions": "parking_instructions",
  "Put card on file": "card_on_file",
  "Payment failed": "payment_failed",
  "Confirm address": "confirm_address",
  "Scope clarification": "scope_clarification",
  "Client ETA update": "client_eta_update",
  "Earlier arrival available": "earlier_arrival",
  "Home not ready / team turned away": "home_not_ready",
  "Job paused — issue on site": "job_paused",
  "ETA request": "eta_request",
  "Schedule confirmation": "schedule_confirmation",
  "Job status reminder": "job_status_reminder",
  "Confirm job completion": "confirm_job_completion",
};

const MERGE_FIELDS = [
  "{{firstName}}", "{{fullName}}", "{{phone}}", "{{jobTime}}", "{{eta}}", "{{address}}", "{{serviceType}}", "{{teamName}}", "{{jobCount}}",
];

const WAVEFORM_BARS = [38, 72, 56, 86, 48, 67, 91, 58, 75, 43, 68, 82, 51, 62, 77, 54, 88, 46, 69, 58, 81, 49, 73, 63, 45, 78, 56, 84, 52, 66, 79, 57, 70, 47, 85, 61, 76, 54, 82, 49, 68, 90, 59, 74, 43, 65, 78, 55, 71, 46, 64, 82, 53, 69, 42, 76, 58, 84, 47, 66, 56, 75, 44, 70, 52, 81, 48, 63, 72, 45, 67, 54, 79, 50, 62, 73, 46, 68, 57, 77, 44, 64, 51, 71, 47, 61, 55, 69, 43, 58, 49, 64, 46, 56, 41, 52] as const;

function todayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function customerToItem(customer: CustomerRow): PersonItem {
  return {
    id: `c-${customer.cleanerJobId}`,
    cleanerJobId: customer.cleanerJobId,
    name: customer.name,
    phone: customer.phone,
    meta: customer.meta,
    jobTime: customer.jobTime,
    eta: customer.eta,
    pay: customer.pay,
    access: customer.access,
    risk: customer.risk,
  };
}

function cleanerToItem(cleaner: CleanerRow): PersonItem {
  return {
    id: `t-${cleaner.teamName}`,
    cleanerJobId: 0,
    name: cleaner.teamName,
    phone: cleaner.phone,
    meta: cleaner.meta,
    jobTime: "Today",
    eta: cleaner.hasNoCheckIn ? "Unknown" : "See jobs",
    pay: `${cleaner.jobCount} job${cleaner.jobCount !== 1 ? "s" : ""}`,
    access: cleaner.hasPhotoMissing ? "Photos missing" : cleaner.hasUnconfirmed ? "Confirm availability" : "OK",
    risk: cleaner.risk,
  };
}

function buildScript(person: PersonItem, scenarioTitle: string, audience: Audience) {
  const first = person.name.split(" ")[0];
  const address = person.meta.split("·")[1]?.trim() ?? "your home";
  if (audience === "cleaner") {
    return `Hi ${person.name}, this is Ava from Maids in Black operations. I'm calling about your assigned cleaning schedule.\n\nReason for the call: ${scenarioTitle}.\n\nCan you tell me your exact status right now — are you on the way, at the job, inside the home, finished, or delayed?\n\nOnce I have that, I'll update the office dashboard and customer if needed. Please also confirm any issue with parking, access, supplies, job size, or photos before you move to the next job.`;
  }
  if (scenarioTitle.toLowerCase().includes("late")) {
    return `Hi ${first}, this is Ava from Maids in Black calling about your cleaning today at ${address}.\n\nI'm sorry, but the team is running behind. Your original arrival was ${person.jobTime}, and the latest ETA we have is ${person.eta}.\n\nDoes that still work for you, or do we need to look at another option? I can also send a text confirmation after this call with the updated arrival window.`;
  }
  if (scenarioTitle.toLowerCase().includes("access")) {
    return `Hi ${first}, this is Ava from Maids in Black. Our team is at or near your address and we need help with access.\n\nCan you confirm the best way to get in — lockbox, front desk, gate code, parking instructions, or should we call when they are outside?\n\nI'll update the team right away so they can get started.`;
  }
  if (scenarioTitle.toLowerCase().includes("card")) {
    return `Hi ${first}, this is Ava from Maids in Black. I'm calling because we still need a card on file to secure your cleaning appointment.\n\nThere is no deposit required, but we do need a card saved before dispatch. You can call Maids in Black or use the secure link we send by text.\n\nWould you like me to send that link now?`;
  }
  return `Hi ${first}, this is Ava from Maids in Black calling about your upcoming cleaning.\n\nI just need to confirm a few details: your service address, unit number if any, parking, entry instructions, and whether there are any special notes for the team.\n\nOnce confirmed, we'll update your job notes so the team has everything before arrival.`;
}

function applyMergeFields(body: string, person: PersonItem, audience: Audience) {
  const first = person.name.split(" ")[0];
  const address = person.meta.split("·")[1]?.trim() ?? "your home";
  return body
    .replace(/\{\{firstName\}\}/g, first)
    .replace(/\{\{fullName\}\}/g, person.name)
    .replace(/\{\{phone\}\}/g, person.phone ?? "")
    .replace(/\{\{jobTime\}\}/g, person.jobTime)
    .replace(/\{\{eta\}\}/g, person.eta)
    .replace(/\{\{address\}\}/g, address)
    .replace(/\{\{serviceType\}\}/g, person.pay)
    .replace(/\{\{teamName\}\}/g, audience === "cleaner" ? person.name : person.access)
    .replace(/\{\{jobCount\}\}/g, person.pay);
}

function initials(value: string) {
  return value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function toneForOutcome(outcome: string) {
  if (outcome === "answered") return "mint";
  if (outcome === "voicemail") return "amber";
  if (outcome === "no_answer" || outcome === "failed") return "blue";
  return "blue";
}

function labelForOutcome(outcome: string) {
  return outcome.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function splitTranscript(transcript: string | null): TranscriptTurn[] {
  if (!transcript?.trim()) return [];
  const lines = transcript.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => {
    const match = line.match(/^([^:]{1,42}):\s*(.+)$/);
    if (!match) return { speaker: "record", label: "Recorded transcript", text: line };
    const source = match[1].trim();
    const text = match[2].trim();
    if (/^(ava|assistant|ai)$/i.test(source)) return { speaker: "assistant", label: "Ava · AI assistant", text };
    if (/^(caller|customer|client)$/i.test(source)) return { speaker: "caller", label: source, text };
    if (/^(system|note|cue)$/i.test(source)) return { speaker: "system", label: source, text };
    return { speaker: "record", label: source, text };
  });
}

function LiveAvatar({ value, className }: { value: string; className: string }) {
  return <span className={`${className} transcript-live-avatar`} aria-label={`${value} record`}>{initials(value)}</span>;
}

function ReviewWaveform() {
  return <div className="transcript-waveform" aria-hidden="true">{WAVEFORM_BARS.map((height, index) => <i key={index} className={index < 16 ? "is-blue" : index < 45 ? "is-olive" : index < 58 ? "is-amber" : "is-silver"} style={{ height: `${height}%` }} />)}</div>;
}

function TemplateEditor({ template, onClose, onSaved }: { template: Partial<TemplateRow> & { scenario: string; audience: Audience }; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(template.title ?? "");
  const [body, setBody] = useState(template.body ?? "");
  const upsert = trpc.callMatrix.upsertTemplate.useMutation({ onSuccess: () => { onSaved(); onClose(); } });
  return <div className="ai-calls-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit AI call template">
    <section className="ai-calls-template-editor">
      <header><div><span className="voice-eyebrow">AI call template</span><h2>{template.id ? "Edit template" : "Create template"}</h2><p>{template.audience} · {template.scenario.replace(/_/g, " ")}</p></div><button type="button" className="ai-calls-icon-button" onClick={onClose} aria-label="Close template editor"><X size={17} /></button></header>
      <label>Template title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Template title" /></label>
      <label>Script body<textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write the call script here. Use merge fields below to insert live context." /></label>
      <div><span className="ai-calls-field-label">Insert merge field</span><div className="ai-calls-merge-fields">{MERGE_FIELDS.map((field) => <button type="button" key={field} onClick={() => setBody((current) => current + field)}>{field}</button>)}</div></div>
      {upsert.isError && <p className="ai-calls-form-error">{upsert.error.message}</p>}
      <footer><button type="button" className="ai-calls-secondary-button" onClick={onClose}>Cancel</button><button type="button" className="ai-calls-primary-button" onClick={() => upsert.mutate({ id: template.id, scenario: template.scenario, audience: template.audience, title: title.trim() || template.scenario, body: body.trim() })} disabled={upsert.isPending || !body.trim()}>{upsert.isPending ? "Saving…" : "Save template"}</button></footer>
    </section>
  </div>;
}

function TemplatesPanel() {
  const { data: templates, isLoading, refetch } = trpc.callMatrix.getTemplates.useQuery(undefined, { staleTime: 30_000 });
  const deleteTemplate = trpc.callMatrix.deleteTemplate.useMutation({ onSuccess: () => refetch() });
  const [editTarget, setEditTarget] = useState<(Partial<TemplateRow> & { scenario: string; audience: Audience }) | null>(null);
  const combinations = useMemo(() => [
    ...SCENARIOS.customer.map((scenario) => ({ scenario: SCENARIO_SLUG[scenario.title], audience: "customer" as const, title: scenario.title })),
    ...SCENARIOS.cleaner.map((scenario) => ({ scenario: SCENARIO_SLUG[scenario.title], audience: "cleaner" as const, title: scenario.title })),
  ], []);
  const templateMap = new Map(((templates ?? []) as TemplateRow[]).map((template) => [`${template.scenario}|${template.audience}`, template]));
  return <section className="ai-calls-modal-panel"><header className="ai-calls-section-head"><div><span className="voice-eyebrow">Existing configuration</span><h2>Call templates</h2></div></header>{isLoading ? <p className="ai-calls-empty-inline">Loading templates…</p> : <div className="ai-calls-template-list">{combinations.map((combination) => {
    const existing = templateMap.get(`${combination.scenario}|${combination.audience}`);
    return <article key={`${combination.scenario}-${combination.audience}`}><div><strong>{combination.title}</strong><small>{combination.audience} · {existing ? existing.body : "No template yet"}</small></div><div><button type="button" className="ai-calls-secondary-button" onClick={() => setEditTarget(existing ? { ...existing } : combination)}>{existing ? "Edit" : "Create"}</button>{existing && <button type="button" className="ai-calls-danger-button" onClick={() => { if (window.confirm(`Delete template for "${combination.title}"?`)) deleteTemplate.mutate({ id: existing.id }); }}>Delete</button>}</div></article>;
  })}</div>}{editTarget && <TemplateEditor template={editTarget} onClose={() => setEditTarget(null)} onSaved={() => { refetch(); setEditTarget(null); }} />}</section>;
}

export default function AiCallsExactLive() {
  const [date] = useState(() => todayET());
  const [composerOpen, setComposerOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("matrix");
  const [audience, setAudience] = useState<Audience>("customer");
  const [composeSelectedId, setComposeSelectedId] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState(SCENARIOS.customer[0].title);
  const [search, setSearch] = useState("");
  const [scenarioQuery, setScenarioQuery] = useState("");
  const [scenarioSearching, setScenarioSearching] = useState(false);
  const [script, setScript] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [activeVapiCallId, setActiveVapiCallId] = useState<string | null>(null);
  const [callSummary, setCallSummary] = useState<string | null>(null);
  const [callTranscript, setCallTranscript] = useState<string | null>(null);
  const [showNewCallTranscript, setShowNewCallTranscript] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: peopleData, isLoading: peopleLoading, error: peopleError } = trpc.callMatrix.getPeople.useQuery({ date }, { staleTime: 60_000 });
  const { data: templates } = trpc.callMatrix.getTemplates.useQuery(undefined, { staleTime: 30_000 });
  const { data: callHistory, isLoading: historyLoading, error: historyError } = trpc.callMatrix.getCallHistory.useQuery({ limit: 50 }, { staleTime: 30_000 });
  const matchScenarioMutation = trpc.callMatrix.matchScenario.useMutation();
  const startCallMutation = trpc.callMatrix.startCall.useMutation({
    onSuccess: (result) => {
      if (result.vapiCallId) {
        setActiveVapiCallId(result.vapiCallId);
        setCallStatus("queued");
        startPolling(result.vapiCallId);
      } else {
        setCallStatus("failed");
        showFlash("Call fired but no Vapi ID returned.");
      }
    },
    onError: (error) => {
      setCallStatus("failed");
      showFlash(`Call failed: ${error.message}`);
    },
  });
  const utils = trpc.useUtils();

  const historyItems = (callHistory ?? []) as HistoryRow[];
  const customerItems = useMemo(() => ((peopleData?.customers ?? []) as CustomerRow[]).map(customerToItem), [peopleData]);
  const cleanerItems = useMemo(() => ((peopleData?.cleaners ?? []) as CleanerRow[]).map(cleanerToItem), [peopleData]);
  const allItems = audience === "customer" ? customerItems : cleanerItems;
  const filteredItems = useMemo(() => {
    const query = search.toLowerCase();
    return allItems.filter((item) => `${item.name}${item.meta}${item.risk}`.toLowerCase().includes(query));
  }, [allItems, search]);
  const selectedPerson = useMemo(() => allItems.find((item) => item.id === composeSelectedId) ?? allItems[0] ?? null, [allItems, composeSelectedId]);
  const selectedHistory = useMemo(() => historyItems.find((item) => item.id === selectedHistoryId) ?? historyItems[0] ?? null, [historyItems, selectedHistoryId]);
  const transcriptTurns = useMemo(() => splitTranscript(selectedHistory?.transcript ?? null), [selectedHistory?.id, selectedHistory?.transcript]);
  const selectedRecordingUrl = proxyRecordingUrl(selectedHistory?.recordingUrl);
  const callActive = !["idle", "completed", "voicemail", "no_answer", "failed"].includes(callStatus);

  useEffect(() => {
    if (historyItems.length && selectedHistoryId === null) setSelectedHistoryId(historyItems[0].id);
  }, [historyItems, selectedHistoryId]);
  useEffect(() => {
    if (!composeSelectedId && allItems[0]) setComposeSelectedId(allItems[0].id);
  }, [allItems, composeSelectedId]);
  useEffect(() => {
    if (!script && selectedPerson) setScript(scriptFromTemplate(selectedPerson, selectedScenario, audience));
    // The previous matrix initializes its editable script once the current selection is available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPerson, templates]);
  useEffect(() => () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); }, []);
  useEffect(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, [selectedHistory?.id]);

  function showFlash(message: string) {
    setFlash(message);
    window.setTimeout(() => setFlash(null), 4000);
  }

  function scriptFromTemplate(person: PersonItem, scenarioTitle: string, currentAudience: Audience) {
    const slug = SCENARIO_SLUG[scenarioTitle] ?? scenarioTitle;
    const template = ((templates ?? []) as TemplateRow[]).find((item) => item.scenario === slug && item.audience === currentAudience);
    return template ? applyMergeFields(template.body, person, currentAudience) : buildScript(person, scenarioTitle, currentAudience);
  }

  function selectPerson(item: PersonItem) {
    setComposeSelectedId(item.id);
    setScript(scriptFromTemplate(item, selectedScenario, audience));
    setCallStatus("idle");
    setActiveVapiCallId(null);
    setCallSummary(null);
  }

  function selectScenario(nextAudience: Audience, title: string) {
    setAudience(nextAudience);
    setSelectedScenario(title);
    const items = nextAudience === "customer" ? customerItems : cleanerItems;
    const first = items[0] ?? null;
    if (first) {
      setComposeSelectedId(first.id);
      setScript(scriptFromTemplate(first, title, nextAudience));
    }
    setCallStatus("idle");
    setActiveVapiCallId(null);
    setCallSummary(null);
  }

  function switchAudience(nextAudience: Audience) {
    setAudience(nextAudience);
    const firstScenario = SCENARIOS[nextAudience][0].title;
    setSelectedScenario(firstScenario);
    const first = (nextAudience === "customer" ? customerItems : cleanerItems)[0] ?? null;
    if (first) {
      setComposeSelectedId(first.id);
      setScript(scriptFromTemplate(first, firstScenario, nextAudience));
    } else {
      setComposeSelectedId(null);
      setScript("");
    }
    setCallStatus("idle");
    setActiveVapiCallId(null);
    setCallSummary(null);
  }

  async function handleScenarioSearch(event: FormEvent) {
    event.preventDefault();
    if (!scenarioQuery.trim()) return;
    setScenarioSearching(true);
    try {
      const result = await matchScenarioMutation.mutateAsync({ query: scenarioQuery });
      const title = result.slug ? Object.entries(SCENARIO_SLUG).find(([, slug]) => slug === result.slug)?.[0] : undefined;
      if (title) {
        selectScenario(SCENARIOS.customer.some((scenario) => scenario.title === title) ? "customer" : "cleaner", title);
        setScenarioQuery("");
        showFlash(`Matched: ${title}`);
      } else {
        showFlash("No close match found — try rephrasing.");
      }
    } catch {
      showFlash("Search failed — try again.");
    } finally {
      setScenarioSearching(false);
    }
  }

  function startPolling(vapiCallId: string) {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const result = await utils.callMatrix.pollCall.fetch({ vapiCallId });
        const status = result.status as CallStatus;
        setCallStatus(status);
        if (result.summary) setCallSummary(result.summary);
        if (result.transcript) setCallTranscript(result.transcript);
        if (["completed", "voicemail", "no_answer", "failed"].includes(status)) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } catch {
        // The existing matrix leaves a transient polling error silent and continues the next interval.
      }
    }, 5000);
  }

  function handleStartCall() {
    if (!selectedPerson) return showFlash("Select a person first.");
    if (!selectedPerson.phone) return showFlash(`No phone number on file for ${selectedPerson.name}.`);
    if (!script.trim()) return showFlash("Script is empty — add a message first.");
    if (callActive) return showFlash("A call is already in progress.");
    setShowConfirm(true);
  }

  function handleSmartPick() {
    const urgent = customerItems.find((item) => item.risk !== "On track");
    if (!urgent) return showFlash("No urgent calls found for today.");
    setAudience("customer");
    setComposeSelectedId(urgent.id);
    setSelectedScenario("Put card on file");
    setScript(buildScript(urgent, "Put card on file", "customer"));
    setWorkspaceView("matrix");
    showFlash(`Smart Pick: ${urgent.name} — ${urgent.risk}`);
  }

  function confirmAndFire() {
    if (!selectedPerson) return;
    setShowConfirm(false);
    setCallStatus("firing");
    setCallSummary(null);
    startCallMutation.mutate({
      cleanerJobId: selectedPerson.cleanerJobId || 1,
      jobDate: date,
      personName: selectedPerson.name,
      phone: selectedPerson.phone!,
      scenario: selectedScenario,
      script: script.trim(),
      audience,
    });
  }

  function togglePlayback() {
    if (!audioRef.current || !selectedRecordingUrl) return;
    if (audioRef.current.paused) audioRef.current.play().catch(() => showFlash("Recording playback could not start."));
    else audioRef.current.pause();
  }

  function openComposer(view: WorkspaceView = "matrix") {
    setWorkspaceView(view);
    setComposerOpen(true);
  }

  const callerLabel = selectedHistory?.calledPhone ?? "Unknown caller";
  const currentStageLabel = selectedHistory ? labelForOutcome(selectedHistory.outcome) : "No call selected";
  const currentTone = toneForOutcome(selectedHistory?.outcome ?? "");

  return <main className="voice-review transcript-review ai-calls-exact-live">
    <header className="voice-utility">
      <div className="transcript-utility-copy"><AudioLines size={17} /><span>AI Calls</span><i /><small>Transcript-forward workspace</small></div>
      <div><button type="button" className="voice-utility-bell" aria-label="AI Calls notifications"><Bell size={18} /><i /></button><span className="voice-owner">RG</span></div>
    </header>

    <div className="voice-content voice-content--transcript">
      <section className="transcript-page-head"><div><span className="voice-eyebrow">AI Calls · Live workspace</span><h1>Hear the decision in context</h1><p>The existing call history, recordings, and stored transcripts are presented in the approved transcript-forward review composition.</p></div><button type="button" className="transcript-back-link" onClick={() => openComposer()}><ArrowLeft size={14} />Command Deck version</button></section>
      {flash && <p className="voice-page-status voice-page-status--wide"><Sparkles size={14} />{flash}</p>}

      <section className="transcript-lab-layout" aria-label="AI Calls transcript workspace">
        <aside className="transcript-queue">
          <header><div><span className="voice-eyebrow">Recent calls</span><h2>Conversation queue</h2></div><span>{historyLoading ? "Loading" : `${historyItems.length} live`}</span></header>
          {historyError ? <div className="voice-empty"><PhoneIncoming size={28} /><strong>Call history could not load</strong><p>{historyError.message}</p></div> : historyItems.length === 0 && !historyLoading ? <div className="voice-empty"><PhoneIncoming size={28} /><strong>No AI matrix calls yet</strong><p>Open Call Matrix to prepare an existing guarded call workflow.</p></div> : <div className="transcript-queue-list">{historyItems.map((call) => <button type="button" key={call.id} className={`transcript-queue-row ${selectedHistory?.id === call.id ? "is-selected" : ""}`} onClick={() => setSelectedHistoryId(call.id)}><LiveAvatar value={call.calledPhone ?? "?"} className="transcript-caller-portrait transcript-caller-portrait--queue" /><span className="transcript-queue-copy"><strong>{call.calledPhone ?? "Unknown caller"}</strong><small>{call.summary ?? call.endedReason ?? "Existing call record"}</small><em><Clock3 size={11} />{call.createdAt ?? "Recorded call"}</em></span><span className={`transcript-queue-dot is-${toneForOutcome(call.outcome)}`} aria-hidden="true" /></button>)}</div>}
          <footer><FileText size={14} /><span>Existing call records</span></footer>
        </aside>

        <article className="transcript-main-stage">
          {selectedHistory ? <>
            <section className="transcript-listening-card">
              <div className="transcript-listening-head"><div className="transcript-caller-identity"><LiveAvatar value={callerLabel} className="transcript-caller-portrait transcript-caller-portrait--hero" /><div><h2>{callerLabel}</h2><p><PhoneIncoming size={14} />AI-handled outbound call</p></div></div><span className={`transcript-outcome is-${currentTone}`}>{currentStageLabel}</span></div>
              <div className="transcript-waveform-row"><button type="button" className="transcript-play" aria-label={selectedRecordingUrl ? (isPlaying ? "Pause recording" : "Play recording") : "Recording unavailable"} disabled={!selectedRecordingUrl} onClick={togglePlayback}><Play size={17} fill="currentColor" /></button><ReviewWaveform /><span>{formatDuration(selectedHistory.durationSeconds)}</span></div>
              {selectedRecordingUrl && <audio ref={audioRef} src={selectedRecordingUrl} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} preload="metadata" />}
              <footer><span><Headphones size={14} />{selectedRecordingUrl ? (isPlaying ? "Playing existing recording" : "Existing recording available") : "No recording stored"}</span><span>{selectedHistory.createdAt ?? "Existing call record"}</span></footer>
            </section>

            <section className="transcript-record" aria-label={`Transcript for ${callerLabel}`}><header><div><span className="voice-eyebrow">Conversation evidence</span><h2>Transcript</h2></div><span className="transcript-record-source">Existing record</span></header>{transcriptTurns.length ? <div className="transcript-turns">{transcriptTurns.map((turn, index) => <article className={`transcript-turn transcript-turn--${turn.speaker === "assistant" ? "madison" : turn.speaker}`} key={`${turn.label}-${index}`}><div className="transcript-speaker"><span className="transcript-speaker-avatar">{turn.speaker === "assistant" ? <Sparkles size={14} /> : turn.speaker === "caller" ? <LiveAvatar value={callerLabel} className="transcript-caller-portrait transcript-caller-portrait--turn" /> : <FileText size={14} />}</span><strong>{turn.label}</strong></div><p>{turn.text}</p></article>)}</div> : <div className="voice-empty"><FileText size={28} /><strong>No transcript was stored for this call</strong><p>The existing call record remains available in the queue.</p></div>}</section>
          </> : <div className="voice-empty voice-review-surface"><AudioLines size={28} /><strong>Select an existing call</strong><p>Choose a call record to review its available recording and transcript.</p></div>}
        </article>

        <aside className="transcript-brief">
          <section className="transcript-brief-card transcript-brief-card--signal"><span className="voice-eyebrow">Call cue</span><h2>{selectedHistory?.summary ?? selectedHistory?.endedReason ?? "Select an existing call record"}</h2><div className="transcript-brief-meta"><span>Duration <strong>{formatDuration(selectedHistory?.durationSeconds ?? null)}</strong></span><span>Contact <strong>{callerLabel}</strong></span></div></section>
          <section className="transcript-brief-card"><span className="voice-eyebrow">Recommended next step</span><strong className="transcript-next-step">Prepare a new call with the existing Call Matrix workflow.</strong><button type="button" onClick={() => openComposer()}><Sparkles size={14} />Prepare follow-up</button></section>
          <section className="transcript-brief-card transcript-brief-card--note"><span className="voice-eyebrow">Call record</span><p>{selectedHistory ? `Outcome: ${currentStageLabel}${selectedHistory.endedReason ? ` · ${selectedHistory.endedReason}` : ""}` : "No call record is selected."}</p></section>
        </aside>
      </section>
    </div>

    {composerOpen && <div className="ai-calls-modal-backdrop" role="dialog" aria-modal="true" aria-label="AI Call Matrix"><section className="ai-calls-composer"><header><div><span className="voice-eyebrow">Existing guarded workflow</span><h2>AI Call Matrix</h2><p>Pick a customer or team, choose the reason, review the existing script, then start the call.</p></div><button type="button" className="ai-calls-icon-button" onClick={() => setComposerOpen(false)} aria-label="Close Call Matrix"><X size={18} /></button></header><nav className="ai-calls-composer-tabs" aria-label="Call Matrix views"><button type="button" className={workspaceView === "matrix" ? "is-active" : ""} onClick={() => setWorkspaceView("matrix")}>Call Matrix</button><button type="button" className={workspaceView === "queue" ? "is-active" : ""} onClick={() => setWorkspaceView("queue")}>Smart Queue</button><button type="button" className={workspaceView === "templates" ? "is-active" : ""} onClick={() => setWorkspaceView("templates")}>Templates</button></nav>
      {workspaceView === "matrix" && <div className="ai-calls-composer-grid"><section className="ai-calls-modal-panel"><header className="ai-calls-section-head"><div><span className="voice-eyebrow">Call selection</span><h2>People and scenario</h2></div><button type="button" className="ai-calls-secondary-button" onClick={handleSmartPick}>Smart Pick</button></header><form className="ai-calls-scenario-search" onSubmit={handleScenarioSearch}><Search size={15} /><input value={scenarioQuery} onChange={(event) => setScenarioQuery(event.target.value)} placeholder="Describe the issue…" /><button type="submit" disabled={scenarioSearching || !scenarioQuery.trim()}>{scenarioSearching ? "Matching…" : "AI Match"}</button></form><div className="ai-calls-audience-tabs">{(["customer", "cleaner"] as Audience[]).map((type) => <button type="button" key={type} className={audience === type ? "is-active" : ""} onClick={() => switchAudience(type)}>{type === "customer" ? `Customers (${customerItems.length})` : `Cleaners (${cleanerItems.length})`}</button>)}</div><label className="ai-calls-people-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search current list" /></label>{peopleLoading ? <p className="ai-calls-empty-inline">Loading today’s list…</p> : peopleError ? <p className="ai-calls-form-error">{peopleError.message}</p> : <div className="ai-calls-people-list">{filteredItems.map((item) => <button type="button" key={item.id} className={selectedPerson?.id === item.id ? "is-selected" : ""} onClick={() => selectPerson(item)}><span>{initials(item.name)}</span><div><strong>{item.name}</strong><small>{item.meta}</small></div><em>{item.risk}</em></button>)}{filteredItems.length === 0 && <p className="ai-calls-empty-inline">{allItems.length === 0 ? "No jobs found for today." : `No results for “${search}”`}</p>}</div>}<div className="ai-calls-scenarios">{SCENARIOS[audience].map((scenario) => <button type="button" key={scenario.title} className={selectedScenario === scenario.title ? "is-selected" : ""} onClick={() => selectScenario(audience, scenario.title)}><strong>{scenario.title}</strong><small>{scenario.description}</small><em>{scenario.tag}</em></button>)}</div></section>
        <section className="ai-calls-modal-panel ai-calls-script-panel"><header className="ai-calls-section-head"><div><span className="voice-eyebrow">Call preparation</span><h2>{selectedPerson?.name ?? "Select a person"}</h2><p>{selectedPerson?.phone ?? "No phone number on file"} · {selectedScenario}</p></div></header>{selectedPerson && <div className="ai-calls-context-grid">{[{ label: "Job time", value: selectedPerson.jobTime }, { label: "Current ETA", value: selectedPerson.eta }, { label: "Payment", value: selectedPerson.pay }, { label: "Access", value: selectedPerson.access }].map((field) => <span key={field.label}><small>{field.label}</small><strong>{field.value}</strong></span>)}</div>}<textarea value={script} onChange={(event) => setScript(event.target.value)} placeholder="Edit the call script here before starting the call…" />{callStatus !== "idle" && <p className="ai-calls-call-state">{callStatus.replace(/_/g, " ")}</p>}{callSummary && <p className="ai-calls-call-summary"><strong>Call summary</strong>{callSummary}</p>}{callTranscript && <section className="ai-calls-new-transcript"><button type="button" onClick={() => setShowNewCallTranscript((value) => !value)}>Transcript <span>{showNewCallTranscript ? "Hide" : "Show"}</span></button>{showNewCallTranscript && <pre>{callTranscript}</pre>}</section>}<div className="ai-calls-script-actions"><button type="button" className="ai-calls-primary-button" onClick={handleStartCall} disabled={callActive || startCallMutation.isPending}>{callActive ? callStatus.replace(/_/g, " ") : "Start AI Call"}</button><button type="button" className="ai-calls-secondary-button" onClick={() => { setScript((value) => value.replace("I'm sorry, but", "I wanted to personally update you —").replace("we still need", "we just need")); showFlash("Script rewritten with a softer tone."); }}>Rewrite Softer</button><button type="button" className="ai-calls-secondary-button" onClick={() => showFlash("SMS version queued with secure link / ETA / access request based on this template.")}>Send SMS Instead</button><button type="button" className="ai-calls-secondary-button" onClick={() => { setCallStatus("idle"); setActiveVapiCallId(null); setCallSummary(null); setCallTranscript(null); setShowNewCallTranscript(false); showFlash("Marked done. Summary added to job record."); }}>Mark Done</button><button type="button" className="ai-calls-secondary-button" onClick={() => { navigator.clipboard.writeText(script); showFlash("Script copied."); }}>Copy Script</button></div></section></div>}
      {workspaceView === "queue" && <section className="ai-calls-modal-panel"><header className="ai-calls-section-head"><div><span className="voice-eyebrow">Existing queue</span><h2>Smart Queue</h2></div></header><div className="ai-calls-smart-queue">{QUEUE_ROWS.map((row) => <article key={row.name}><div><strong>{row.name}</strong><p>{row.reason}</p></div><button type="button" className="ai-calls-secondary-button" onClick={() => { setWorkspaceView("matrix"); showFlash(`Loaded ${row.name} from smart queue.`); }}>Load</button></article>)}</div></section>}
      {workspaceView === "templates" && <TemplatesPanel />}
    </section></div>}

    {showConfirm && selectedPerson && <div className="ai-calls-modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm AI call"><section className="ai-calls-confirm"><span className="voice-eyebrow">Confirm outbound action</span><h2>Confirm AI call</h2><p>Calling <strong>{selectedPerson.name}</strong> at <strong>{selectedPerson.phone}</strong> for <strong>{selectedScenario}</strong>.</p><pre>{script}</pre><footer><button type="button" className="ai-calls-secondary-button" onClick={() => setShowConfirm(false)}>Cancel</button><button type="button" className="ai-calls-primary-button" onClick={confirmAndFire}>Yes, start call</button></footer></section></div>}
  </main>;
}

/**
 * AICallPanel — slide-in right sidebar for firing AI calls.
 * Reuses all tRPC procedures from AICallMatrix. No new backend code.
 *
 * UX flow:
 *  1. Smart Pick auto-selects the most urgent person + scenario on open
 *  2. Agent can search/filter people or scenarios
 *  3. Script is auto-generated and editable
 *  4. Confirm dialog before firing
 *  5. Live status + summary after call
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { X, Bot, Phone, Search, Zap, ChevronDown, ChevronUp, Copy, RefreshCw, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types (mirrored from AICallMatrix) ───────────────────────────────────────
type Audience = "customer" | "cleaner";
type CallStatus = "idle" | "firing" | "queued" | "ringing" | "in_progress" | "completed" | "voicemail" | "no_answer" | "failed";

interface Scenario {
  title: string;
  description: string;
  tag: string;
  tagColor: string;
}

interface PersonItem {
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
}

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
  assignedTeam: string;
  jobAddress: string;
  serviceType: string;
  customerNotes: string;
  staffNotes: string;
  jobStatus: string | null;
  scheduleConfirmed: number;
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

// ─── Static data (same as AICallMatrix) ───────────────────────────────────────
const SCENARIOS: Record<Audience, Scenario[]> = {
  customer: [
    { title: "Team running late",               description: "Apologize, give updated ETA, ask flexibility, offer status text.",                 tag: "Urgent",  tagColor: "#ef4444" },
    { title: "Running significantly late",      description: "Team is 2+ hrs behind — offer to keep or reschedule.",                           tag: "Urgent",  tagColor: "#ef4444" },
    { title: "Team at address / access needed", description: "Ask how to access home, lockbox, gate, concierge, parking.",                      tag: "Now",     tagColor: "#f97316" },
    { title: "Parking instructions",            description: "Team is heading over — need parking details before arrival.",                     tag: "Now",     tagColor: "#f97316" },
    { title: "Put card on file",                description: "Ask client to call Maids in Black or securely add a card before service.",         tag: "Payment", tagColor: "#8b5cf6" },
    { title: "Payment failed",                  description: "Card pre-auth declined — need new card or retry same card.",                       tag: "Payment", tagColor: "#8b5cf6" },
    { title: "Confirm address",                 description: "Verify address, unit, parking, and entry instructions.",                          tag: "Prep",    tagColor: "#3b82f6" },
    { title: "Scope clarification",             description: "Extra areas noted — confirm scope before team arrives.",                          tag: "Prep",    tagColor: "#3b82f6" },
    { title: "Client ETA update",               description: "Tell client cleaner ETA and confirm window still works.",                         tag: "Update",  tagColor: "#10b981" },
    { title: "Earlier arrival available",       description: "Slot opened up earlier — offer customer the option to move up.",                  tag: "Update",  tagColor: "#10b981" },
    { title: "Home not ready / team turned away", description: "Team arrived but couldn't start — reschedule immediately.",                     tag: "Issue",   tagColor: "#f59e0b" },
    { title: "Job paused — issue on site",      description: "Team stopped mid-clean — inform customer and decide next step.",                  tag: "Issue",   tagColor: "#f59e0b" },
  ],
  cleaner: [
    { title: "ETA request",             description: "Ask cleaner exact ETA, traffic issue, and whether client needs alert.",       tag: "Urgent",   tagColor: "#ef4444" },
    { title: "Schedule confirmation",   description: "Confirm cleaner is working tomorrow and number of jobs accepted.",            tag: "Daily",    tagColor: "#3b82f6" },
    { title: "Job status reminder",     description: "Ask if they arrived, started, paused, or need office help.",                 tag: "Ops",      tagColor: "#6366f1" },
    { title: "Confirm job completion",  description: "Confirm job is finished, photos uploaded, and client walkthrough done.",     tag: "Closeout", tagColor: "#10b981" },
    { title: "Missing check-in",        description: "No check-in recorded — confirm location and job start.",                    tag: "Urgent",   tagColor: "#ef4444" },
    { title: "Photo upload reminder",   description: "Job marked done but no photos — request upload before payment.",            tag: "Ops",      tagColor: "#6366f1" },
  ],
};

const SCENARIO_SLUG: Record<string, string> = {
  "Team running late":               "team_running_late",
  "Running significantly late":      "running_significantly_late",
  "Team at address / access needed": "team_at_address_access_needed",
  "Parking instructions":            "parking_instructions",
  "Put card on file":                "put_card_on_file",
  "Payment failed":                  "payment_failed",
  "Confirm address":                 "confirm_address",
  "Scope clarification":             "scope_clarification",
  "Client ETA update":               "client_eta_update",
  "Earlier arrival available":       "earlier_arrival_available",
  "Home not ready / team turned away": "home_not_ready_team_turned_away",
  "Job paused — issue on site":      "job_paused_issue_on_site",
  "ETA request":                     "eta_request",
  "Schedule confirmation":           "schedule_confirmation",
  "Job status reminder":             "job_status_reminder",
  "Confirm job completion":          "confirm_job_completion",
  "Missing check-in":                "missing_check_in",
  "Photo upload reminder":           "photo_upload_reminder",
};

const STATUS_COLORS: Record<CallStatus, string> = {
  idle: "#8f98aa", firing: "#f3c96b", queued: "#7bb7ff",
  ringing: "#f3c96b", in_progress: "#63d297", completed: "#63d297",
  voicemail: "#8f98aa", no_answer: "#ff6b6b", failed: "#ff6b6b",
};
const STATUS_LABELS: Record<CallStatus, string> = {
  idle: "Ready", firing: "Connecting…", queued: "Queued…",
  ringing: "Ringing…", in_progress: "In call…", completed: "Call completed",
  voicemail: "Left voicemail", no_answer: "No answer", failed: "Call failed",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function customerToItem(c: CustomerRow): PersonItem {
  return { id: `c-${c.cleanerJobId}`, cleanerJobId: c.cleanerJobId, name: c.name, phone: c.phone, meta: c.meta, jobTime: c.jobTime, eta: c.eta, pay: c.pay, access: c.access, risk: c.risk };
}
function cleanerToItem(cl: CleanerRow): PersonItem {
  return { id: `t-${cl.teamName}`, cleanerJobId: 0, name: cl.teamName, phone: cl.phone, meta: cl.meta, jobTime: "Today", eta: cl.hasNoCheckIn ? "Unknown" : "See jobs", pay: `${cl.jobCount} job${cl.jobCount !== 1 ? "s" : ""}`, access: cl.hasPhotoMissing ? "Photos missing" : cl.hasUnconfirmed ? "Confirm availability" : "OK", risk: cl.risk };
}

function buildScript(person: PersonItem, scenarioTitle: string, audience: Audience): string {
  const first = person.name.split(" ")[0];
  if (audience === "cleaner") {
    return `Hi ${first}, this is Ava from Maids in Black. I'm calling about your schedule today.\n\nCan you confirm your current status and ETA for your next job? The office needs an update to keep clients informed.\n\nThank you.`;
  }
  if (scenarioTitle.toLowerCase().includes("late")) {
    return `Hi ${first}, this is Ava from Maids in Black. I'm calling to let you know our team is running a bit behind schedule today.\n\nYour updated estimated arrival time is ${person.eta}. We appreciate your patience and will keep you posted.\n\nIs there anything you need from us in the meantime?`;
  }
  if (scenarioTitle.toLowerCase().includes("access")) {
    return `Hi ${first}, this is Ava from Maids in Black. Our team is at or near your address and we need help with access.\n\nCan you confirm the best way to get in — lockbox, front desk, gate code, parking instructions, or should we call when they are outside?\n\nI'll update the team right away so they can get started.`;
  }
  if (scenarioTitle.toLowerCase().includes("card")) {
    return `Hi ${first}, this is Ava from Maids in Black. I'm calling because we still need a card on file to secure your cleaning appointment.\n\nThere is no deposit required, but we do need a card saved before dispatch. You can call Maids in Black or use the secure link we send by text.\n\nWould you like me to send that link now?`;
  }
  return `Hi ${first}, this is Ava from Maids in Black calling about your upcoming cleaning.\n\nI just need to confirm a few details: your service address, unit number if any, parking, entry instructions, and whether there are any special notes for the team.\n\nOnce confirmed, we'll update your job notes so the team has everything before arrival.`;
}

function applyMergeFields(body: string, person: PersonItem): string {
  const first = person.name.split(" ")[0];
  return body
    .replace(/\{\{firstName\}\}/g, first)
    .replace(/\{\{fullName\}\}/g, person.name)
    .replace(/\{\{phone\}\}/g, person.phone ?? "");
}

function riskColor(risk: string): string {
  const r = risk.toLowerCase();
  if (r.includes("urgent") || r.includes("high")) return "#ef4444";
  if (r.includes("late") || r.includes("no check")) return "#f97316";
  if (r.includes("track")) return "#10b981";
  return "#8f98aa";
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface AICallPanelProps {
  open: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AICallPanel({ open, onClose }: AICallPanelProps) {
  const [date] = useState(() => todayET());

  // Step state: "person" → "scenario" → "script"
  const [step, setStep] = useState<"person" | "scenario" | "script">("person");

  const [audience, setAudience] = useState<Audience>("customer");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string>(SCENARIOS.customer[0].title);
  const [personSearch, setPersonSearch] = useState("");
  const [scenarioSearch, setScenarioSearch] = useState("");
  const [script, setScript] = useState("");

  // Call state
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [activeVapiCallId, setActiveVapiCallId] = useState<string | null>(null);
  const [callSummary, setCallSummary] = useState<string | null>(null);
  const [callTranscript, setCallTranscript] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [scenarioAiQuery, setScenarioAiQuery] = useState("");
  const [scenarioAiSearching, setScenarioAiSearching] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data ──
  const { data, isLoading } = trpc.callMatrix.getPeople.useQuery({ date }, { staleTime: 60_000, enabled: open });
  const { data: templates } = trpc.callMatrix.getTemplates.useQuery(undefined, { staleTime: 30_000, enabled: open });
  const matchScenarioMutation = trpc.callMatrix.matchScenario.useMutation();
  const startCallMutation = trpc.callMatrix.startCall.useMutation({
    onSuccess: (result) => {
      if (result.vapiCallId) {
        setActiveVapiCallId(result.vapiCallId);
        setCallStatus("queued");
        startPolling(result.vapiCallId);
      } else {
        setCallStatus("failed");
        showFlash("Call failed to start — no call ID returned.");
      }
    },
    onError: (err) => {
      setCallStatus("failed");
      showFlash(`Error: ${err.message}`);
    },
  });
  const pollCallQuery = trpc.callMatrix.pollCall.useQuery(
    { vapiCallId: activeVapiCallId! },
    { enabled: false, staleTime: 0 }
  );
  const utils = trpc.useUtils();

  // ── Derived lists ──
  const customerItems = useMemo(() => (data?.customers ?? []).map(customerToItem), [data]);
  const cleanerItems  = useMemo(() => (data?.cleaners  ?? []).map(cleanerToItem),  [data]);
  const allItems = audience === "customer" ? customerItems : cleanerItems;

  const filteredPeople = useMemo(() => {
    const q = personSearch.toLowerCase();
    return allItems.filter(p => (p.name + p.meta + p.risk + (p.phone ?? "")).toLowerCase().includes(q));
  }, [allItems, personSearch]);

  const allScenarios = useMemo(() => [
    ...SCENARIOS.customer.map(s => ({ ...s, audience: "customer" as Audience })),
    ...SCENARIOS.cleaner.map(s => ({ ...s, audience: "cleaner" as Audience })),
  ], []);

  const filteredScenarios = useMemo(() => {
    const q = scenarioSearch.toLowerCase();
    if (!q) return allScenarios;
    return allScenarios.filter(s => (s.title + s.description + s.tag).toLowerCase().includes(q));
  }, [allScenarios, scenarioSearch]);

  const selectedPerson = useMemo(() => allItems.find(p => p.id === selectedId) ?? null, [allItems, selectedId]);

  // ── Script builder ──
  function scriptFromTemplate(person: PersonItem, scenarioTitle: string, aud: Audience): string {
    const slug = SCENARIO_SLUG[scenarioTitle] ?? scenarioTitle;
    const tmpl = (templates ?? []).find(t => t.scenario === slug && t.audience === aud);
    if (tmpl) return applyMergeFields(tmpl.body, person);
    return buildScript(person, scenarioTitle, aud);
  }

  // ── Smart Pick on open ──
  useEffect(() => {
    if (!open) return;
    setStep("person");
    setPersonSearch("");
    setScenarioSearch("");
    setCallStatus("idle");
    setActiveVapiCallId(null);
    setCallSummary(null);
    setCallTranscript(null);
    setShowTranscript(false);
    setFlash(null);
  }, [open]);

  // Auto-smart-pick once data loads
  useEffect(() => {
    if (!open || !data || selectedId) return;
    const urgent = customerItems.find(c => c.risk !== "On track" && c.risk !== "OK");
    if (urgent) {
      setAudience("customer");
      setSelectedId(urgent.id);
      const sc = SCENARIOS.customer[0].title;
      setSelectedScenario(sc);
      setScript(scriptFromTemplate(urgent, sc, "customer"));
    } else if (customerItems.length > 0) {
      const first = customerItems[0];
      setSelectedId(first.id);
      const sc = SCENARIOS.customer[0].title;
      setSelectedScenario(sc);
      setScript(scriptFromTemplate(first, sc, "customer"));
    }
  }, [open, data, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Polling ──
  function startPolling(vapiCallId: string) {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const result = await utils.callMatrix.pollCall.fetch({ vapiCallId });
        if (result.status) setCallStatus(result.status as CallStatus);
        if (result.summary) setCallSummary(result.summary);
        if (result.transcript) setCallTranscript(result.transcript);
        const done = ["completed", "voicemail", "no_answer", "failed"].includes(result.status ?? "");
        if (done) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } catch { /* ignore */ }
    }, 5000);
  }
  useEffect(() => () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); }, []);

  // ── Helpers ──
  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 4000);
  }

  function selectPerson(item: PersonItem) {
    setSelectedId(item.id);
    setScript(scriptFromTemplate(item, selectedScenario, audience));
    setStep("scenario");
  }

  function selectScenario(aud: Audience, title: string) {
    setAudience(aud);
    setSelectedScenario(title);
    if (selectedPerson) {
      setScript(scriptFromTemplate(selectedPerson, title, aud));
    }
    setStep("script");
  }

  function handleStartCall() {
    if (!selectedPerson) return showFlash("Select a person first.");
    if (!selectedPerson.phone) return showFlash(`No phone on file for ${selectedPerson.name}.`);
    if (!script.trim()) return showFlash("Script is empty.");
    if (["firing","queued","ringing","in_progress"].includes(callStatus)) return showFlash("A call is already in progress.");
    setShowConfirm(true);
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

  async function handleScenarioAiSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!scenarioAiQuery.trim()) return;
    setScenarioAiSearching(true);
    try {
      const result = await matchScenarioMutation.mutateAsync({ query: scenarioAiQuery });
      if (result.slug) {
        const SLUG_TO_TITLE: Record<string, string> = Object.fromEntries(
          Object.entries(SCENARIO_SLUG).map(([title, slug]) => [slug, title])
        );
        const title = SLUG_TO_TITLE[result.slug];
        if (title) {
          const aud: Audience = SCENARIOS.customer.some(s => s.title === title) ? "customer" : "cleaner";
          selectScenario(aud, title);
          setScenarioAiQuery("");
          showFlash(`AI matched: ${title}`);
        } else {
          showFlash("No close match — try rephrasing.");
        }
      } else {
        showFlash("No close match — try rephrasing.");
      }
    } catch {
      showFlash("AI search failed — try again.");
    } finally {
      setScenarioAiSearching(false);
    }
  }

  const callActive = ["firing","queued","ringing","in_progress"].includes(callStatus);

  // ── Styles ──
  const s = {
    bg: "#0f1115", panel: "#171a21", panel2: "#1f2430", muted: "#8f98aa",
    text: "#f4f6fb", line: "#2a3040", accent: "#f3c96b", good: "#63d297",
    blue: "#7bb7ff", dark: "#121620",
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-[201] flex flex-col animate-in slide-in-from-right duration-250"
        style={{
          width: 440,
          background: s.bg,
          borderLeft: `1px solid ${s.line}`,
          boxShadow: "-24px 0 64px rgba(0,0,0,0.6)",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
          color: s.text,
        }}
      >
        {/* ── Header ── */}
        <div style={{ padding: "16px 18px 14px", borderBottom: `1px solid ${s.line}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#1a1f2e,#2a3040)", display: "grid", placeItems: "center", border: `1px solid ${s.line}`, flexShrink: 0 }}>
            <Bot size={16} color={s.accent} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>AI Call</div>
            <div style={{ fontSize: 11, color: s.muted }}>
              {step === "person" && "Step 1 — Pick who to call"}
              {step === "scenario" && "Step 2 — Pick the reason"}
              {step === "script" && "Step 3 — Review & fire"}
            </div>
          </div>

          {/* Step breadcrumb */}
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {(["person","scenario","script"] as const).map((s_, i) => (
              <button
                key={s_}
                onClick={() => { if (s_ !== "person" || selectedId) setStep(s_); }}
                style={{
                  width: 24, height: 24, borderRadius: "50%", border: "none", cursor: "pointer",
                  fontWeight: 800, fontSize: 11,
                  background: step === s_ ? s.accent : (["person","scenario","script"].indexOf(step) > i ? "#2a3040" : "#1a1f2e"),
                  color: step === s_ ? "#111" : s.muted,
                  transition: "background .15s",
                }}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: s.muted, padding: 4, borderRadius: 8, display: "flex", alignItems: "center" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ── STEP 1: PERSON ── */}
          {step === "person" && (
            <>
              {/* Audience toggle */}
              <div style={{ display: "flex", gap: 6 }}>
                {(["customer","cleaner"] as Audience[]).map(type => (
                  <button
                    key={type}
                    onClick={() => { setAudience(type); setSelectedId(null); setPersonSearch(""); }}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 10, border: `1px solid ${audience === type ? s.accent : s.line}`,
                      background: audience === type ? "#1d1b14" : s.dark,
                      color: audience === type ? s.accent : s.muted,
                      fontWeight: 700, fontSize: 12, cursor: "pointer", transition: "all .15s",
                    }}
                  >
                    {type === "customer" ? `Customers (${customerItems.length})` : `Cleaners (${cleanerItems.length})`}
                  </button>
                ))}
              </div>

              {/* Smart Pick banner */}
              {(() => {
                const urgent = customerItems.find(c => c.risk !== "On track" && c.risk !== "OK");
                if (!urgent) return null;
                return (
                  <button
                    onClick={() => {
                      setAudience("customer");
                      setSelectedId(urgent.id);
                      setSelectedScenario(SCENARIOS.customer[0].title);
                      setScript(scriptFromTemplate(urgent, SCENARIOS.customer[0].title, "customer"));
                      setStep("scenario");
                      showFlash(`Smart Pick: ${urgent.name}`);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                      background: "#1a1500", border: `1px solid #3d3000`, borderRadius: 12,
                      cursor: "pointer", textAlign: "left", width: "100%",
                    }}
                  >
                    <Zap size={14} color={s.accent} style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: s.accent }}>Smart Pick: {urgent.name}</div>
                      <div style={{ fontSize: 11, color: "#a08040", marginTop: 1 }}>{urgent.risk} · {urgent.meta}</div>
                    </div>
                  </button>
                );
              })()}

              {/* Search */}
              <div style={{ position: "relative" }}>
                <Search size={13} color={s.muted} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                <input
                  value={personSearch}
                  onChange={e => setPersonSearch(e.target.value)}
                  placeholder="Search name, address, phone…"
                  style={{ width: "100%", paddingLeft: 30, paddingRight: 12, paddingTop: 9, paddingBottom: 9, background: s.dark, border: `1px solid ${s.line}`, borderRadius: 10, color: s.text, outline: "none", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>

              {/* People list */}
              {isLoading && <div style={{ color: s.muted, fontSize: 13, padding: "8px 0" }}>Loading today's jobs…</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filteredPeople.map(p => {
                  const active = selectedId === p.id;
                  const rc = riskColor(p.risk);
                  return (
                    <button
                      key={p.id}
                      onClick={() => selectPerson(p)}
                      style={{
                        display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 10, alignItems: "center",
                        padding: "10px 12px", border: `1px solid ${active ? s.blue : s.line}`,
                        borderRadius: 12, background: active ? "#132033" : s.dark,
                        cursor: "pointer", textAlign: "left", width: "100%", transition: "all .12s",
                      }}
                    >
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: "#1f2430", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 13, flexShrink: 0, color: s.accent }}>
                        {initials(p.name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: s.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: s.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.meta}</div>
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 800, color: rc, background: rc + "18", border: `1px solid ${rc}40`, borderRadius: 6, padding: "3px 7px", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {p.risk}
                      </div>
                    </button>
                  );
                })}
                {filteredPeople.length === 0 && !isLoading && (
                  <div style={{ color: s.muted, fontSize: 13, padding: "12px 0", textAlign: "center" }}>
                    {allItems.length === 0 ? "No jobs found for today." : `No results for "${personSearch}"`}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── STEP 2: SCENARIO ── */}
          {step === "scenario" && (
            <>
              {/* Selected person recap */}
              {selectedPerson && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#132033", border: `1px solid #1e3a5a`, borderRadius: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#1f2430", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 12, color: s.accent, flexShrink: 0 }}>
                    {initials(selectedPerson.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{selectedPerson.name}</div>
                    <div style={{ fontSize: 11, color: s.muted }}>{selectedPerson.phone ?? "No phone"}</div>
                  </div>
                  <button onClick={() => setStep("person")} style={{ background: "none", cursor: "pointer", color: s.muted, fontSize: 11, padding: "4px 8px", borderRadius: 6, border: `1px solid ${s.line}` }}>
                    Change
                  </button>
                </div>
              )}

              {/* AI scenario search */}
              <form onSubmit={handleScenarioAiSearch} style={{ display: "flex", gap: 6 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <Bot size={13} color={s.muted} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                  <input
                    value={scenarioAiQuery}
                    onChange={e => setScenarioAiQuery(e.target.value)}
                    placeholder="Describe the issue, AI picks the reason…"
                    style={{ width: "100%", paddingLeft: 30, paddingRight: 12, paddingTop: 9, paddingBottom: 9, background: s.dark, border: `1px solid ${s.line}`, borderRadius: 10, color: s.text, outline: "none", fontSize: 12, boxSizing: "border-box" }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={scenarioAiSearching || !scenarioAiQuery.trim()}
                  style={{ padding: "9px 14px", background: "transparent", border: `1px solid ${s.accent}`, borderRadius: 10, color: s.accent, fontWeight: 700, fontSize: 12, cursor: scenarioAiSearching ? "wait" : "pointer", opacity: scenarioAiSearching ? 0.6 : 1, whiteSpace: "nowrap" }}
                >
                  {scenarioAiSearching ? "…" : "AI Match"}
                </button>
              </form>

              {/* Scenario search filter */}
              <div style={{ position: "relative" }}>
                <Search size={13} color={s.muted} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                <input
                  value={scenarioSearch}
                  onChange={e => setScenarioSearch(e.target.value)}
                  placeholder="Filter scenarios…"
                  style={{ width: "100%", paddingLeft: 30, paddingRight: 12, paddingTop: 8, paddingBottom: 8, background: s.dark, border: `1px solid ${s.line}`, borderRadius: 10, color: s.text, outline: "none", fontSize: 12, boxSizing: "border-box" }}
                />
              </div>

              {/* Grouped scenarios */}
              {(["customer","cleaner"] as Audience[]).map(type => {
                const group = filteredScenarios.filter(s_ => s_.audience === type);
                if (group.length === 0) return null;
                return (
                  <div key={type}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: s.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                      {type === "customer" ? "Customer Calls" : "Cleaner Calls"}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {group.map(sc => {
                        const active = selectedScenario === sc.title && audience === type;
                        return (
                          <button
                            key={sc.title}
                            onClick={() => selectScenario(type, sc.title)}
                            style={{
                              display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
                              border: `1px solid ${active ? s.accent : s.line}`,
                              borderRadius: 10, background: active ? "#1d1b14" : s.dark,
                              cursor: "pointer", textAlign: "left", width: "100%", transition: "all .12s",
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 12, color: s.text }}>{sc.title}</div>
                              <div style={{ fontSize: 11, color: s.muted, marginTop: 2, lineHeight: 1.35 }}>{sc.description}</div>
                            </div>
                            <div style={{ fontSize: 10, fontWeight: 800, color: sc.tagColor, background: sc.tagColor + "18", border: `1px solid ${sc.tagColor}40`, borderRadius: 6, padding: "2px 6px", whiteSpace: "nowrap", flexShrink: 0, marginTop: 1 }}>
                              {sc.tag}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* ── STEP 3: SCRIPT + FIRE ── */}
          {step === "script" && (
            <>
              {/* Person + scenario recap */}
              {selectedPerson && (
                <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 14, padding: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{selectedPerson.name}</div>
                      <div style={{ fontSize: 11, color: s.muted, marginTop: 1 }}>{selectedPerson.phone ?? "No phone"} · {selectedPerson.meta}</div>
                      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: s.accent }}>{selectedScenario}</div>
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={() => setStep("person")} style={{ background: "none", border: `1px solid ${s.line}`, cursor: "pointer", color: s.muted, fontSize: 10, padding: "3px 8px", borderRadius: 6 }}>Person</button>
                      <button onClick={() => setStep("scenario")} style={{ background: "none", border: `1px solid ${s.line}`, cursor: "pointer", color: s.muted, fontSize: 10, padding: "3px 8px", borderRadius: 6 }}>Reason</button>
                    </div>
                  </div>

                  {/* 4-cell job details */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
                    {[
                      { label: "Job time", value: selectedPerson.jobTime },
                      { label: "ETA",      value: selectedPerson.eta },
                      { label: "Payment",  value: selectedPerson.pay },
                      { label: "Access",   value: selectedPerson.access },
                    ].map(f => (
                      <div key={f.label} style={{ background: s.dark, border: `1px solid ${s.line}`, borderRadius: 10, padding: "8px 10px" }}>
                        <span style={{ display: "block", color: s.muted, fontSize: 10, marginBottom: 3 }}>{f.label}</span>
                        <b style={{ fontSize: 12 }}>{f.value}</b>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Script editor */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: s.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Script — edit before calling</div>
                <textarea
                  value={script}
                  onChange={e => setScript(e.target.value)}
                  placeholder="Edit the call script…"
                  style={{
                    width: "100%", minHeight: 140, resize: "vertical", lineHeight: 1.5,
                    background: "#11151d", border: `1px solid ${s.line}`, borderRadius: 10,
                    color: s.text, padding: "10px 12px", outline: "none", fontSize: 13,
                    fontFamily: "inherit", boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Quick script actions */}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => {
                    setScript(prev => prev.replace("I'm sorry, but", "I wanted to personally update you —").replace("we still need", "we just need"));
                    showFlash("Rewritten softer.");
                  }}
                  style={{ flex: 1, padding: "8px 0", background: s.dark, border: `1px solid ${s.line}`, borderRadius: 8, color: s.muted, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                >
                  <RefreshCw size={11} style={{ display: "inline", marginRight: 4 }} />
                  Softer tone
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(script); showFlash("Copied."); }}
                  style={{ flex: 1, padding: "8px 0", background: s.dark, border: `1px solid ${s.line}`, borderRadius: 8, color: s.muted, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                >
                  <Copy size={11} style={{ display: "inline", marginRight: 4 }} />
                  Copy script
                </button>
              </div>

              {/* Call status */}
              {callStatus !== "idle" && (
                <div style={{ padding: "10px 12px", background: "#0d1520", border: `1px solid ${STATUS_COLORS[callStatus]}33`, borderRadius: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  {callActive && <div style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[callStatus], animation: "aicall-pulse 1.2s infinite", flexShrink: 0 }} />}
                  <span style={{ fontSize: 13, color: STATUS_COLORS[callStatus], fontWeight: 700 }}>{STATUS_LABELS[callStatus]}</span>
                </div>
              )}

              {/* Summary */}
              {callSummary && (
                <div style={{ padding: "10px 12px", background: "#0d1a12", border: "1px solid #285b3a", borderRadius: 10 }}>
                  <div style={{ fontSize: 10, color: s.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Call summary</div>
                  <div style={{ fontSize: 13, color: "#b9ffd4", lineHeight: 1.4 }}>{callSummary}</div>
                </div>
              )}

              {/* Transcript */}
              {callTranscript && (
                <div style={{ background: s.dark, border: `1px solid ${s.line}`, borderRadius: 10 }}>
                  <button
                    onClick={() => setShowTranscript(v => !v)}
                    style={{ width: "100%", background: "none", border: "none", cursor: "pointer", color: s.muted, fontSize: 12, padding: "10px 12px", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <span>Transcript</span>
                    {showTranscript ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  {showTranscript && (
                    <div style={{ fontSize: 12, color: s.muted, padding: "0 12px 12px", maxHeight: 180, overflowY: "auto", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                      {callTranscript}
                    </div>
                  )}
                </div>
              )}

              {/* Flash */}
              {flash && (
                <div style={{ padding: "9px 12px", background: "#101e15", border: "1px solid #285b3a", color: "#b9ffd4", borderRadius: 10, fontSize: 12 }}>
                  {flash}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer CTA ── */}
        {step === "script" && (
          <div style={{ padding: "12px 18px", borderTop: `1px solid ${s.line}`, flexShrink: 0, display: "flex", gap: 8 }}>
            {(callStatus === "completed" || callStatus === "voicemail" || callStatus === "no_answer" || callStatus === "failed") ? (
              <button
                onClick={() => { setCallStatus("idle"); setActiveVapiCallId(null); setCallSummary(null); setCallTranscript(null); setShowTranscript(false); }}
                style={{ flex: 1, padding: "12px 0", background: s.panel2, border: `1px solid ${s.line}`, borderRadius: 12, color: s.text, fontWeight: 800, fontSize: 14, cursor: "pointer" }}
              >
                New Call
              </button>
            ) : (
              <button
                onClick={handleStartCall}
                disabled={callActive || startCallMutation.isPending}
                style={{
                  flex: 1, padding: "12px 0", border: 0, borderRadius: 12,
                  fontWeight: 800, fontSize: 14, cursor: callActive ? "not-allowed" : "pointer",
                  color: "#111", background: callActive ? "#3a5a3a" : s.good,
                  opacity: callActive ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                <Phone size={15} />
                {callActive ? STATUS_LABELS[callStatus] : "Start AI Call"}
              </button>
            )}
            <button
              onClick={onClose}
              style={{ padding: "12px 16px", background: s.dark, border: `1px solid ${s.line}`, borderRadius: 12, color: s.muted, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              <PhoneOff size={14} />
            </button>
          </div>
        )}

        {step === "person" && (
          <div style={{ padding: "12px 18px", borderTop: `1px solid ${s.line}`, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: s.muted, textAlign: "center" }}>
              Select a person above to continue →
            </div>
          </div>
        )}

        {step === "scenario" && (
          <div style={{ padding: "12px 18px", borderTop: `1px solid ${s.line}`, flexShrink: 0 }}>
            <div style={{ fontSize: 11, color: s.muted, textAlign: "center" }}>
              Select a call reason above to continue →
            </div>
          </div>
        )}

        {/* Confirm dialog */}
        {showConfirm && selectedPerson && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", display: "grid", placeItems: "center", zIndex: 10, borderRadius: 0 }}>
            <div style={{ background: "#171a21", border: "1px solid #2a3040", borderRadius: 18, padding: 24, width: 360, maxWidth: "90%", boxShadow: "0 24px 64px rgba(0,0,0,0.7)", margin: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#0d1a12", border: "1px solid #285b3a", display: "grid", placeItems: "center" }}>
                  <Phone size={16} color="#63d297" />
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>Confirm AI call</div>
                  <div style={{ fontSize: 11, color: s.muted }}>Ava will call right now</div>
                </div>
              </div>

              <div style={{ background: "#0f1115", border: `1px solid ${s.line}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>
                  <b>{selectedPerson.name}</b> · <span style={{ color: s.muted }}>{selectedPerson.phone}</span>
                </div>
                <div style={{ fontSize: 11, color: s.accent, fontWeight: 700, marginBottom: 8 }}>{selectedScenario}</div>
                <div style={{ fontSize: 11, color: s.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Script preview</div>
                <div style={{ fontSize: 12, color: s.text, lineHeight: 1.45, maxHeight: 120, overflowY: "auto", whiteSpace: "pre-wrap" }}>{script}</div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={confirmAndFire}
                  style={{ flex: 1, padding: "11px 0", border: 0, borderRadius: 10, fontWeight: 800, cursor: "pointer", color: "#111", background: "#63d297", fontSize: 14 }}
                >
                  Yes, call now
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  style={{ flex: 1, padding: "11px 0", border: `1px solid ${s.line}`, borderRadius: 10, fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 14 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <style>{`@keyframes aicall-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
      </div>
    </>
  );
}

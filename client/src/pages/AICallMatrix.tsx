import { useState, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Scenario {
  title: string;
  description: string;
  tag: string;
}

interface Person {
  n: string;   // name
  m: string;   // meta / job description
  job: string; // job time
  eta: string;
  pay: string;
  access: string;
  risk: string;
}

type Audience = "customer" | "cleaner";
type View = "matrix" | "queue" | "history" | "settings";

// ─── Static data (placeholder until backend is wired) ─────────────────────────

const SCENARIOS: Record<Audience, Scenario[]> = {
  customer: [
    { title: "Team running late",               description: "Apologize, give updated ETA, ask flexibility, offer status text.",                                    tag: "Urgent"  },
    { title: "Team at address / access needed", description: "Ask how to access home, lockbox, gate, concierge, parking.",                                         tag: "Now"     },
    { title: "Put card on file",                description: "Ask client to call Maids in Black or securely add a card before service.",                            tag: "Payment" },
    { title: "Confirm address",                 description: "Verify address, unit, parking, and entry instructions.",                                              tag: "Prep"    },
    { title: "Client ETA update",               description: "Tell client cleaner ETA and confirm window still works.",                                             tag: "Update"  },
  ],
  cleaner: [
    { title: "ETA request",             description: "Ask cleaner exact ETA, traffic issue, and whether client needs alert.",                          tag: "Urgent"   },
    { title: "Schedule confirmation",   description: "Confirm cleaner is working tomorrow and number of jobs accepted.",                               tag: "Daily"    },
    { title: "Job status reminder",     description: "Ask if they arrived, started, paused, or need office help.",                                    tag: "Ops"      },
    { title: "Confirm job completion",  description: "Confirm job is finished, photos uploaded, and client walkthrough done.",                        tag: "Closeout" },
  ],
};

const PEOPLE: Record<Audience, Person[]> = {
  customer: [
    { n: "Angela Morris",  m: "3 bed / 2 bath deep clean · 1321 R St NW",              job: "11:00 AM",       eta: "12:20 PM", pay: "Card on file",  access: "Lockbox unknown",    risk: "High impact"   },
    { n: "Chris Patel",    m: "1 bed move-out · 1440 Meridian Pl",                     job: "1:00 PM",        eta: "1:00 PM",  pay: "Missing card",  access: "Vacant / lockbox",   risk: "Payment risk"  },
    { n: "Madison Lee",    m: "2 bed / 1 bath standard · Silver Spring",               job: "Tomorrow 9:00 AM", eta: "On time", pay: "Missing card",  access: "Client home",        risk: "Prep needed"   },
    { n: "Erica Johnson",  m: "5 bed / 4 bath post-construction · Arlington",          job: "2:00 PM",        eta: "3:05 PM",  pay: "Card on file",  access: "Gate code missing",  risk: "High impact"   },
  ],
  cleaner: [
    { n: "Team Ana",    m: "Assigned: Angela + Erica · GPS stale 22 min",        job: "Today",        eta: "Unknown",  pay: "2 jobs",    access: "Needs ETA",            risk: "Urgent"        },
    { n: "Team Brenda", m: "Assigned: Madison tomorrow · not confirmed",         job: "Tomorrow",     eta: "Pending",  pay: "1 job",     access: "Confirm availability", risk: "Schedule risk" },
    { n: "Team Carla",  m: "Currently at 1440 Meridian · photos missing",        job: "In progress",  eta: "On site",  pay: "Closeout",  access: "Photos missing",       risk: "QA risk"       },
    { n: "Team Diana",  m: "No check-in for 2:00 PM job",                        job: "2:00 PM",      eta: "Unknown",  pay: "1 job",     access: "No check-in",          risk: "Urgent"        },
  ],
};

const QUEUE_ROWS = [
  { name: "Chris Patel",    reason: "Missing card. Job today at 1 PM. Call before dispatch.", scenario: "Put card on file"                },
  { name: "Team Ana",       reason: "GPS stale and Angela has late-risk job. Need ETA.",      scenario: "ETA request"                     },
  { name: "Erica Johnson",  reason: "Gate code missing for large post-construction job.",     scenario: "Team at address / access needed" },
  { name: "Madison Lee",    reason: "Tomorrow booking not fully confirmed.",                  scenario: "Confirm address"                 },
];

// ─── Script generator ─────────────────────────────────────────────────────────

function buildScript(person: Person, scenarioTitle: string, audience: Audience): string {
  const first = person.n.split(" ")[0];
  const address = person.m.split("·")[1]?.trim() ?? "your home";

  if (audience === "cleaner") {
    return `Hi ${person.n}, this is Maids in Black operations. I'm calling about your assigned cleaning schedule.\n\nReason for the call: ${scenarioTitle}.\n\nCan you tell me your exact status right now — are you on the way, at the job, inside the home, finished, or delayed?\n\nOnce I have that, I'll update the office dashboard and customer if needed. Please also confirm any issue with parking, access, supplies, job size, or photos before you move to the next job.`;
  }

  if (scenarioTitle.toLowerCase().includes("late")) {
    return `Hi ${first}, this is Maids in Black calling about your cleaning today at ${address}.\n\nI'm sorry, but the team is running behind. Your original arrival was ${person.job}, and the latest ETA we have is ${person.eta}.\n\nDoes that still work for you, or do we need to look at another option? I can also send a text confirmation after this call with the updated arrival window.`;
  }
  if (scenarioTitle.toLowerCase().includes("access")) {
    return `Hi ${first}, this is Maids in Black. Our team is at or near your address and we need help with access.\n\nCan you confirm the best way to get in — lockbox, front desk, gate code, parking instructions, or should we call when they are outside?\n\nI'll update the team right away so they can get started.`;
  }
  if (scenarioTitle.toLowerCase().includes("card")) {
    return `Hi ${first}, this is Maids in Black. I'm calling because we still need a card on file to secure your cleaning appointment.\n\nThere is no deposit required, but we do need a card saved before dispatch. You can call Maids in Black or use the secure link we send by text.\n\nWould you like me to send that link now?`;
  }
  return `Hi ${first}, this is Maids in Black calling about your upcoming cleaning.\n\nI just need to confirm a few details: your service address, unit number if any, parking, entry instructions, and whether there are any special notes for the team.\n\nOnce confirmed, we'll update your job notes so the team has everything before arrival.`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Initials({ name }: { name: string }) {
  const letters = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div
      style={{ width: 36, height: 36, borderRadius: 12, background: "#1f2430", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 13, flexShrink: 0 }}
    >
      {letters}
    </div>
  );
}

function Tag({ label, hot }: { label: string; hot?: boolean }) {
  return (
    <span style={{
      fontSize: 11, background: hot ? "#f3c96b" : "#262b37", border: "1px solid #2a3040",
      borderRadius: 999, padding: "4px 8px", color: hot ? "#111" : "#8f98aa", whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function StatusBadge({ risk }: { risk: string }) {
  const isRed = risk.toLowerCase().includes("high") || risk.toLowerCase().includes("urgent");
  return (
    <span style={{
      fontSize: 11, borderRadius: 999, padding: "4px 8px", border: `1px solid ${isRed ? "#633" : "#365"}`,
      color: isRed ? "#ffb4b4" : "#b9ffd4", whiteSpace: "nowrap",
    }}>
      {risk}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AICallMatrix() {
  const [view, setView] = useState<View>("matrix");
  const [audience, setAudience] = useState<Audience>("customer");
  const [selectedPerson, setSelectedPerson] = useState<Person>(PEOPLE.customer[0]);
  const [selectedScenario, setSelectedScenario] = useState<string>(SCENARIOS.customer[0].title);
  const [search, setSearch] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [script, setScript] = useState(() => buildScript(PEOPLE.customer[0], SCENARIOS.customer[0].title, "customer"));

  // ── helpers ──
  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3500);
  }

  function selectPerson(person: Person) {
    setSelectedPerson(person);
    setScript(buildScript(person, selectedScenario, audience));
  }

  function selectScenario(type: Audience, title: string) {
    setAudience(type);
    const firstPerson = PEOPLE[type][0];
    setSelectedPerson(firstPerson);
    setSelectedScenario(title);
    setScript(buildScript(firstPerson, title, type));
  }

  function switchAudience(type: Audience) {
    setAudience(type);
    const firstPerson = PEOPLE[type][0];
    const firstScenario = SCENARIOS[type][0].title;
    setSelectedPerson(firstPerson);
    setSelectedScenario(firstScenario);
    setScript(buildScript(firstPerson, firstScenario, type));
  }

  function smartPick() {
    const person = PEOPLE.customer[1]; // Chris Patel — missing card
    setAudience("customer");
    setSelectedPerson(person);
    setSelectedScenario("Put card on file");
    setScript(buildScript(person, "Put card on file", "customer"));
    setView("matrix");
    showFlash("Smart Pick selected highest risk: missing card before dispatch.");
  }

  function loadFromQueue(name: string, scenario: string) {
    const aud: Audience = PEOPLE.customer.some(p => p.n === name) ? "customer" : "cleaner";
    const person = PEOPLE[aud].find(p => p.n === name) ?? PEOPLE[aud][0];
    setAudience(aud);
    setSelectedPerson(person);
    setSelectedScenario(scenario);
    setScript(buildScript(person, scenario, aud));
    setView("matrix");
    showFlash("Loaded from smart queue.");
  }

  // ── filtered people list ──
  const filteredPeople = useMemo(() => {
    const q = search.toLowerCase();
    return PEOPLE[audience].filter(p =>
      (p.n + p.m + p.risk).toLowerCase().includes(q)
    );
  }, [audience, search]);

  // ── view titles ──
  const viewTitles: Record<View, string> = {
    matrix: "AI Call Matrix",
    queue: "Smart Queue",
    history: "Call History",
    settings: "Templates",
  };

  // ─── Styles (inline to match the mockup's CSS vars exactly) ──────────────────
  const s = {
    bg:      "#0f1115",
    panel:   "#171a21",
    panel2:  "#1f2430",
    muted:   "#8f98aa",
    text:    "#f4f6fb",
    line:    "#2a3040",
    accent:  "#f3c96b",
    good:    "#63d297",
    bad:     "#ff6b6b",
    blue:    "#7bb7ff",
    chip:    "#262b37",
    dark:    "#121620",
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "270px 1fr 390px", minHeight: "100vh", background: s.bg, color: s.text, fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}>

      {/* ── LEFT SIDEBAR ── */}
      <aside style={{ background: "#0b0d11", borderRight: `1px solid ${s.line}`, padding: 18, display: "flex", flexDirection: "column", gap: 0 }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 18, marginBottom: 22 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#111,#333)", display: "grid", placeItems: "center", color: s.accent, border: "1px solid #3b3b3b", flexShrink: 0 }}>M</div>
          <div>
            Maids in Black<br />
            <span style={{ color: s.muted, fontSize: 13, fontWeight: 400 }}>AI Call Matrix</span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ display: "grid", gap: 2 }}>
          {(["matrix", "queue", "history", "settings"] as View[]).map((v, i) => {
            const labels = ["Call Matrix", "Smart Queue", "Call History", "Templates"];
            const active = view === v;
            return (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  width: "100%", textAlign: "left", background: active ? s.panel : "transparent",
                  color: active ? s.text : s.muted, border: 0, padding: "12px 10px", borderRadius: 12,
                  fontWeight: 650, cursor: "pointer", fontSize: 14,
                }}
              >
                {labels[i]}
              </button>
            );
          })}
        </nav>

        {/* Metrics card */}
        <div style={{ marginTop: 18, padding: 14, border: `1px solid ${s.line}`, borderRadius: 16, background: s.panel }}>
          {[["Calls needed", "18"], ["Late team alerts", "5"], ["Card missing", "7"], ["Cleaner ETA needed", "6"]].map(([label, val], i, arr) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < arr.length - 1 ? `1px solid ${s.line}` : "none", fontSize: 13 }}>
              <span>{label}</span><b>{val}</b>
            </div>
          ))}
        </div>

        {/* Smart rules card */}
        <div style={{ marginTop: 14, padding: 14, border: `1px solid ${s.line}`, borderRadius: 16, background: s.panel }}>
          <b style={{ fontSize: 13 }}>Smart rules</b>
          <p style={{ color: s.muted, fontSize: 12, margin: "8px 0 0", lineHeight: 1.45 }}>
            Auto-suggests the best call based on job time, card status, cleaner check-in, address notes, and customer sensitivity.
          </p>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main style={{ padding: "18px 22px", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, margin: 0, fontWeight: 800 }}>{viewTitles[view]}</h1>
            <div style={{ color: s.muted, fontSize: 13, marginTop: 4 }}>
              Pick a customer or cleaner, choose the reason, review the AI script, then start the call.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search client, cleaner, address..."
              style={{ background: "#11151d", border: `1px solid ${s.line}`, borderRadius: 12, color: s.text, padding: "11px 12px", outline: "none", width: 260, fontSize: 13 }}
            />
            <button
              onClick={smartPick}
              style={{ border: `1px solid ${s.line}`, borderRadius: 12, padding: "11px 14px", fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 13 }}
            >
              Smart Pick
            </button>
          </div>
        </div>

        {/* ── MATRIX VIEW ── */}
        {view === "matrix" && (
          <>
            {/* Scenario grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              {(["customer", "cleaner"] as Audience[]).map(type => (
                <div key={type} style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 18, padding: 15 }}>
                  <h2 style={{ fontSize: 15, margin: "0 0 12px", fontWeight: 700 }}>
                    {type === "customer" ? "Customer call reasons" : "Cleaner call reasons"}
                  </h2>
                  <div style={{ display: "grid", gap: 10 }}>
                    {SCENARIOS[type].map(sc => {
                      const active = selectedScenario === sc.title;
                      return (
                        <div
                          key={sc.title}
                          onClick={() => selectScenario(type, sc.title)}
                          style={{
                            padding: 13, border: `1px solid ${active ? s.accent : s.line}`,
                            borderRadius: 15, background: active ? "#1d1b14" : s.dark,
                            cursor: "pointer", transition: "border-color .15s, background .15s",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                            <b style={{ fontSize: 14 }}>{sc.title}</b>
                            <Tag label={sc.tag} />
                          </div>
                          <p style={{ margin: "6px 0 0", color: s.muted, fontSize: 12, lineHeight: 1.35 }}>{sc.description}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* People list */}
            <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 18, padding: 15 }}>
              <h2 style={{ fontSize: 15, margin: "0 0 12px", fontWeight: 700 }}>People needing calls</h2>
              {/* Audience tabs */}
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {(["customer", "cleaner"] as Audience[]).map(type => {
                  const active = audience === type;
                  return (
                    <button
                      key={type}
                      onClick={() => switchAudience(type)}
                      style={{
                        background: active ? s.accent : s.dark, color: active ? "#111" : s.muted,
                        border: `1px solid ${active ? s.accent : s.line}`, padding: "9px 11px",
                        borderRadius: 999, cursor: "pointer", fontWeight: 800, fontSize: 12,
                      }}
                    >
                      {type === "customer" ? "Customers" : "Cleaners"}
                    </button>
                  );
                })}
              </div>
              {/* People rows */}
              <div style={{ display: "grid", gap: 8, maxHeight: 390, overflowY: "auto", paddingRight: 3 }}>
                {filteredPeople.map(p => {
                  const active = selectedPerson.n === p.n;
                  return (
                    <div
                      key={p.n}
                      onClick={() => selectPerson(p)}
                      style={{
                        display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 10,
                        alignItems: "center", padding: 11,
                        border: `1px solid ${active ? s.blue : s.line}`,
                        borderRadius: 15, background: active ? "#132033" : s.dark,
                        cursor: "pointer",
                      }}
                    >
                      <Initials name={p.n} />
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>{p.n}</div>
                        <div style={{ fontSize: 12, color: s.muted, marginTop: 2 }}>{p.m}</div>
                      </div>
                      <StatusBadge risk={p.risk} />
                    </div>
                  );
                })}
                {filteredPeople.length === 0 && (
                  <div style={{ color: s.muted, fontSize: 13, padding: "12px 0" }}>No results for "{search}"</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── SMART QUEUE VIEW ── */}
        {view === "queue" && (
          <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 18, padding: 15 }}>
            <h2 style={{ fontSize: 15, margin: "0 0 12px", fontWeight: 700 }}>Smart Queue — prioritized by business impact</h2>
            {QUEUE_ROWS.map(row => (
              <div
                key={row.name}
                style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", border: `1px solid ${s.line}`, background: s.dark, borderRadius: 14, padding: 10, marginBottom: 8 }}
              >
                <div>
                  <b style={{ fontSize: 14 }}>{row.name}</b>
                  <div style={{ fontSize: 12, color: s.muted, marginTop: 2 }}>{row.reason}</div>
                </div>
                <button
                  onClick={() => loadFromQueue(row.name, row.scenario)}
                  style={{ border: `1px solid ${s.line}`, borderRadius: 12, padding: "9px 14px", fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 12 }}
                >
                  Load
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── CALL HISTORY VIEW ── */}
        {view === "history" && (
          <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 18, padding: 15 }}>
            <h2 style={{ fontSize: 15, margin: "0 0 12px", fontWeight: 700 }}>Recent AI calls</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                { time: "10:42 AM", name: "Angela Morris",  detail: "Late arrival update. Client confirmed flexible until 2:30 PM." },
                { time: "10:19 AM", name: "Team Ana",        detail: "ETA request. Cleaner replied 18 minutes away."                },
                { time: "9:58 AM",  name: "Chris Patel",     detail: "Card-on-file call. Voicemail left and SMS follow-up sent."    },
                { time: "9:21 AM",  name: "Team Brenda",     detail: "Schedule confirmation. Confirmed 2 jobs today."               },
              ].map(ev => (
                <div key={ev.name + ev.time} style={{ borderLeft: `3px solid ${s.line}`, paddingLeft: 10, color: s.muted, fontSize: 12, lineHeight: 1.35 }}>
                  <b style={{ color: s.text }}>{ev.time} — {ev.name}</b><br />{ev.detail}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TEMPLATES VIEW ── */}
        {view === "settings" && (
          <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 18, padding: 15 }}>
            <h2 style={{ fontSize: 15, margin: "0 0 6px", fontWeight: 700 }}>Template system</h2>
            <p style={{ color: s.muted, fontSize: 13, margin: "0 0 14px" }}>
              Each template should merge job data, speak naturally, allow interruption, and end with a confirmation summary.
            </p>
            {[
              { title: "Team running late",     desc: "Uses current ETA, apology, flexibility question, and updated window."                   },
              { title: "Access problem",         desc: "Asks for lockbox, concierge, parking, gate code, or alternate entry."                   },
              { title: "Card on file",           desc: "Explains card requirement without sounding like a debt collection call."                },
              { title: "Cleaner ETA request",    desc: "Asks cleaner for exact ETA and blockers, then updates job status."                      },
            ].map(t => (
              <div
                key={t.title}
                style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", border: `1px solid ${s.line}`, background: s.dark, borderRadius: 14, padding: 10, marginBottom: 8 }}
              >
                <div>
                  <b style={{ fontSize: 14 }}>{t.title}</b>
                  <div style={{ fontSize: 12, color: s.muted, marginTop: 2 }}>{t.desc}</div>
                </div>
                <button
                  style={{ border: `1px solid ${s.line}`, borderRadius: 12, padding: "9px 14px", fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 12 }}
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── RIGHT PANEL ── */}
      <section style={{ background: "#11141b", borderLeft: `1px solid ${s.line}`, padding: 18, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>

        {/* Call box */}
        <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 20, padding: 16 }}>
          {/* Selected person header */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{selectedPerson.n}</div>
              <div style={{ fontSize: 12, color: s.muted, marginTop: 2 }}>{selectedPerson.m}</div>
              <div style={{ marginTop: 8, color: s.accent, fontSize: 13, fontWeight: 800 }}>{selectedScenario}</div>
            </div>
            <Tag label={selectedPerson.risk} hot={selectedPerson.risk.toLowerCase().includes("high") || selectedPerson.risk.toLowerCase().includes("urgent")} />
          </div>

          {/* Job fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
            {[
              { label: "Job time", value: selectedPerson.job },
              { label: "Current ETA", value: selectedPerson.eta },
              { label: "Payment", value: selectedPerson.pay },
              { label: "Access", value: selectedPerson.access },
            ].map(f => (
              <div key={f.label} style={{ background: s.dark, border: `1px solid ${s.line}`, borderRadius: 14, padding: 10 }}>
                <span style={{ display: "block", color: s.muted, fontSize: 11, marginBottom: 5 }}>{f.label}</span>
                <b style={{ fontSize: 13 }}>{f.value}</b>
              </div>
            ))}
          </div>

          {/* Script textarea */}
          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            style={{
              width: "100%", minHeight: 150, resize: "vertical", lineHeight: 1.45,
              marginTop: 10, background: "#11151d", border: `1px solid ${s.line}`,
              borderRadius: 12, color: s.text, padding: "11px 12px", outline: "none",
              fontSize: 13, fontFamily: "inherit",
            }}
          />

          {/* Action buttons */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <button
              onClick={() => showFlash("AI call started. Listening for outcome: confirmed, voicemail, angry client, reschedule, payment complete, or access received.")}
              style={{ border: 0, borderRadius: 12, padding: "11px 14px", fontWeight: 800, cursor: "pointer", color: "#111", background: s.good, fontSize: 13 }}
            >
              Start AI Call
            </button>
            <button
              onClick={() => {
                setScript(prev => prev.replace("I'm sorry, but", "I wanted to personally update you —").replace("we still need", "we just need"));
                showFlash("Script rewritten with a softer customer-service tone.");
              }}
              style={{ border: `1px solid ${s.line}`, borderRadius: 12, padding: "11px 14px", fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 13 }}
            >
              Rewrite Softer
            </button>
            <button
              onClick={() => showFlash("SMS version queued with secure link / ETA / access request based on this template.")}
              style={{ border: `1px solid ${s.line}`, borderRadius: 12, padding: "11px 14px", fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 13 }}
            >
              Send SMS Instead
            </button>
            <button
              onClick={() => showFlash("Marked done. Summary added to job record and follow-up removed from queue.")}
              style={{ border: `1px solid ${s.line}`, borderRadius: 12, padding: "11px 14px", fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 13 }}
            >
              Mark Done
            </button>
            <button
              onClick={() => { navigator.clipboard.writeText(script); showFlash("Script copied."); }}
              style={{ gridColumn: "1 / -1", border: `1px solid ${s.line}`, borderRadius: 12, padding: "11px 14px", fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 13 }}
            >
              Copy Script
            </button>
          </div>

          {/* Flash message */}
          {flash && (
            <div style={{ marginTop: 12, background: "#101e15", border: "1px solid #285b3a", color: "#b9ffd4", borderRadius: 14, padding: 12, fontSize: 13 }}>
              {flash}
            </div>
          )}
        </div>

        {/* Live call guardrails */}
        <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 20, padding: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px", fontWeight: 700 }}>Live call guardrails</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {[
              { phase: "Before call", detail: "AI checks job notes, customer history, assigned team, current location, and missing info." },
              { phase: "During call", detail: "AI listens for yes/no, anger, flexibility, access codes, card refusal, and callback requests." },
              { phase: "After call",  detail: "AI writes summary, updates job record, tags outcome, and creates next action." },
            ].map(ev => (
              <div key={ev.phase} style={{ borderLeft: `3px solid ${s.line}`, paddingLeft: 10, color: s.muted, fontSize: 12, lineHeight: 1.35 }}>
                <b style={{ color: s.text }}>{ev.phase}</b><br />{ev.detail}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

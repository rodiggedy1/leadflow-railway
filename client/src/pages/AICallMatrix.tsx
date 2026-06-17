import { useState, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Scenario {
  title: string;
  description: string;
  tag: string;
}

type Audience = "customer" | "cleaner";
type View = "matrix" | "queue" | "history" | "settings";
type CallStatus = "idle" | "firing" | "queued" | "ringing" | "in_progress" | "completed" | "voicemail" | "no_answer" | "failed";

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

// ─── Static data ──────────────────────────────────────────────────────────────

const SCENARIOS: Record<Audience, Scenario[]> = {
  customer: [
    { title: "Team running late",               description: "Apologize, give updated ETA, ask flexibility, offer status text.",                 tag: "Urgent"  },
    { title: "Team at address / access needed", description: "Ask how to access home, lockbox, gate, concierge, parking.",                      tag: "Now"     },
    { title: "Put card on file",                description: "Ask client to call Maids in Black or securely add a card before service.",         tag: "Payment" },
    { title: "Confirm address",                 description: "Verify address, unit, parking, and entry instructions.",                          tag: "Prep"    },
    { title: "Client ETA update",               description: "Tell client cleaner ETA and confirm window still works.",                         tag: "Update"  },
  ],
  cleaner: [
    { title: "ETA request",             description: "Ask cleaner exact ETA, traffic issue, and whether client needs alert.",       tag: "Urgent"   },
    { title: "Schedule confirmation",   description: "Confirm cleaner is working tomorrow and number of jobs accepted.",            tag: "Daily"    },
    { title: "Job status reminder",     description: "Ask if they arrived, started, paused, or need office help.",                 tag: "Ops"      },
    { title: "Confirm job completion",  description: "Confirm job is finished, photos uploaded, and client walkthrough done.",     tag: "Closeout" },
  ],
};

const QUEUE_ROWS = [
  { name: "Chris Patel",    reason: "Missing card. Job today at 1 PM. Call before dispatch.", scenario: "Put card on file"                },
  { name: "Team Ana",       reason: "GPS stale and Angela has late-risk job. Need ETA.",      scenario: "ETA request"                     },
  { name: "Erica Johnson",  reason: "Gate code missing for large post-construction job.",     scenario: "Team at address / access needed" },
  { name: "Madison Lee",    reason: "Tomorrow booking not fully confirmed.",                  scenario: "Confirm address"                 },
];

// ─── Script generator ─────────────────────────────────────────────────────────

function buildScript(person: PersonItem, scenarioTitle: string, audience: Audience): string {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function customerToItem(c: CustomerRow): PersonItem {
  return { id: `c-${c.cleanerJobId}`, cleanerJobId: c.cleanerJobId, name: c.name, phone: c.phone, meta: c.meta, jobTime: c.jobTime, eta: c.eta, pay: c.pay, access: c.access, risk: c.risk };
}

function cleanerToItem(cl: CleanerRow): PersonItem {
  // cleaners don't have a single cleanerJobId — use 0 as sentinel; phone is the key
  return { id: `t-${cl.teamName}`, cleanerJobId: 0, name: cl.teamName, phone: cl.phone, meta: cl.meta, jobTime: "Today", eta: cl.hasNoCheckIn ? "Unknown" : "See jobs", pay: `${cl.jobCount} job${cl.jobCount !== 1 ? "s" : ""}`, access: cl.hasPhotoMissing ? "Photos missing" : cl.hasUnconfirmed ? "Confirm availability" : "OK", risk: cl.risk };
}

const STATUS_LABELS: Record<CallStatus, string> = {
  idle: "",
  firing: "Connecting to Vapi…",
  queued: "Call queued — dialing…",
  ringing: "Ringing…",
  in_progress: "Call in progress",
  completed: "Call completed",
  voicemail: "Voicemail left",
  no_answer: "No answer",
  failed: "Call failed",
};

const STATUS_COLORS: Record<CallStatus, string> = {
  idle: "",
  firing: "#7bb7ff",
  queued: "#7bb7ff",
  ringing: "#f3c96b",
  in_progress: "#63d297",
  completed: "#63d297",
  voicemail: "#f3c96b",
  no_answer: "#ff9966",
  failed: "#ff6b6b",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Initials({ name }: { name: string }) {
  const letters = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div style={{ width: 36, height: 36, borderRadius: 12, background: "#1f2430", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 13, flexShrink: 0 }}>
      {letters}
    </div>
  );
}

function Tag({ label, hot }: { label: string; hot?: boolean }) {
  return (
    <span style={{ fontSize: 11, background: hot ? "#f3c96b" : "#262b37", border: "1px solid #2a3040", borderRadius: 999, padding: "4px 8px", color: hot ? "#111" : "#8f98aa", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function StatusBadge({ risk }: { risk: string }) {
  const isRed = risk.toLowerCase().includes("high") || risk.toLowerCase().includes("urgent") || risk.toLowerCase().includes("no check");
  return (
    <span style={{ fontSize: 11, borderRadius: 999, padding: "4px 8px", border: `1px solid ${isRed ? "#633" : "#365"}`, color: isRed ? "#ffb4b4" : "#b9ffd4", whiteSpace: "nowrap" }}>
      {risk}
    </span>
  );
}

// ─── CallHistoryView ─────────────────────────────────────────────────────────

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
  createdAt: number | null;
  vapiCallId: string | null;
};

function HistoryOutcomeBadge({ outcome }: { outcome: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    answered:  { label: "Answered",  color: "#b9ffd4", bg: "#0d2a1a" },
    voicemail: { label: "Voicemail", color: "#f3c96b", bg: "#2a1e00" },
    no_answer: { label: "No Answer", color: "#ffb4b4", bg: "#2a0d0d" },
    failed:    { label: "Failed",    color: "#ff6b6b", bg: "#2a0d0d" },
  };
  const m = map[outcome] ?? { label: outcome, color: "#8f98aa", bg: "#1f2430" };
  return (
    <span style={{ fontSize: 11, borderRadius: 999, padding: "3px 8px", background: m.bg, color: m.color, border: `1px solid ${m.color}33`, whiteSpace: "nowrap" }}>
      {m.label}
    </span>
  );
}

function HistoryCallCard({ row, s }: { row: HistoryRow; s: Record<string, string> }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const time = row.createdAt ? new Date(row.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" }) : "—";
  const duration = row.durationSeconds ? (row.durationSeconds < 60 ? `${row.durationSeconds}s` : `${Math.floor(row.durationSeconds / 60)}m ${row.durationSeconds % 60}s`) : null;
  const scenarioLabel = row.step.replace("ai_matrix_", "").replace(/_/g, " ");

  return (
    <div style={{ background: s.dark, border: `1px solid ${s.line}`, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: s.text }}>{row.calledPhone ?? "Unknown"}</div>
          <div style={{ fontSize: 11, color: s.muted, marginTop: 2 }}>{time}{duration ? ` · ${duration}` : ""} · {scenarioLabel}</div>
        </div>
        <HistoryOutcomeBadge outcome={row.outcome} />
      </div>

      {row.summary && (
        <div style={{ fontSize: 12, color: "#b9ffd4", background: "#0d2a1a", border: "1px solid #1a4a2a", borderRadius: 10, padding: "8px 10px", lineHeight: 1.4 }}>
          {row.summary}
        </div>
      )}

      {row.recordingUrl && (
        <div style={{ background: "#0d1a12", border: "1px solid #1a4a2a", borderRadius: 10, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: s.muted, flexShrink: 0 }}>Recording</span>
          <audio controls src={row.recordingUrl} style={{ flex: 1, height: 28, minWidth: 0 }} />
        </div>
      )}

      {row.transcript && (
        <>
          <button
            onClick={() => setShowTranscript(v => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", color: s.muted, fontSize: 12, textAlign: "left", padding: 0 }}
          >
            {showTranscript ? "▲ Hide transcript" : "▼ Show transcript"}
          </button>
          {showTranscript && (
            <div style={{ fontSize: 12, color: s.muted, background: "#0f1115", border: `1px solid ${s.line}`, borderRadius: 10, padding: "8px 10px", maxHeight: 160, overflowY: "auto", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {row.transcript}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CallHistoryView({ s }: { s: Record<string, string> }) {
  const { data, isLoading } = trpc.callMatrix.getCallHistory.useQuery({ limit: 50 }, { staleTime: 30_000 });

  return (
    <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 18, padding: 15 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 12px", fontWeight: 700 }}>Recent AI calls</h2>
      {isLoading && <div style={{ color: s.muted, fontSize: 13 }}>Loading call history…</div>}
      {!isLoading && (!data || data.length === 0) && (
        <div style={{ color: s.muted, fontSize: 13, padding: "12px 0" }}>No AI matrix calls yet. Start a call from the Call Matrix tab.</div>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {(data ?? []).map(row => (
          <HistoryCallCard key={row.id} row={row as HistoryRow} s={s} />
        ))}
      </div>
    </div>
  );
}

// ─── Merge-field helpers ─────────────────────────────────────────────────────

const MERGE_FIELDS = [
  "{{firstName}}", "{{fullName}}", "{{phone}}",
  "{{jobTime}}", "{{eta}}", "{{address}}",
  "{{serviceType}}", "{{teamName}}", "{{jobCount}}",
];

function applyMergeFields(body: string, person: PersonItem, audience: Audience): string {
  const first = person.name.split(" ")[0];
  const address = person.meta.split("·")[1]?.trim() ?? "your home";
  return body
    .replace(/\{\{firstName\}\}/g, first)
    .replace(/\{\{fullName\}\}/g, person.name)
    .replace(/\{\{phone\}\}/g, person.phone ?? "")
    .replace(/\{\{jobTime\}\}/g, person.jobTime)
    .replace(/\{\{eta\}\}/g, person.eta)
    .replace(/\{\{address\}\}/g, address)
    .replace(/\{\{serviceType\}\}/g, person.pay ?? "")
    .replace(/\{\{teamName\}\}/g, audience === "cleaner" ? person.name : (person.access ?? ""))
    .replace(/\{\{jobCount\}\}/g, person.pay ?? "");
}

// ─── Scenario → template slug mapping ────────────────────────────────────────

const SCENARIO_SLUG: Record<string, string> = {
  "Team running late":               "running_late",
  "Team at address / access needed": "access_needed",
  "Put card on file":                "card_on_file",
  "Confirm address":                 "confirm_address",
  "Client ETA update":               "client_eta_update",
  "ETA request":                     "eta_request",
  "Schedule confirmation":           "schedule_confirmation",
  "Job status reminder":             "job_status_reminder",
  "Confirm job completion":          "confirm_job_completion",
};

// ─── TemplatesView ────────────────────────────────────────────────────────────

type TemplateRow = {
  id: number;
  scenario: string;
  audience: string;
  title: string;
  body: string;
  updatedAt: Date | string;
};

function TemplateEditModal({
  template,
  onClose,
  onSaved,
  s,
}: {
  template: Partial<TemplateRow> & { scenario: string; audience: string };
  onClose: () => void;
  onSaved: () => void;
  s: Record<string, string>;
}) {
  const [title, setTitle] = useState(template.title ?? "");
  const [body, setBody] = useState(template.body ?? "");
  const [showPreview, setShowPreview] = useState(false);

  const upsert = trpc.callMatrix.upsertTemplate.useMutation({
    onSuccess: () => { onSaved(); onClose(); },
  });

  const samplePreview = body
    .replace(/\{\{firstName\}\}/g, "Sarah")
    .replace(/\{\{fullName\}\}/g, "Sarah Johnson")
    .replace(/\{\{phone\}\}/g, "+12025551234")
    .replace(/\{\{jobTime\}\}/g, "10:00 AM")
    .replace(/\{\{eta\}\}/g, "~25 min")
    .replace(/\{\{address\}\}/g, "1234 Oak St NW")
    .replace(/\{\{serviceType\}\}/g, "Deep Clean")
    .replace(/\{\{teamName\}\}/g, "Team Ana")
    .replace(/\{\{jobCount\}\}/g, "3");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "grid", placeItems: "center", zIndex: 1100 }}>
      <div style={{ background: "#171a21", border: "1px solid #2a3040", borderRadius: 20, padding: 28, width: 560, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.7)", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>{template.id ? "Edit template" : "New template"}</h2>
            <div style={{ fontSize: 12, color: s.muted, marginTop: 3 }}>
              {template.audience} · {template.scenario.replace(/_/g, " ")}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: s.muted, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Title */}
        <div>
          <label style={{ fontSize: 12, color: s.muted, display: "block", marginBottom: 5 }}>Template title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Team running late — customer"
            style={{ width: "100%", background: "#0f1115", border: `1px solid ${s.line}`, borderRadius: 10, color: s.text, padding: "10px 12px", fontSize: 13, outline: "none" }}
          />
        </div>

        {/* Body */}
        <div>
          <label style={{ fontSize: 12, color: s.muted, display: "block", marginBottom: 5 }}>Script body</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write the call script here. Use merge fields below to insert live job data."
            style={{ width: "100%", minHeight: 160, resize: "vertical", background: "#0f1115", border: `1px solid ${s.line}`, borderRadius: 10, color: s.text, padding: "10px 12px", fontSize: 13, fontFamily: "inherit", outline: "none", lineHeight: 1.5 }}
          />
        </div>

        {/* Merge field chips */}
        <div>
          <div style={{ fontSize: 12, color: s.muted, marginBottom: 6 }}>Click to insert merge field:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MERGE_FIELDS.map(f => (
              <button
                key={f}
                onClick={() => setBody(b => b + f)}
                style={{ fontSize: 11, background: "#1f2430", border: `1px solid ${s.line}`, borderRadius: 8, padding: "4px 8px", color: s.accent, cursor: "pointer", fontFamily: "monospace" }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Live preview toggle */}
        <div>
          <button
            onClick={() => setShowPreview(v => !v)}
            style={{ background: "none", border: "none", color: s.muted, cursor: "pointer", fontSize: 12, padding: 0 }}
          >
            {showPreview ? "▲ Hide preview" : "▼ Preview with sample values"}
          </button>
          {showPreview && (
            <div style={{ marginTop: 8, background: "#0d1520", border: `1px solid ${s.line}`, borderRadius: 12, padding: "12px 14px", fontSize: 13, color: s.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {samplePreview || <span style={{ color: s.muted }}>No preview yet</span>}
            </div>
          )}
        </div>

        {upsert.isError && (
          <div style={{ color: "#ff6b6b", fontSize: 12 }}>Error: {upsert.error?.message}</div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => upsert.mutate({ id: template.id, scenario: template.scenario, audience: template.audience as "customer" | "cleaner", title: title.trim() || template.scenario, body: body.trim() })}
            disabled={upsert.isPending || !body.trim()}
            style={{ flex: 1, border: 0, borderRadius: 12, padding: "12px 14px", fontWeight: 800, cursor: upsert.isPending ? "wait" : "pointer", color: "#111", background: s.good, fontSize: 14, opacity: upsert.isPending ? 0.7 : 1 }}
          >
            {upsert.isPending ? "Saving…" : "Save template"}
          </button>
          <button
            onClick={onClose}
            style={{ flex: 1, border: `1px solid ${s.line}`, borderRadius: 12, padding: "12px 14px", fontWeight: 800, cursor: "pointer", color: s.text, background: "#1f2430", fontSize: 14 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplatesView({ s }: { s: Record<string, string> }) {
  const { data: templates, isLoading, refetch } = trpc.callMatrix.getTemplates.useQuery(undefined, { staleTime: 30_000 });
  const deleteTemplate = trpc.callMatrix.deleteTemplate.useMutation({ onSuccess: () => refetch() });
  const [editTarget, setEditTarget] = useState<(Partial<TemplateRow> & { scenario: string; audience: string }) | null>(null);

  // All possible scenario+audience combos
  const allCombos: { scenario: string; audience: Audience; title: string }[] = [
    ...SCENARIOS.customer.map(sc => ({ scenario: SCENARIO_SLUG[sc.title] ?? sc.title, audience: "customer" as Audience, title: sc.title })),
    ...SCENARIOS.cleaner.map(sc  => ({ scenario: SCENARIO_SLUG[sc.title]  ?? sc.title,  audience: "cleaner"  as Audience, title: sc.title  })),
  ];

  const templateMap = new Map((templates ?? []).map(t => [`${t.scenario}|${t.audience}`, t]));

  return (
    <>
      <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 18, padding: 15 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 15, margin: 0, fontWeight: 700 }}>Call templates</h2>
            <p style={{ color: s.muted, fontSize: 12, margin: "4px 0 0" }}>One template per scenario. Use merge fields to insert live job data. The script auto-fills when you select a person + scenario on the Call Matrix tab.</p>
          </div>
        </div>

        {isLoading && <div style={{ color: s.muted, fontSize: 13 }}>Loading templates…</div>}

        <div style={{ display: "grid", gap: 8 }}>
          {allCombos.map(combo => {
            const key = `${combo.scenario}|${combo.audience}`;
            const existing = templateMap.get(key);
            return (
              <div key={key} style={{ background: s.dark, border: `1px solid ${existing ? s.line : "#2a1e00"}`, borderRadius: 14, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 13 }}>{combo.title}</b>
                    <span style={{ fontSize: 11, borderRadius: 999, padding: "2px 7px", background: combo.audience === "customer" ? "#0d1a2a" : "#1a0d2a", color: combo.audience === "customer" ? "#7bb7ff" : "#c4a0ff", border: `1px solid ${combo.audience === "customer" ? "#1a3a5a" : "#3a1a5a"}` }}>
                      {combo.audience}
                    </span>
                    {!existing && <span style={{ fontSize: 11, color: "#f3c96b" }}>No template yet</span>}
                  </div>
                  {existing && (
                    <div style={{ fontSize: 12, color: s.muted, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 380 }}>
                      {existing.body.slice(0, 80)}{existing.body.length > 80 ? "…" : ""}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => setEditTarget(existing ? { ...existing, updatedAt: String(existing.updatedAt) } : { scenario: combo.scenario, audience: combo.audience, title: combo.title })}
                    style={{ border: `1px solid ${s.line}`, borderRadius: 10, padding: "7px 12px", fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 12 }}
                  >
                    {existing ? "Edit" : "Create"}
                  </button>
                  {existing && (
                    <button
                      onClick={() => { if (confirm(`Delete template for "${combo.title}"?`)) deleteTemplate.mutate({ id: existing.id }); }}
                      style={{ border: "1px solid #633", borderRadius: 10, padding: "7px 12px", fontWeight: 800, cursor: "pointer", color: "#ff9999", background: "#1a0d0d", fontSize: 12 }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editTarget && (
        <TemplateEditModal
          template={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { refetch(); setEditTarget(null); }}
          s={s}
        />
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AICallMatrix() {
  const [date] = useState(() => todayET());
  const [view, setView] = useState<View>("matrix");
  const [audience, setAudience] = useState<Audience>("customer");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string>(SCENARIOS.customer[0].title);
  const [search, setSearch] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [script, setScript] = useState("");

  // Confirm dialog state
  const [showConfirm, setShowConfirm] = useState(false);

  // Call state
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [activeVapiCallId, setActiveVapiCallId] = useState<string | null>(null);
  const [callSummary, setCallSummary] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch real people data ──
  const { data, isLoading, error } = trpc.callMatrix.getPeople.useQuery({ date }, { staleTime: 60_000 });

  // ── Fetch templates ──
  const { data: templates } = trpc.callMatrix.getTemplates.useQuery(undefined, { staleTime: 30_000 });

  // ── Template lookup helper ──
  function scriptFromTemplate(person: PersonItem, scenarioTitle: string, aud: Audience): string {
    const slug = SCENARIO_SLUG[scenarioTitle] ?? scenarioTitle;
    const tmpl = (templates ?? []).find(t => t.scenario === slug && t.audience === aud);
    if (tmpl) return applyMergeFields(tmpl.body, person, aud);
    return buildScript(person, scenarioTitle, aud);
  }

  // ── tRPC mutations ──
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
    onError: (err) => {
      setCallStatus("failed");
      showFlash(`Call failed: ${err.message}`);
    },
  });

  // ── Polling ──
  const pollCallQuery = trpc.callMatrix.pollCall.useQuery(
    { vapiCallId: activeVapiCallId ?? "" },
    { enabled: false, staleTime: 0 }
  );
  const utils = trpc.useUtils();

  function startPolling(vapiCallId: string) {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const result = await utils.callMatrix.pollCall.fetch({ vapiCallId });
        const s = result.status as CallStatus;
        setCallStatus(s);
        if (result.summary) setCallSummary(result.summary);
        if (s === "completed" || s === "voicemail" || s === "no_answer" || s === "failed") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } catch {
        // ignore poll errors silently
      }
    }, 5000);
  }

  useEffect(() => {
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, []);

  // Build unified person lists
  const customerItems: PersonItem[] = useMemo(() => (data?.customers ?? []).map(customerToItem), [data]);
  const cleanerItems: PersonItem[]  = useMemo(() => (data?.cleaners  ?? []).map(cleanerToItem),  [data]);
  const allItems = audience === "customer" ? customerItems : cleanerItems;

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return allItems.filter(p => (p.name + p.meta + p.risk).toLowerCase().includes(q));
  }, [allItems, search]);

  const selectedPerson: PersonItem | null = useMemo(() => {
    if (selectedId) {
      const found = allItems.find(p => p.id === selectedId);
      if (found) return found;
    }
    return allItems[0] ?? null;
  }, [selectedId, allItems]);

  // ── helpers ──
  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 4000);
  }

  function selectPerson(item: PersonItem) {
    setSelectedId(item.id);
    setScript(scriptFromTemplate(item, selectedScenario, audience));
    setCallStatus("idle");
    setActiveVapiCallId(null);
    setCallSummary(null);
  }

  function selectScenario(type: Audience, title: string) {
    setAudience(type);
    setSelectedScenario(title);
    const items = type === "customer" ? customerItems : cleanerItems;
    const first = items[0] ?? null;
    if (first) {
      setSelectedId(first.id);
      setScript(scriptFromTemplate(first, title, type));
    }
    setCallStatus("idle");
    setActiveVapiCallId(null);
    setCallSummary(null);
  }

  function switchAudience(type: Audience) {
    setAudience(type);
    const firstScenario = SCENARIOS[type][0].title;
    setSelectedScenario(firstScenario);
    const items = type === "customer" ? customerItems : cleanerItems;
    const first = items[0] ?? null;
    if (first) {
      setSelectedId(first.id);
      setScript(scriptFromTemplate(first, firstScenario, type));
    } else {
      setSelectedId(null);
      setScript("");
    }
    setCallStatus("idle");
    setActiveVapiCallId(null);
    setCallSummary(null);
  }

  // Ensure script is set once data loads (or templates load)
  useMemo(() => {
    if (!script && selectedPerson) {
      setScript(scriptFromTemplate(selectedPerson, selectedScenario, audience));
    }
  }, [selectedPerson, templates]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleStartCall() {
    if (!selectedPerson) return showFlash("Select a person first.");
    if (!selectedPerson.phone) return showFlash(`No phone number on file for ${selectedPerson.name}.`);
    if (!script.trim()) return showFlash("Script is empty — add a message first.");
    if (callStatus === "firing" || callStatus === "queued" || callStatus === "ringing" || callStatus === "in_progress") {
      return showFlash("A call is already in progress.");
    }
    // Show confirmation dialog instead of firing immediately
    setShowConfirm(true);
  }

  function confirmAndFire() {
    if (!selectedPerson) return;
    setShowConfirm(false);
    setCallStatus("firing");
    setCallSummary(null);
    startCallMutation.mutate({
      cleanerJobId: selectedPerson.cleanerJobId || 1, // fallback for cleaner rows
      jobDate: date,
      personName: selectedPerson.name,
      phone: selectedPerson.phone,
      scenario: selectedScenario,
      script: script.trim(),
      audience,
    });
  }

  // ── Styles ──
  const s = {
    bg: "#0f1115", panel: "#171a21", panel2: "#1f2430", muted: "#8f98aa",
    text: "#f4f6fb", line: "#2a3040", accent: "#f3c96b", good: "#63d297",
    blue: "#7bb7ff", dark: "#121620",
  };

  // ── Sidebar metrics ──
  const callsNeeded = (data?.customers.filter(c => c.risk !== "On track").length ?? 0) + (data?.cleaners.filter(cl => cl.risk !== "On track").length ?? 0);
  const lateTeams = data?.cleaners.filter(cl => cl.risk === "Urgent" || cl.risk === "No check-in").length ?? 0;
  const unconfirmed = data?.cleaners.filter(cl => cl.hasUnconfirmed).length ?? 0;
  const photoMissing = data?.cleaners.filter(cl => cl.hasPhotoMissing).length ?? 0;

  const callActive = callStatus !== "idle" && callStatus !== "completed" && callStatus !== "voicemail" && callStatus !== "no_answer" && callStatus !== "failed";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "270px 1fr 390px", minHeight: "100vh", background: s.bg, color: s.text, fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}>

      {/* ── LEFT SIDEBAR ── */}
      <aside style={{ background: "#0b0d11", borderRight: `1px solid ${s.line}`, padding: 18, display: "flex", flexDirection: "column", gap: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 18, marginBottom: 22 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#111,#333)", display: "grid", placeItems: "center", color: s.accent, border: "1px solid #3b3b3b", flexShrink: 0 }}>M</div>
          <div>Maids in Black<br /><span style={{ color: s.muted, fontSize: 13, fontWeight: 400 }}>AI Call Matrix</span></div>
        </div>

        <nav style={{ display: "grid", gap: 2 }}>
          {(["matrix", "queue", "history", "settings"] as View[]).map((v, i) => {
            const labels = ["Call Matrix", "Smart Queue", "Call History", "Templates"];
            const active = view === v;
            return (
              <button key={v} onClick={() => setView(v)} style={{ width: "100%", textAlign: "left", background: active ? s.panel : "transparent", color: active ? s.text : s.muted, border: 0, padding: "12px 10px", borderRadius: 12, fontWeight: 650, cursor: "pointer", fontSize: 14 }}>
                {labels[i]}
              </button>
            );
          })}
        </nav>

        <div style={{ marginTop: 18, padding: 14, border: `1px solid ${s.line}`, borderRadius: 16, background: s.panel }}>
          {[
            ["Calls needed",       String(callsNeeded)],
            ["Late team alerts",   String(lateTeams)],
            ["Unconfirmed teams",  String(unconfirmed)],
            ["Photos missing",     String(photoMissing)],
          ].map(([label, val], i, arr) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < arr.length - 1 ? `1px solid ${s.line}` : "none", fontSize: 13 }}>
              <span>{label}</span><b>{isLoading ? "…" : val}</b>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14, padding: 14, border: `1px solid ${s.line}`, borderRadius: 16, background: s.panel }}>
          <b style={{ fontSize: 13 }}>Smart rules</b>
          <p style={{ color: s.muted, fontSize: 12, margin: "8px 0 0", lineHeight: 1.45 }}>
            Auto-suggests the best call based on job time, card status, cleaner check-in, address notes, and customer sensitivity.
          </p>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main style={{ padding: "18px 22px", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, margin: 0, fontWeight: 800 }}>
              {{ matrix: "AI Call Matrix", queue: "Smart Queue", history: "Call History", settings: "Templates" }[view]}
            </h1>
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
              onClick={() => {
                const urgent = customerItems.find(c => c.risk !== "On track");
                if (urgent) {
                  setAudience("customer");
                  setSelectedId(urgent.id);
                  setSelectedScenario("Put card on file");
                  setScript(buildScript(urgent, "Put card on file", "customer"));
                  setView("matrix");
                  showFlash(`Smart Pick: ${urgent.name} — ${urgent.risk}`);
                } else {
                  showFlash("No urgent calls found for today.");
                }
              }}
              style={{ border: `1px solid ${s.line}`, borderRadius: 12, padding: "11px 14px", fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 13 }}
            >
              Smart Pick
            </button>
          </div>
        </div>

        {isLoading && <div style={{ color: s.muted, fontSize: 13, padding: "20px 0" }}>Loading today's jobs…</div>}
        {error && <div style={{ color: "#ff6b6b", fontSize: 13, padding: "20px 0" }}>Error loading jobs: {error.message}</div>}

        {/* ── MATRIX VIEW ── */}
        {view === "matrix" && !isLoading && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              {(["customer", "cleaner"] as Audience[]).map(type => (
                <div key={type} style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 18, padding: 15 }}>
                  <h2 style={{ fontSize: 15, margin: "0 0 12px", fontWeight: 700 }}>
                    {type === "customer" ? "Customer call reasons" : "Cleaner call reasons"}
                  </h2>
                  <div style={{ display: "grid", gap: 10 }}>
                    {SCENARIOS[type].map(sc => {
                      const active = selectedScenario === sc.title && audience === type;
                      return (
                        <div key={sc.title} onClick={() => selectScenario(type, sc.title)} style={{ padding: 13, border: `1px solid ${active ? s.accent : s.line}`, borderRadius: 15, background: active ? "#1d1b14" : s.dark, cursor: "pointer", transition: "border-color .15s, background .15s" }}>
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

            <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 18, padding: 15 }}>
              <h2 style={{ fontSize: 15, margin: "0 0 12px", fontWeight: 700 }}>People needing calls</h2>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {(["customer", "cleaner"] as Audience[]).map(type => {
                  const active = audience === type;
                  return (
                    <button key={type} onClick={() => switchAudience(type)} style={{ background: active ? s.accent : s.dark, color: active ? "#111" : s.muted, border: `1px solid ${active ? s.accent : s.line}`, padding: "9px 11px", borderRadius: 999, cursor: "pointer", fontWeight: 800, fontSize: 12 }}>
                      {type === "customer" ? `Customers (${customerItems.length})` : `Cleaners (${cleanerItems.length})`}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "grid", gap: 8, maxHeight: 390, overflowY: "auto", paddingRight: 3 }}>
                {filteredItems.map(p => {
                  const active = selectedPerson?.id === p.id;
                  return (
                    <div key={p.id} onClick={() => selectPerson(p)} style={{ display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 10, alignItems: "center", padding: 11, border: `1px solid ${active ? s.blue : s.line}`, borderRadius: 15, background: active ? "#132033" : s.dark, cursor: "pointer" }}>
                      <Initials name={p.name} />
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: s.muted, marginTop: 2 }}>{p.meta}</div>
                      </div>
                      <StatusBadge risk={p.risk} />
                    </div>
                  );
                })}
                {filteredItems.length === 0 && !isLoading && (
                  <div style={{ color: s.muted, fontSize: 13, padding: "12px 0" }}>
                    {allItems.length === 0 ? "No jobs found for today." : `No results for "${search}"`}
                  </div>
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
              <div key={row.name} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", border: `1px solid ${s.line}`, background: s.dark, borderRadius: 14, padding: 10, marginBottom: 8 }}>
                <div>
                  <b style={{ fontSize: 14 }}>{row.name}</b>
                  <div style={{ fontSize: 12, color: s.muted, marginTop: 2 }}>{row.reason}</div>
                </div>
                <button onClick={() => { setView("matrix"); showFlash(`Loaded ${row.name} from smart queue.`); }} style={{ border: `1px solid ${s.line}`, borderRadius: 12, padding: "9px 14px", fontWeight: 800, cursor: "pointer", color: s.text, background: s.panel2, fontSize: 12 }}>
                  Load
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── CALL HISTORY VIEW ── */}
        {view === "history" && <CallHistoryView s={s} />}

        {/* ── TEMPLATES VIEW ── */}
        {view === "settings" && <TemplatesView s={s} />}
      </main>

      {/* ── RIGHT PANEL ── */}
      <section style={{ background: "#11141b", borderLeft: `1px solid ${s.line}`, padding: 18, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
        <div style={{ background: s.panel, border: `1px solid ${s.line}`, borderRadius: 20, padding: 16 }}>
          {selectedPerson ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>{selectedPerson.name}</div>
                  <div style={{ fontSize: 12, color: s.muted, marginTop: 2 }}>{selectedPerson.meta}</div>
                  <div style={{ marginTop: 8, color: s.accent, fontSize: 13, fontWeight: 800 }}>{selectedScenario}</div>
                  {selectedPerson.phone && (
                    <div style={{ marginTop: 4, color: s.muted, fontSize: 12 }}>{selectedPerson.phone}</div>
                  )}
                </div>
                <Tag label={selectedPerson.risk} hot={selectedPerson.risk.toLowerCase().includes("high") || selectedPerson.risk.toLowerCase().includes("urgent")} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
                {[
                  { label: "Job time", value: selectedPerson.jobTime },
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

              <textarea
                value={script}
                onChange={e => setScript(e.target.value)}
                placeholder="Edit the call script here before starting the call…"
                style={{ width: "100%", minHeight: 150, resize: "vertical", lineHeight: 1.45, marginTop: 10, background: "#11151d", border: `1px solid ${s.line}`, borderRadius: 12, color: s.text, padding: "11px 12px", outline: "none", fontSize: 13, fontFamily: "inherit" }}
              />

              {/* Call status indicator */}
              {callStatus !== "idle" && (
                <div style={{ marginTop: 10, padding: "10px 12px", background: "#0d1520", border: `1px solid ${STATUS_COLORS[callStatus]}33`, borderRadius: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  {callActive && (
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[callStatus], animation: "pulse 1.2s infinite" }} />
                  )}
                  <span style={{ fontSize: 13, color: STATUS_COLORS[callStatus], fontWeight: 700 }}>{STATUS_LABELS[callStatus]}</span>
                </div>
              )}

              {/* Call summary after completion */}
              {callSummary && (
                <div style={{ marginTop: 10, padding: "10px 12px", background: "#0d1a12", border: "1px solid #285b3a", borderRadius: 12 }}>
                  <div style={{ fontSize: 11, color: s.muted, marginBottom: 4 }}>Call summary</div>
                  <div style={{ fontSize: 13, color: "#b9ffd4", lineHeight: 1.4 }}>{callSummary}</div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                <button
                  onClick={handleStartCall}
                  disabled={callActive || startCallMutation.isPending}
                  style={{ border: 0, borderRadius: 12, padding: "11px 14px", fontWeight: 800, cursor: callActive ? "not-allowed" : "pointer", color: "#111", background: callActive ? "#3a5a3a" : s.good, fontSize: 13, opacity: callActive ? 0.7 : 1 }}
                >
                  {callActive ? STATUS_LABELS[callStatus] : "Start AI Call"}
                </button>
                <button
                  onClick={() => {
                    setScript(prev => prev.replace("I'm sorry, but", "I wanted to personally update you —").replace("we still need", "we just need"));
                    showFlash("Script rewritten with a softer tone.");
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
                  onClick={() => {
                    setCallStatus("idle");
                    setActiveVapiCallId(null);
                    setCallSummary(null);
                    showFlash("Marked done. Summary added to job record.");
                  }}
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

              {flash && (
                <div style={{ marginTop: 12, background: "#101e15", border: "1px solid #285b3a", color: "#b9ffd4", borderRadius: 14, padding: 12, fontSize: 13 }}>
                  {flash}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: s.muted, fontSize: 13, padding: "12px 0" }}>
              {isLoading ? "Loading…" : "Select a person from the list to see their call script."}
            </div>
          )}
        </div>

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

        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
      </section>

      {/* ── CONFIRM CALL DIALOG ── */}
      {showConfirm && selectedPerson && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 1000 }}>
          <div style={{ background: "#171a21", border: "1px solid #2a3040", borderRadius: 20, padding: 28, width: 480, maxWidth: "92vw", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 900 }}>Confirm AI call</h2>
            <p style={{ margin: "0 0 16px", color: "#8f98aa", fontSize: 13 }}>
              Calling <b style={{ color: "#f4f6fb" }}>{selectedPerson.name}</b> at <b style={{ color: "#f4f6fb" }}>{selectedPerson.phone}</b> for <b style={{ color: "#f3c96b" }}>{selectedScenario}</b>
            </p>

            <div style={{ background: "#0f1115", border: "1px solid #2a3040", borderRadius: 14, padding: 14, marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: "#8f98aa", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Script Ava will read</div>
              <div style={{ fontSize: 13, color: "#f4f6fb", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>{script}</div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={confirmAndFire}
                style={{ flex: 1, border: 0, borderRadius: 12, padding: "12px 14px", fontWeight: 800, cursor: "pointer", color: "#111", background: "#63d297", fontSize: 14 }}
              >
                Yes, start call
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                style={{ flex: 1, border: "1px solid #2a3040", borderRadius: 12, padding: "12px 14px", fontWeight: 800, cursor: "pointer", color: "#f4f6fb", background: "#1f2430", fontSize: 14 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

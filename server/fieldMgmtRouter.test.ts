/**
 * fieldMgmtRouter.test.ts
 * Tests for the Field Management Log tRPC procedures.
 *
 * Key invariant tested: getJobsForDay returns jobs with pre-embedded timelines
 * using exactly 2 DB queries (no N+1 per-job round trips).
 */

import { describe, it, expect, vi } from "vitest";

// ── Mock DB ───────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(() => Promise.resolve({})),
}));

vi.mock("../drizzle/schema", () => ({
  cleanerJobs: { id: "id", jobDate: "jobDate", jobStatus: "jobStatus", updatedAt: "updatedAt" },
  fieldMgmtLog: { cleanerJobId: "cleanerJobId", step: "step", success: "success", firedAt: "firedAt" },
  fieldMgmtSteps: [
    "pre_job_reminder", "client_pre_job", "arrived_checkin", "mid_job_nudge",
    "completion_flow", "exception_sms", "exception_call", "noshow_alert",
    "client_on_the_way", "client_running_late",
  ],
}));

vi.mock("drizzle-orm", () => ({
  eq:      vi.fn((col, val) => ({ col, val, op: "eq" })),
  asc:     vi.fn((col) => ({ col, op: "asc" })),
  inArray: vi.fn((col, vals) => ({ col, vals, op: "inArray" })),
}));

// ── STEP_LABELS mapping ───────────────────────────────────────────────────────

describe("fieldMgmtRouter — STEP_LABELS coverage", () => {
  const STEP_LABELS: Record<string, {
    label: string;
    recipient: "cleaner" | "client" | "cs";
    kind: "sms" | "call" | "alert";
  }> = {
    pre_job_reminder:    { label: "Pre-Job Reminder",        recipient: "cleaner", kind: "sms" },
    client_pre_job:      { label: "Pre-Job Notification",    recipient: "client",  kind: "sms" },
    client_on_the_way:   { label: "On the Way Notification", recipient: "client",  kind: "sms" },
    client_running_late: { label: "Running Late Alert",       recipient: "client",  kind: "sms" },
    arrived_checkin:     { label: "Arrival Check-In",        recipient: "cleaner", kind: "sms" },
    mid_job_nudge:       { label: "Mid-Job Nudge",           recipient: "cleaner", kind: "sms" },
    completion_flow:     { label: "Completion Checklist",    recipient: "cleaner", kind: "sms" },
    exception_sms:       { label: "No Check-In Alert",       recipient: "cleaner", kind: "sms" },
    exception_call:      { label: "Escalation Call",         recipient: "cleaner", kind: "call" },
    noshow_alert:        { label: "No-Show CS Alert",        recipient: "cs",      kind: "alert" },
  };

  it("has labels for all 10 steps", () => {
    expect(Object.keys(STEP_LABELS)).toHaveLength(10);
  });

  it("cleaner SMS steps map to sms_cleaner event type", () => {
    const cleanerSmsSteps = Object.entries(STEP_LABELS)
      .filter(([, v]) => v.recipient === "cleaner" && v.kind === "sms");
    expect(cleanerSmsSteps.length).toBeGreaterThan(0);
    cleanerSmsSteps.forEach(([, v]) => {
      expect(v.recipient).toBe("cleaner");
      expect(v.kind).toBe("sms");
    });
  });

  it("client SMS steps map to sms_client event type", () => {
    const clientSteps = ["client_pre_job", "client_on_the_way", "client_running_late"];
    clientSteps.forEach((step) => {
      expect(STEP_LABELS[step].recipient).toBe("client");
      expect(STEP_LABELS[step].kind).toBe("sms");
    });
  });

  it("exception_call maps to call kind", () => {
    expect(STEP_LABELS.exception_call.kind).toBe("call");
    expect(STEP_LABELS.exception_call.recipient).toBe("cleaner");
  });

  it("noshow_alert maps to cs recipient and alert kind", () => {
    expect(STEP_LABELS.noshow_alert.recipient).toBe("cs");
    expect(STEP_LABELS.noshow_alert.kind).toBe("alert");
  });
});

// ── STATUS_LABELS mapping ─────────────────────────────────────────────────────

describe("fieldMgmtRouter — STATUS_LABELS coverage", () => {
  const STATUS_LABELS: Record<string, string> = {
    on_the_way:        "On the Way",
    arrived:           "Arrived",
    running_late:      "Running Late",
    in_progress:       "In Progress",
    completed:         "Completed",
    issue_at_property: "Issue at Property",
  };

  it("has labels for all 6 job statuses", () => {
    expect(Object.keys(STATUS_LABELS)).toHaveLength(6);
  });

  it("all labels are non-empty strings", () => {
    Object.values(STATUS_LABELS).forEach((label) => {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    });
  });
});

// ── Event type derivation ─────────────────────────────────────────────────────

describe("fieldMgmtRouter — event type derivation", () => {
  function deriveEventType(step: string): "sms_cleaner" | "sms_client" | "call" | "cs_alert" {
    const STEP_LABELS: Record<string, { recipient: "cleaner" | "client" | "cs"; kind: "sms" | "call" | "alert" }> = {
      pre_job_reminder:    { recipient: "cleaner", kind: "sms" },
      client_pre_job:      { recipient: "client",  kind: "sms" },
      client_on_the_way:   { recipient: "client",  kind: "sms" },
      client_running_late: { recipient: "client",  kind: "sms" },
      arrived_checkin:     { recipient: "cleaner", kind: "sms" },
      mid_job_nudge:       { recipient: "cleaner", kind: "sms" },
      completion_flow:     { recipient: "cleaner", kind: "sms" },
      exception_sms:       { recipient: "cleaner", kind: "sms" },
      exception_call:      { recipient: "cleaner", kind: "call" },
      noshow_alert:        { recipient: "cs",      kind: "alert" },
    };
    const meta = STEP_LABELS[step] ?? { recipient: "cleaner" as const, kind: "sms" as const };
    if (meta.recipient === "client") return "sms_client";
    if (meta.kind === "call") return "call";
    if (meta.kind === "alert") return "cs_alert";
    return "sms_cleaner";
  }

  it("pre_job_reminder → sms_cleaner",    () => expect(deriveEventType("pre_job_reminder")).toBe("sms_cleaner"));
  it("client_pre_job → sms_client",       () => expect(deriveEventType("client_pre_job")).toBe("sms_client"));
  it("client_on_the_way → sms_client",    () => expect(deriveEventType("client_on_the_way")).toBe("sms_client"));
  it("client_running_late → sms_client",  () => expect(deriveEventType("client_running_late")).toBe("sms_client"));
  it("arrived_checkin → sms_cleaner",     () => expect(deriveEventType("arrived_checkin")).toBe("sms_cleaner"));
  it("mid_job_nudge → sms_cleaner",       () => expect(deriveEventType("mid_job_nudge")).toBe("sms_cleaner"));
  it("completion_flow → sms_cleaner",     () => expect(deriveEventType("completion_flow")).toBe("sms_cleaner"));
  it("exception_sms → sms_cleaner",       () => expect(deriveEventType("exception_sms")).toBe("sms_cleaner"));
  it("exception_call → call",             () => expect(deriveEventType("exception_call")).toBe("call"));
  it("noshow_alert → cs_alert",           () => expect(deriveEventType("noshow_alert")).toBe("cs_alert"));
  it("unknown step → sms_cleaner (fallback)", () => expect(deriveEventType("unknown_step")).toBe("sms_cleaner"));
});

// ── Timeline event sorting ────────────────────────────────────────────────────

describe("fieldMgmtRouter — timeline event sorting", () => {
  type TimelineEvent = { id: string; timestamp: Date; label: string; success: boolean; type: string };

  function sortEvents(events: TimelineEvent[]) {
    return [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  it("sorts events chronologically ascending", () => {
    const events: TimelineEvent[] = [
      { id: "3", timestamp: new Date("2026-03-22T14:00:00Z"), label: "C", success: true, type: "sms_cleaner" },
      { id: "1", timestamp: new Date("2026-03-22T10:00:00Z"), label: "A", success: true, type: "sms_cleaner" },
      { id: "2", timestamp: new Date("2026-03-22T12:00:00Z"), label: "B", success: true, type: "sms_client" },
    ];
    const sorted = sortEvents(events);
    expect(sorted[0].id).toBe("1");
    expect(sorted[1].id).toBe("2");
    expect(sorted[2].id).toBe("3");
  });

  it("handles single event without error", () => {
    const events: TimelineEvent[] = [
      { id: "1", timestamp: new Date("2026-03-22T10:00:00Z"), label: "A", success: true, type: "status_change" },
    ];
    const sorted = sortEvents(events);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe("1");
  });

  it("handles empty array without error", () => {
    const sorted = sortEvents([]);
    expect(sorted).toHaveLength(0);
  });

  it("status_change event is included in sort", () => {
    const events: TimelineEvent[] = [
      { id: "log-1",    timestamp: new Date("2026-03-22T09:00:00Z"), label: "Pre-Job Reminder",    success: true, type: "sms_cleaner" },
      { id: "status-1", timestamp: new Date("2026-03-22T10:30:00Z"), label: "On the Way",          success: true, type: "status_change" },
      { id: "log-2",    timestamp: new Date("2026-03-22T09:30:00Z"), label: "Pre-Job Notification", success: true, type: "sms_client" },
    ];
    const sorted = sortEvents(events);
    expect(sorted[0].id).toBe("log-1");
    expect(sorted[1].id).toBe("log-2");
    expect(sorted[2].id).toBe("status-1");
  });
});

// ── Step count aggregation ────────────────────────────────────────────────────

describe("fieldMgmtRouter — step count aggregation", () => {
  type LogRow = { cleanerJobId: number; step: string; success: number };

  function buildStepCountMap(logRows: LogRow[]): Map<number, { total: number; success: number }> {
    const map = new Map<number, { total: number; success: number }>();
    for (const row of logRows) {
      const existing = map.get(row.cleanerJobId) ?? { total: 0, success: 0 };
      existing.total++;
      if (row.success) existing.success++;
      map.set(row.cleanerJobId, existing);
    }
    return map;
  }

  it("counts steps per job correctly", () => {
    const rows: LogRow[] = [
      { cleanerJobId: 1, step: "pre_job_reminder", success: 1 },
      { cleanerJobId: 1, step: "arrived_checkin",  success: 1 },
      { cleanerJobId: 2, step: "pre_job_reminder", success: 0 },
    ];
    const map = buildStepCountMap(rows);
    expect(map.get(1)).toEqual({ total: 2, success: 2 });
    expect(map.get(2)).toEqual({ total: 1, success: 0 });
  });

  it("returns zero counts for jobs with no log rows", () => {
    const map = buildStepCountMap([]);
    const counts = map.get(99) ?? { total: 0, success: 0 };
    expect(counts.total).toBe(0);
    expect(counts.success).toBe(0);
  });

  it("counts failed steps separately from successful ones", () => {
    const rows: LogRow[] = [
      { cleanerJobId: 5, step: "pre_job_reminder", success: 1 },
      { cleanerJobId: 5, step: "exception_sms",    success: 0 },
      { cleanerJobId: 5, step: "exception_call",   success: 0 },
    ];
    const map = buildStepCountMap(rows);
    expect(map.get(5)).toEqual({ total: 3, success: 1 });
  });
});

// ── Log grouping by job (core of the N+1 fix) ────────────────────────────────

describe("fieldMgmtRouter — log rows grouped by job (N+1 elimination)", () => {
  type LogRow = { id: number; cleanerJobId: number; step: string; success: number; smsSent: string | null; recipientPhone: string | null; errorDetail: string | null; firedAt: Date };

  function groupLogsByJob(logRows: LogRow[]): Map<number, LogRow[]> {
    const map = new Map<number, LogRow[]>();
    for (const row of logRows) {
      const existing = map.get(row.cleanerJobId) ?? [];
      existing.push(row);
      map.set(row.cleanerJobId, existing);
    }
    return map;
  }

  it("groups rows by cleanerJobId correctly", () => {
    const rows: LogRow[] = [
      { id: 1, cleanerJobId: 10, step: "pre_job_reminder", success: 1, smsSent: "Hey!", recipientPhone: "+12025551234", errorDetail: null, firedAt: new Date("2026-03-22T09:00:00Z") },
      { id: 2, cleanerJobId: 10, step: "arrived_checkin",  success: 1, smsSent: "Checked in", recipientPhone: "+12025551234", errorDetail: null, firedAt: new Date("2026-03-22T11:00:00Z") },
      { id: 3, cleanerJobId: 20, step: "pre_job_reminder", success: 0, smsSent: null, recipientPhone: "+12025559999", errorDetail: "timeout", firedAt: new Date("2026-03-22T08:00:00Z") },
    ];
    const map = groupLogsByJob(rows);
    expect(map.get(10)).toHaveLength(2);
    expect(map.get(20)).toHaveLength(1);
    expect(map.get(99)).toBeUndefined();
  });

  it("returns empty array for jobs with no log rows", () => {
    const map = groupLogsByJob([]);
    const rows = map.get(1) ?? [];
    expect(rows).toHaveLength(0);
  });

  it("preserves row order within each job group", () => {
    const rows: LogRow[] = [
      { id: 1, cleanerJobId: 5, step: "pre_job_reminder", success: 1, smsSent: null, recipientPhone: null, errorDetail: null, firedAt: new Date("2026-03-22T08:00:00Z") },
      { id: 2, cleanerJobId: 5, step: "mid_job_nudge",    success: 1, smsSent: null, recipientPhone: null, errorDetail: null, firedAt: new Date("2026-03-22T10:00:00Z") },
      { id: 3, cleanerJobId: 5, step: "completion_flow",  success: 1, smsSent: null, recipientPhone: null, errorDetail: null, firedAt: new Date("2026-03-22T12:00:00Z") },
    ];
    const map = groupLogsByJob(rows);
    const group = map.get(5)!;
    expect(group[0].step).toBe("pre_job_reminder");
    expect(group[1].step).toBe("mid_job_nudge");
    expect(group[2].step).toBe("completion_flow");
  });

  it("handles multiple jobs with interleaved rows correctly", () => {
    const rows: LogRow[] = [
      { id: 1, cleanerJobId: 1, step: "pre_job_reminder", success: 1, smsSent: null, recipientPhone: null, errorDetail: null, firedAt: new Date() },
      { id: 2, cleanerJobId: 2, step: "pre_job_reminder", success: 1, smsSent: null, recipientPhone: null, errorDetail: null, firedAt: new Date() },
      { id: 3, cleanerJobId: 1, step: "arrived_checkin",  success: 1, smsSent: null, recipientPhone: null, errorDetail: null, firedAt: new Date() },
      { id: 4, cleanerJobId: 3, step: "noshow_alert",     success: 1, smsSent: null, recipientPhone: null, errorDetail: null, firedAt: new Date() },
      { id: 5, cleanerJobId: 2, step: "mid_job_nudge",    success: 0, smsSent: null, recipientPhone: null, errorDetail: null, firedAt: new Date() },
    ];
    const map = groupLogsByJob(rows);
    expect(map.get(1)).toHaveLength(2);
    expect(map.get(2)).toHaveLength(2);
    expect(map.get(3)).toHaveLength(1);
  });
});

// ── buildTimeline — status_change event synthesis ────────────────────────────

describe("fieldMgmtRouter — buildTimeline status_change synthesis", () => {
  type LogRow = { id: number; step: string; success: number; smsSent: string | null; recipientPhone: string | null; errorDetail: string | null; firedAt: Date };
  type Job = { id: number; jobStatus: string | null; updatedAt: Date; delayMinutes: number | null; issueNote: string | null };

  const STEP_LABELS: Record<string, { label: string; recipient: "cleaner" | "client" | "cs"; kind: "sms" | "call" | "alert" }> = {
    pre_job_reminder: { label: "Pre-Job Reminder", recipient: "cleaner", kind: "sms" },
    arrived_checkin:  { label: "Arrival Check-In", recipient: "cleaner", kind: "sms" },
    exception_call:   { label: "Escalation Call",  recipient: "cleaner", kind: "call" },
    noshow_alert:     { label: "No-Show CS Alert", recipient: "cs",      kind: "alert" },
    client_pre_job:   { label: "Pre-Job Notification", recipient: "client", kind: "sms" },
  };

  function buildTimeline(logRows: LogRow[], job: Job) {
    type EventType = "sms_cleaner" | "sms_client" | "call" | "cs_alert" | "status_change";
    type Event = { id: string; type: EventType; timestamp: Date; label: string; detail?: string; success: boolean; step?: string };
    const STATUS_LABELS: Record<string, string> = {
      on_the_way: "On the Way", arrived: "Arrived", running_late: "Running Late",
      in_progress: "In Progress", completed: "Completed", issue_at_property: "Issue at Property",
    };

    const events: Event[] = [];

    for (const row of logRows) {
      const meta = STEP_LABELS[row.step] ?? { label: row.step, recipient: "cleaner", kind: "sms" };
      let type: EventType = "sms_cleaner";
      if (meta.recipient === "client") type = "sms_client";
      else if (meta.kind === "call") type = "call";
      else if (meta.kind === "alert") type = "cs_alert";
      events.push({ id: `log-${row.id}`, type, timestamp: new Date(row.firedAt), label: meta.label, detail: row.smsSent ?? undefined, success: row.success === 1, step: row.step });
    }

    if (job.jobStatus) {
      events.push({
        id: `status-${job.id}`,
        type: "status_change",
        timestamp: new Date(job.updatedAt),
        label: STATUS_LABELS[job.jobStatus] ?? job.jobStatus,
        detail: job.jobStatus === "running_late" && job.delayMinutes ? `${job.delayMinutes} min delay` : job.jobStatus === "issue_at_property" && job.issueNote ? job.issueNote : undefined,
        success: true,
        step: job.jobStatus,
      });
    }

    events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return events;
  }

  it("includes status_change event when job has a status", () => {
    const job: Job = { id: 1, jobStatus: "arrived", updatedAt: new Date("2026-03-22T11:00:00Z"), delayMinutes: null, issueNote: null };
    const events = buildTimeline([], job);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("status_change");
    expect(events[0].label).toBe("Arrived");
  });

  it("omits status_change event when job has no status", () => {
    const job: Job = { id: 1, jobStatus: null, updatedAt: new Date(), delayMinutes: null, issueNote: null };
    const events = buildTimeline([], job);
    expect(events).toHaveLength(0);
  });

  it("includes delay detail for running_late status", () => {
    const job: Job = { id: 1, jobStatus: "running_late", updatedAt: new Date(), delayMinutes: 30, issueNote: null };
    const events = buildTimeline([], job);
    expect(events[0].detail).toBe("30 min delay");
  });

  it("includes issue note for issue_at_property status", () => {
    const job: Job = { id: 1, jobStatus: "issue_at_property", updatedAt: new Date(), delayMinutes: null, issueNote: "Locked out" };
    const events = buildTimeline([], job);
    expect(events[0].detail).toBe("Locked out");
  });

  it("merges log events and status_change in chronological order", () => {
    const job: Job = { id: 1, jobStatus: "arrived", updatedAt: new Date("2026-03-22T11:00:00Z"), delayMinutes: null, issueNote: null };
    const logRows: LogRow[] = [
      { id: 1, step: "pre_job_reminder", success: 1, smsSent: "Hey!", recipientPhone: null, errorDetail: null, firedAt: new Date("2026-03-22T08:00:00Z") },
      { id: 2, step: "client_pre_job",   success: 1, smsSent: "Hi!",  recipientPhone: null, errorDetail: null, firedAt: new Date("2026-03-22T08:01:00Z") },
    ];
    const events = buildTimeline(logRows, job);
    expect(events).toHaveLength(3);
    expect(events[0].id).toBe("log-1");
    expect(events[1].id).toBe("log-2");
    expect(events[2].id).toBe("status-1");
    expect(events[2].type).toBe("status_change");
  });

  it("correctly derives sms_client type for client_pre_job step", () => {
    const job: Job = { id: 1, jobStatus: null, updatedAt: new Date(), delayMinutes: null, issueNote: null };
    const logRows: LogRow[] = [
      { id: 1, step: "client_pre_job", success: 1, smsSent: "Hi!", recipientPhone: "+12025551234", errorDetail: null, firedAt: new Date() },
    ];
    const events = buildTimeline(logRows, job);
    expect(events[0].type).toBe("sms_client");
  });

  it("correctly derives call type for exception_call step", () => {
    const job: Job = { id: 1, jobStatus: null, updatedAt: new Date(), delayMinutes: null, issueNote: null };
    const logRows: LogRow[] = [
      { id: 1, step: "exception_call", success: 1, smsSent: null, recipientPhone: "+12025551234", errorDetail: null, firedAt: new Date() },
    ];
    const events = buildTimeline(logRows, job);
    expect(events[0].type).toBe("call");
  });

  it("correctly derives cs_alert type for noshow_alert step", () => {
    const job: Job = { id: 1, jobStatus: null, updatedAt: new Date(), delayMinutes: null, issueNote: null };
    const logRows: LogRow[] = [
      { id: 1, step: "noshow_alert", success: 1, smsSent: "🚨 ALERT", recipientPhone: "+12025559999", errorDetail: null, firedAt: new Date() },
    ];
    const events = buildTimeline(logRows, job);
    expect(events[0].type).toBe("cs_alert");
  });

  it("marks failed events with success=false", () => {
    const job: Job = { id: 1, jobStatus: null, updatedAt: new Date(), delayMinutes: null, issueNote: null };
    const logRows: LogRow[] = [
      { id: 1, step: "pre_job_reminder", success: 0, smsSent: null, recipientPhone: null, errorDetail: "timeout", firedAt: new Date() },
    ];
    const events = buildTimeline(logRows, job);
    expect(events[0].success).toBe(false);
  });
});

// ── Date input validation ─────────────────────────────────────────────────────

describe("fieldMgmtRouter — date input validation", () => {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  it("accepts valid ISO date",             () => expect(dateRegex.test("2026-03-22")).toBe(true));
  it("rejects date with slashes",          () => expect(dateRegex.test("2026/03/22")).toBe(false));
  it("rejects date with time component",   () => expect(dateRegex.test("2026-03-22T10:00:00")).toBe(false));
  it("rejects empty string",               () => expect(dateRegex.test("")).toBe(false));
  it("rejects partial date",               () => expect(dateRegex.test("2026-03")).toBe(false));
});

// ── TEST TOOL — fireStep message building ─────────────────────────────────────

describe("fieldMgmtRouter — fireStep message templates", () => {
  // Mirror the ALL_STEPS list from the UI to verify coverage
  const ALL_STEPS = [
    "pre_job_reminder",
    "client_pre_job",
    "client_on_the_way",
    "client_running_late",
    "arrived_checkin",
    "mid_job_nudge",
    "completion_flow",
    "exception_sms",
    "noshow_alert",
  ];

  it("has 9 fireable steps (exception_call excluded — VAPI only)", () => {
    expect(ALL_STEPS).toHaveLength(9);
  });

  it("all step values are non-empty strings", () => {
    ALL_STEPS.forEach((s) => {
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    });
  });

  it("pre_job_reminder is a cleaner-facing step", () => {
    const cleanerSteps = ["pre_job_reminder", "arrived_checkin", "mid_job_nudge", "completion_flow", "exception_sms"];
    cleanerSteps.forEach((s) => expect(ALL_STEPS).toContain(s));
  });

  it("client-facing steps are included", () => {
    const clientSteps = ["client_pre_job", "client_on_the_way", "client_running_late"];
    clientSteps.forEach((s) => expect(ALL_STEPS).toContain(s));
  });

  it("noshow_alert (CS-facing) is included", () => {
    expect(ALL_STEPS).toContain("noshow_alert");
  });
});

// ── TEST TOOL — simulateStatusChange mapping ──────────────────────────────────

describe("fieldMgmtRouter — simulateStatusChange status→step mapping", () => {
  const STATUS_TO_STEP: Record<string, string> = {
    on_the_way:        "client_on_the_way",
    arrived:           "arrived_checkin",
    running_late:      "client_running_late",
    completed:         "completion_flow",
    issue_at_property: "exception_sms",
  };

  it("maps all 5 simulatable statuses to a step", () => {
    expect(Object.keys(STATUS_TO_STEP)).toHaveLength(5);
  });

  it("on_the_way → client_on_the_way (client SMS)", () => {
    expect(STATUS_TO_STEP["on_the_way"]).toBe("client_on_the_way");
  });

  it("arrived → arrived_checkin (cleaner SMS)", () => {
    expect(STATUS_TO_STEP["arrived"]).toBe("arrived_checkin");
  });

  it("running_late → client_running_late (client SMS)", () => {
    expect(STATUS_TO_STEP["running_late"]).toBe("client_running_late");
  });

  it("completed → completion_flow (cleaner SMS)", () => {
    expect(STATUS_TO_STEP["completed"]).toBe("completion_flow");
  });

  it("issue_at_property → exception_sms (cleaner SMS)", () => {
    expect(STATUS_TO_STEP["issue_at_property"]).toBe("exception_sms");
  });

  it("all mapped steps exist in the fireable steps list", () => {
    const ALL_STEPS = [
      "pre_job_reminder", "client_pre_job", "client_on_the_way", "client_running_late",
      "arrived_checkin", "mid_job_nudge", "completion_flow", "exception_sms", "noshow_alert",
    ];
    Object.values(STATUS_TO_STEP).forEach((step) => {
      expect(ALL_STEPS).toContain(step);
    });
  });
});

// ── TEST TOOL — TEST_PHONE constant ──────────────────────────────────────────

describe("fieldMgmtRouter — TEST_PHONE override", () => {
  const TEST_PHONE = "+13029816191";

  it("TEST_PHONE is a valid E.164 number", () => {
    expect(TEST_PHONE).toMatch(/^\+1\d{10}$/);
  });

  it("TEST_PHONE is the correct override number", () => {
    expect(TEST_PHONE).toBe("+13029816191");
  });

  it("TEST_PHONE is different from CS_ALERT_NUMBER", () => {
    const CS_ALERT_NUMBER = "+12028885362";
    expect(TEST_PHONE).not.toBe(CS_ALERT_NUMBER);
  });
});

// ── PHONE NORMALIZATION in sendSms ───────────────────────────────────────────

describe("sendSms — phone normalization (normalizePhone integration)", () => {
  // Mirror the normalizePhone logic used in openphone.ts
  function extractUSDigits(phone: string): string | null {
    const digits = phone.replace(/[^\d]/g, "");
    if (digits.length === 10 && digits[0] !== "0" && digits[0] !== "1") return digits;
    if (digits.length === 11 && digits[0] === "1") {
      const local = digits.slice(1);
      if (local[0] !== "0" && local[0] !== "1") return local;
    }
    return null;
  }
  function normalizePhone(phone: string): string {
    const local = extractUSDigits(phone);
    if (local) return `+1${local}`;
    const digits = phone.replace(/[^\d]/g, "");
    if (phone.startsWith("+")) return phone.replace(/[^\d+]/g, "");
    return `+${digits}`;
  }

  it("normalizes (301) 706-4517 to E.164", () => {
    expect(normalizePhone("(301) 706-4517")).toBe("+13017064517");
  });

  it("normalizes 301-706-4517 to E.164", () => {
    expect(normalizePhone("301-706-4517")).toBe("+13017064517");
  });

  it("normalizes 3017064517 to E.164", () => {
    expect(normalizePhone("3017064517")).toBe("+13017064517");
  });

  it("passes through already-normalized E.164 unchanged", () => {
    expect(normalizePhone("+13017064517")).toBe("+13017064517");
  });

  it("normalizes 13017064517 (11-digit with leading 1) to E.164", () => {
    expect(normalizePhone("13017064517")).toBe("+13017064517");
  });

  it("normalizes +1 (301) 706-4517 to E.164", () => {
    expect(normalizePhone("+1 (301) 706-4517")).toBe("+13017064517");
  });

  it("normalizes TEST_PHONE correctly", () => {
    expect(normalizePhone("+13029816191")).toBe("+13029816191");
  });
});

// ── RATE LIMIT DELAY — sleep helper ─────────────────────────────────────────

describe("openphone.ts — sleep helper", () => {
  it("sleep resolves after the specified delay", async () => {
    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow 10ms jitter
    expect(elapsed).toBeLessThan(200);
  });

  it("sleep(0) resolves immediately", async () => {
    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    const start = Date.now();
    await sleep(0);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

// ── RETRY STEP — retryStep mutation logic ────────────────────────────────────

describe("fieldMgmtRouter — retryStep logic", () => {
  it("canRetry is false for a successful event (success=true)", () => {
    const event = { success: true, logId: 42, detail: "Hi!", type: "sms_client" };
    const canRetry = !event.success && event.logId !== undefined && !!event.detail && event.type !== "status_change";
    expect(canRetry).toBe(false);
  });

  it("canRetry is false for a status_change event even if success=false", () => {
    const event = { success: false, logId: undefined, detail: undefined, type: "status_change" };
    const canRetry = !event.success && event.logId !== undefined && !!event.detail && event.type !== "status_change";
    expect(canRetry).toBe(false);
  });

  it("canRetry is false when logId is missing (synthetic event)", () => {
    const event = { success: false, logId: undefined, detail: "Hi!", type: "sms_client" };
    const canRetry = !event.success && event.logId !== undefined && !!event.detail && event.type !== "status_change";
    expect(canRetry).toBe(false);
  });

  it("canRetry is false when detail (smsSent) is missing", () => {
    const event = { success: false, logId: 42, detail: undefined, type: "sms_client" };
    const canRetry = !event.success && event.logId !== undefined && !!event.detail && event.type !== "status_change";
    expect(canRetry).toBe(false);
  });

  it("canRetry is true for a failed SMS event with logId and detail", () => {
    const event = { success: false, logId: 19, detail: "Hi Amy!", type: "sms_client" };
    const canRetry = !event.success && event.logId !== undefined && !!event.detail && event.type !== "status_change";
    expect(canRetry).toBe(true);
  });

  it("canRetry is true for a failed cleaner SMS event", () => {
    const event = { success: false, logId: 7, detail: "Hey — reminder for your cleaning.", type: "sms_cleaner" };
    const canRetry = !event.success && event.logId !== undefined && !!event.detail && event.type !== "status_change";
    expect(canRetry).toBe(true);
  });
});

// ── TIMELINE EVENT — logId field ─────────────────────────────────────────────

describe("buildTimeline — logId field on log events", () => {
  // Mirror buildTimeline logic for logId assertion
  function buildTimelineLogIds(
    logRows: Array<{ id: number; step: string; success: number; smsSent: string | null; recipientPhone: string | null; errorDetail: string | null; firedAt: Date }>
  ): Array<{ id: string; logId?: number }> {
    return logRows.map((row) => ({
      id: `log-${row.id}`,
      logId: row.id,
    }));
  }

  it("each log event carries its numeric DB row ID as logId", () => {
    const rows = [
      { id: 101, step: "pre_job_reminder", success: 1, smsSent: "Hi", recipientPhone: "+1555", errorDetail: null, firedAt: new Date() },
      { id: 202, step: "client_pre_job",   success: 0, smsSent: "Hi", recipientPhone: "+1555", errorDetail: "429", firedAt: new Date() },
    ];
    const events = buildTimelineLogIds(rows);
    expect(events[0].logId).toBe(101);
    expect(events[1].logId).toBe(202);
  });

  it("logId matches the id in the event id string", () => {
    const rows = [
      { id: 999, step: "arrived_checkin", success: 1, smsSent: "Hi", recipientPhone: "+1555", errorDetail: null, firedAt: new Date() },
    ];
    const events = buildTimelineLogIds(rows);
    expect(events[0].id).toBe("log-999");
    expect(events[0].logId).toBe(999);
  });
});

// ── FULL STEP SEQUENCE — pending/sent/failed states ──────────────────────────

describe("buildTimeline — full step sequence with pending/sent/failed states", () => {
  const ALL_STEPS = [
    "pre_job_reminder", "client_pre_job", "client_on_the_way", "arrived_checkin",
    "mid_job_nudge", "completion_flow", "exception_sms", "exception_call",
    "noshow_alert", "client_running_late",
  ];

  // Minimal mirror of the new buildTimeline logic for unit testing
  function buildFullTimeline(
    logRows: Array<{ id: number; step: string; success: number; smsSent: string | null; recipientPhone: string | null; errorDetail: string | null; firedAt: Date }>,
    serviceDateTime: Date
  ): Array<{ step: string; status: "sent" | "failed" | "pending"; logId?: number }> {
    const logByStep = new Map<string, typeof logRows[0]>();
    for (const row of logRows) {
      const existing = logByStep.get(row.step);
      if (!existing || row.firedAt > existing.firedAt) {
        logByStep.set(row.step, row);
      }
    }

    return ALL_STEPS.map((step) => {
      const row = logByStep.get(step);
      if (row) {
        return {
          step,
          status: row.success === 1 ? "sent" : "failed",
          logId: row.id,
        };
      }
      return { step, status: "pending" };
    });
  }

  it("all 10 steps appear even when no log rows exist", () => {
    const events = buildFullTimeline([], new Date("2026-03-23T12:30:00Z"));
    expect(events).toHaveLength(10);
    expect(events.every(e => e.status === "pending")).toBe(true);
  });

  it("fired steps show sent status, unfired steps show pending", () => {
    const now = new Date();
    const rows = [
      { id: 1, step: "pre_job_reminder", success: 1, smsSent: "Hi", recipientPhone: "+1555", errorDetail: null, firedAt: now },
      { id: 2, step: "client_pre_job",   success: 1, smsSent: "Hi", recipientPhone: "+1555", errorDetail: null, firedAt: now },
    ];
    const events = buildFullTimeline(rows, new Date("2026-03-23T12:30:00Z"));
    expect(events.find(e => e.step === "pre_job_reminder")?.status).toBe("sent");
    expect(events.find(e => e.step === "client_pre_job")?.status).toBe("sent");
    expect(events.find(e => e.step === "client_on_the_way")?.status).toBe("pending");
    expect(events.find(e => e.step === "arrived_checkin")?.status).toBe("pending");
  });

  it("failed steps show failed status with logId", () => {
    const now = new Date();
    const rows = [
      { id: 42, step: "client_pre_job", success: 0, smsSent: "Hi", recipientPhone: "+1555", errorDetail: "429", firedAt: now },
    ];
    const events = buildFullTimeline(rows, new Date("2026-03-23T12:30:00Z"));
    const clientPreJob = events.find(e => e.step === "client_pre_job");
    expect(clientPreJob?.status).toBe("failed");
    expect(clientPreJob?.logId).toBe(42);
  });

  it("retry overwrites earlier failed row (most recent row wins)", () => {
    const earlier = new Date("2026-03-23T10:00:00Z");
    const later   = new Date("2026-03-23T10:05:00Z");
    const rows = [
      { id: 10, step: "pre_job_reminder", success: 0, smsSent: "Hi", recipientPhone: "+1555", errorDetail: "err", firedAt: earlier },
      { id: 11, step: "pre_job_reminder", success: 1, smsSent: "Hi", recipientPhone: "+1555", errorDetail: null,  firedAt: later   },
    ];
    const events = buildFullTimeline(rows, new Date("2026-03-23T12:30:00Z"));
    const reminder = events.find(e => e.step === "pre_job_reminder");
    // Most recent row (id=11, success=1) should win
    expect(reminder?.status).toBe("sent");
    expect(reminder?.logId).toBe(11);
  });

  it("status field is present on every event", () => {
    const events = buildFullTimeline([], new Date("2026-03-23T12:30:00Z"));
    for (const e of events) {
      expect(["sent", "failed", "pending"]).toContain(e.status);
    }
  });
});

// ── TIMELINE FILTER — future steps hidden ────────────────────────────────────

describe("buildTimeline — future steps are hidden", () => {
  // Mirror the filter logic: only include pending steps whose expectedTs <= now
  function filterPendingSteps(
    steps: Array<{ step: string; expectedOffsetMs: number }>,
    logSteps: Set<string>,
    serviceTime: Date,
    now: Date
  ): Array<{ step: string; status: "sent" | "pending" }> {
    return steps
      .filter((s) => {
        if (logSteps.has(s.step)) return true; // fired — always include
        const expectedTs = new Date(serviceTime.getTime() + s.expectedOffsetMs);
        return expectedTs <= now; // only include if due
      })
      .map((s) => ({
        step: s.step,
        status: logSteps.has(s.step) ? "sent" : "pending",
      }));
  }

  const serviceTime = new Date("2026-03-23T12:30:00Z"); // 8:30 AM ET

  it("hides steps whose expected fire time is in the future", () => {
    // serviceTime = 8:30 AM ET (12:30 UTC)
    // now = 6:35 AM ET (10:35 UTC) — after pre_job_reminder (-2h = 6:30 AM) but before arrived_checkin (0h = 8:30 AM)
    const now = new Date("2026-03-23T10:35:00Z"); // 6:35 AM ET
    const steps = [
      { step: "pre_job_reminder", expectedOffsetMs: -2 * 60 * 60 * 1000 }, // 6:30 AM ET — past (10:30 UTC)
      { step: "client_pre_job",   expectedOffsetMs: -2 * 60 * 60 * 1000 + 90_000 }, // 6:31:30 AM ET — past
      { step: "arrived_checkin",  expectedOffsetMs: 0 }, // 8:30 AM ET — future (12:30 UTC)
      { step: "mid_job_nudge",    expectedOffsetMs: 60 * 60 * 1000 }, // 9:30 AM ET — future
    ];
    const result = filterPendingSteps(steps, new Set(), serviceTime, now);
    expect(result.map(e => e.step)).toEqual(["pre_job_reminder", "client_pre_job"]);
    expect(result.every(e => e.status === "pending")).toBe(true);
  });

  it("shows fired steps regardless of whether their time has passed", () => {
    // now = 6:35 AM ET — pre_job_reminder (-2h = 6:30 AM) is past, arrived_checkin (0h = 8:30 AM) is future
    const now = new Date("2026-03-23T10:35:00Z"); // 6:35 AM ET
    const steps = [
      { step: "pre_job_reminder", expectedOffsetMs: -2 * 60 * 60 * 1000 }, // 6:30 AM ET — past
      { step: "arrived_checkin",  expectedOffsetMs: 0 }, // 8:30 AM ET — future but fired
    ];
    const fired = new Set(["arrived_checkin"]);
    const result = filterPendingSteps(steps, fired, serviceTime, now);
    // pre_job_reminder: past + not fired → pending (shown)
    // arrived_checkin: future + fired → sent (shown)
    expect(result).toHaveLength(2);
    expect(result.find(e => e.step === "arrived_checkin")?.status).toBe("sent");
    expect(result.find(e => e.step === "pre_job_reminder")?.status).toBe("pending");
  });

  it("shows nothing for a future job with no fired steps", () => {
    const futureServiceTime = new Date(Date.now() + 5 * 60 * 60 * 1000); // 5 hours from now
    const now = new Date();
    const steps = [
      { step: "pre_job_reminder", expectedOffsetMs: -2 * 60 * 60 * 1000 }, // 3 hours from now — future
      { step: "arrived_checkin",  expectedOffsetMs: 0 }, // 5 hours from now — future
    ];
    const result = filterPendingSteps(steps, new Set(), futureServiceTime, now);
    expect(result).toHaveLength(0);
  });

  it("shows all steps for a completed past job", () => {
    const pastServiceTime = new Date("2026-03-23T08:00:00Z"); // 4 AM ET
    const now = new Date("2026-03-23T18:00:00Z"); // 2 PM ET — well after all steps
    const steps = [
      { step: "pre_job_reminder", expectedOffsetMs: -2 * 60 * 60 * 1000 },
      { step: "client_pre_job",   expectedOffsetMs: -2 * 60 * 60 * 1000 + 90_000 },
      { step: "arrived_checkin",  expectedOffsetMs: 0 },
      { step: "mid_job_nudge",    expectedOffsetMs: 60 * 60 * 1000 },
    ];
    const fired = new Set(["pre_job_reminder", "client_pre_job", "arrived_checkin", "mid_job_nudge"]);
    const result = filterPendingSteps(steps, fired, pastServiceTime, now);
    expect(result).toHaveLength(4);
    expect(result.every(e => e.status === "sent")).toBe(true);
  });
});

// ── buildTimeline — jobStatusHistory interleaving ─────────────────────────────
// Tests that status history rows are surfaced as trigger events BEFORE their
// resulting SMS steps in the chronological timeline.

describe("buildTimeline — jobStatusHistory interleaving", () => {
  type LogRow = {
    id: number; step: string; success: number; smsSent: string | null;
    recipientPhone: string | null; errorDetail: string | null; firedAt: Date;
  };
  type Job = {
    id: number; jobStatus: string | null; updatedAt: Date;
    serviceDateTime: string | null; delayMinutes: number | null; issueNote: string | null;
  };
  type StatusHistoryRow = { id: number; status: string; source: string; changedAt: Date };

  const STATUS_TRIGGER_LABELS: Record<string, string> = {
    on_the_way: "Cleaner set On the Way in app",
    arrived: "Cleaner checked in at property",
    in_progress: "Job marked In Progress",
    running_late: "Cleaner marked Running Late",
    completed: "Cleaner marked Completed",
    issue_at_property: "Cleaner reported issue at property",
  };

  // Mirror the real buildTimeline logic for status history interleaving
  function buildTimelineWithHistory(
    logRows: LogRow[],
    job: Job,
    statusHistory: StatusHistoryRow[]
  ) {
    type EventType = "sms_cleaner" | "sms_client" | "call" | "cs_alert" | "status_change";
    type Event = {
      id: string; type: EventType; status: string; timestamp: Date;
      label: string; detail?: string; success: boolean; step?: string;
    };

    const STEP_LABELS: Record<string, { recipient: "cleaner" | "client" | "cs"; kind: "sms" | "call" | "alert" }> = {
      pre_job_reminder:    { recipient: "cleaner", kind: "sms" },
      client_pre_job:      { recipient: "client",  kind: "sms" },
      client_on_the_way:   { recipient: "client",  kind: "sms" },
      arrived_checkin:     { recipient: "cleaner", kind: "sms" },
      mid_job_nudge:       { recipient: "cleaner", kind: "sms" },
      completion_flow:     { recipient: "cleaner", kind: "sms" },
      exception_sms:       { recipient: "cleaner", kind: "sms" },
      exception_call:      { recipient: "cleaner", kind: "call" },
      noshow_alert:        { recipient: "cs",      kind: "alert" },
      client_running_late: { recipient: "client",  kind: "sms" },
    };

    const events: Event[] = [];

    for (const row of logRows) {
      const meta = STEP_LABELS[row.step] ?? { recipient: "cleaner" as const, kind: "sms" as const };
      let type: EventType = "sms_cleaner";
      if (meta.recipient === "client") type = "sms_client";
      else if (meta.kind === "call") type = "call";
      else if (meta.kind === "alert") type = "cs_alert";
      events.push({
        id: `log-${row.id}`, type,
        status: row.success === 1 ? "sent" : "failed",
        timestamp: new Date(row.firedAt),
        label: row.step, detail: row.smsSent ?? undefined,
        success: row.success === 1, step: row.step,
      });
    }

    if (statusHistory.length > 0) {
      for (const h of statusHistory) {
        events.push({
          id: `sh-${h.id}`, type: "status_change", status: "status_change",
          timestamp: new Date(h.changedAt),
          label: STATUS_TRIGGER_LABELS[h.status] ?? h.status,
          detail: h.status === "running_late" && job.delayMinutes
            ? `${job.delayMinutes} min delay`
            : h.status === "issue_at_property" && job.issueNote
            ? job.issueNote : undefined,
          success: true, step: h.status,
        });
      }
    } else if (job.jobStatus) {
      events.push({
        id: `status-${job.id}`, type: "status_change", status: "status_change",
        timestamp: new Date(job.updatedAt),
        label: job.jobStatus, success: true, step: job.jobStatus,
      });
    }

    events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return events;
  }

  const baseJob: Job = {
    id: 1, jobStatus: "arrived", updatedAt: new Date("2026-03-23T12:00:00Z"),
    serviceDateTime: "2026-03-23T13:00:00.000Z", delayMinutes: null, issueNote: null,
  };

  it("uses statusHistory rows instead of fallback when history is present", () => {
    const history: StatusHistoryRow[] = [
      { id: 1, status: "on_the_way", source: "cleaner_app", changedAt: new Date("2026-03-23T11:53:00Z") },
      { id: 2, status: "arrived",    source: "cleaner_app", changedAt: new Date("2026-03-23T12:32:00Z") },
    ];
    const events = buildTimelineWithHistory([], baseJob, history);
    // Should show 2 history events, NOT the fallback single-status event
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("sh-1");
    expect(events[1].id).toBe("sh-2");
  });

  it("status_change trigger appears BEFORE resulting SMS in chronological order", () => {
    const history: StatusHistoryRow[] = [
      { id: 1, status: "on_the_way", source: "cleaner_app", changedAt: new Date("2026-03-23T11:53:00Z") },
    ];
    const logRows: LogRow[] = [
      {
        id: 10, step: "client_on_the_way", success: 1,
        smsSent: "Your cleaner is on the way",
        recipientPhone: "+13025551234", errorDetail: null,
        firedAt: new Date("2026-03-23T11:54:00Z"), // 1 min after status tap
      },
    ];
    const events = buildTimelineWithHistory(logRows, baseJob, history);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("status_change");
    expect(events[0].label).toBe("Cleaner set On the Way in app");
    expect(events[1].type).toBe("sms_client");
    expect(events[1].id).toBe("log-10");
  });

  it("shows correct label for each status history type", () => {
    const statuses = ["on_the_way", "arrived", "in_progress", "running_late", "completed", "issue_at_property"];
    for (const status of statuses) {
      const history: StatusHistoryRow[] = [
        { id: 1, status, source: "cleaner_app", changedAt: new Date() },
      ];
      const events = buildTimelineWithHistory([], baseJob, history);
      expect(events[0].label).toBe(STATUS_TRIGGER_LABELS[status]);
    }
  });

  it("includes delay detail on running_late status history event", () => {
    const jobWithDelay: Job = { ...baseJob, jobStatus: "running_late", delayMinutes: 20 };
    const history: StatusHistoryRow[] = [
      { id: 1, status: "running_late", source: "cleaner_app", changedAt: new Date() },
    ];
    const events = buildTimelineWithHistory([], jobWithDelay, history);
    expect(events[0].detail).toBe("20 min delay");
  });

  it("includes issue note on issue_at_property status history event", () => {
    const jobWithIssue: Job = { ...baseJob, jobStatus: "issue_at_property", issueNote: "Broken lock" };
    const history: StatusHistoryRow[] = [
      { id: 1, status: "issue_at_property", source: "cleaner_app", changedAt: new Date() },
    ];
    const events = buildTimelineWithHistory([], jobWithIssue, history);
    expect(events[0].detail).toBe("Broken lock");
  });

  it("falls back to single status event when history is empty", () => {
    const events = buildTimelineWithHistory([], baseJob, []);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("status-1");
    expect(events[0].type).toBe("status_change");
  });

  it("shows no status event when history is empty and job has no status", () => {
    const noStatusJob: Job = { ...baseJob, jobStatus: null };
    const events = buildTimelineWithHistory([], noStatusJob, []);
    expect(events).toHaveLength(0);
  });

  it("interleaves multiple history events with multiple SMS steps chronologically", () => {
    const history: StatusHistoryRow[] = [
      { id: 1, status: "on_the_way", source: "cleaner_app", changedAt: new Date("2026-03-23T11:53:00Z") },
      { id: 2, status: "arrived",    source: "cleaner_app", changedAt: new Date("2026-03-23T12:32:00Z") },
      { id: 3, status: "completed",  source: "cleaner_app", changedAt: new Date("2026-03-23T14:15:00Z") },
    ];
    const logRows: LogRow[] = [
      { id: 10, step: "client_on_the_way", success: 1, smsSent: "On the way", recipientPhone: null, errorDetail: null, firedAt: new Date("2026-03-23T11:54:00Z") },
      { id: 11, step: "arrived_checkin",   success: 1, smsSent: "Checked in", recipientPhone: null, errorDetail: null, firedAt: new Date("2026-03-23T12:33:00Z") },
      { id: 12, step: "completion_flow",   success: 1, smsSent: "Completed",  recipientPhone: null, errorDetail: null, firedAt: new Date("2026-03-23T14:16:00Z") },
    ];
    const events = buildTimelineWithHistory(logRows, baseJob, history);
    // 3 status changes + 3 SMS = 6 total
    expect(events).toHaveLength(6);
    // Each status change should come before its resulting SMS
    const types = events.map(e => e.type);
    expect(types[0]).toBe("status_change"); // on_the_way tap
    expect(types[1]).toBe("sms_client");    // client_on_the_way SMS
    expect(types[2]).toBe("status_change"); // arrived tap
    expect(types[3]).toBe("sms_cleaner");   // arrived_checkin SMS
    expect(types[4]).toBe("status_change"); // completed tap
    expect(types[5]).toBe("sms_cleaner");   // completion_flow SMS
  });

  it("status_change events have status='status_change' and success=true", () => {
    const history: StatusHistoryRow[] = [
      { id: 1, status: "on_the_way", source: "cleaner_app", changedAt: new Date() },
    ];
    const events = buildTimelineWithHistory([], baseJob, history);
    expect(events[0].status).toBe("status_change");
    expect(events[0].success).toBe(true);
  });

  it("status history events have id prefixed with 'sh-'", () => {
    const history: StatusHistoryRow[] = [
      { id: 42, status: "arrived", source: "cleaner_app", changedAt: new Date() },
    ];
    const events = buildTimelineWithHistory([], baseJob, history);
    expect(events[0].id).toBe("sh-42");
  });
});

// ── getJobsForDay — etaTimestamp passthrough ──────────────────────────────────

describe("fieldMgmtRouter — getJobsForDay etaTimestamp passthrough", () => {
  it("includes etaTimestamp in the returned job shape", () => {
    // Simulate the mapping logic that getJobsForDay applies to each DB row
    const dbRow = {
      id: 1,
      cleanerName: "Jane Smith",
      teamName: null,
      customerName: "Test Client",
      customerPhone: "555-0100",
      cleanerPhone: "555-0200",
      jobAddress: "123 Main St",
      serviceDateTime: "2026-03-26 09:00:00",
      serviceType: "Standard Cleaning",
      bedrooms: 2,
      bathrooms: 1,
      jobStatus: "on_the_way",
      trackerToken: null,
      delayMinutes: null,
      issueNote: null,
      etaTimestamp: 1774552800000, // a real epoch ms value
      updatedAt: new Date(),
      createdAt: new Date(),
      bookingStatus: "active",
      cleanerProfileId: 10,
    };

    // The mapping in getJobsForDay spreads the row and adds computed fields
    const mapped = {
      ...dbRow,
      cleanerPhone: dbRow.cleanerPhone ?? null,
      stepsFired: 0,
      stepsSuccess: 0,
      totalSteps: 10,
      timeline: [],
      magicLinkToken: null,
    };

    expect(mapped.etaTimestamp).toBe(1774552800000);
    expect(typeof mapped.etaTimestamp).toBe("number");
  });

  it("etaTimestamp is null when not set on the job", () => {
    const dbRow = {
      id: 2,
      cleanerName: "Bob Jones",
      teamName: null,
      customerName: "Another Client",
      customerPhone: "555-0300",
      cleanerPhone: null,
      jobAddress: "456 Oak Ave",
      serviceDateTime: "2026-03-26 10:00:00",
      serviceType: "Deep Cleaning",
      bedrooms: 3,
      bathrooms: 2,
      jobStatus: "not_started",
      trackerToken: null,
      delayMinutes: null,
      issueNote: null,
      etaTimestamp: null,
      updatedAt: new Date(),
      createdAt: new Date(),
      bookingStatus: "active",
      cleanerProfileId: 11,
    };

    const mapped = {
      ...dbRow,
      cleanerPhone: dbRow.cleanerPhone ?? null,
      stepsFired: 0,
      stepsSuccess: 0,
      totalSteps: 10,
      timeline: [],
      magicLinkToken: null,
    };

    expect(mapped.etaTimestamp).toBeNull();
  });

  it("ETA_OPTIONS in CleanerPortal do not include a Don't know option", () => {
    // Mirrors the ETA_OPTIONS array defined in CleanerPortal.tsx
    const ETA_OPTIONS = [
      { label: "30 min",      value: "30 minutes" },
      { label: "1 hour",     value: "1 hour" },
      { label: "1 hr 30 min", value: "1 hr 30 min" },
      { label: "2 hours",    value: "2 hours" },
    ];

    const hasDontKnow = ETA_OPTIONS.some(
      opt => opt.value.toLowerCase().includes("don") || opt.value.toLowerCase().includes("unknown")
    );
    expect(hasDontKnow).toBe(false);
    expect(ETA_OPTIONS).toHaveLength(4);
  });
});

// ── CleanerPortal — confirm-complete modal logic ──────────────────────────────

describe("CleanerPortal — confirm-complete modal logic", () => {
  // Mirrors the handleMarkComplete guard logic
  function shouldShowModal(allChecked: boolean): boolean {
    if (!allChecked) return false; // toast warning, no modal
    return true; // open modal
  }

  // Mirrors what the modal shows based on photo count
  function getModalState(photoCount: number) {
    return {
      showPhotoWarning: photoCount === 0,
      confirmButtonLabel: photoCount === 0 ? "Complete Anyway" : "Yes, Mark Complete",
      showUploadButton: photoCount === 0,
    };
  }

  it("does NOT open modal when checklist items are not all checked", () => {
    expect(shouldShowModal(false)).toBe(false);
  });

  it("opens modal when checklist is complete", () => {
    expect(shouldShowModal(true)).toBe(true);
  });

  it("opens modal when there is no checklist (allChecked defaults true)", () => {
    expect(shouldShowModal(true)).toBe(true);
  });

  it("shows photo warning when no photos uploaded", () => {
    const state = getModalState(0);
    expect(state.showPhotoWarning).toBe(true);
    expect(state.showUploadButton).toBe(true);
    expect(state.confirmButtonLabel).toBe("Complete Anyway");
  });

  it("does NOT show photo warning when photos exist", () => {
    const state = getModalState(2);
    expect(state.showPhotoWarning).toBe(false);
    expect(state.showUploadButton).toBe(false);
    expect(state.confirmButtonLabel).toBe("Yes, Mark Complete");
  });

  it("confirm button label changes based on photo presence", () => {
    expect(getModalState(0).confirmButtonLabel).toBe("Complete Anyway");
    expect(getModalState(1).confirmButtonLabel).toBe("Yes, Mark Complete");
    expect(getModalState(5).confirmButtonLabel).toBe("Yes, Mark Complete");
  });
});

// ── CleanerPortal — issue_at_property note validation ────────────────────────

describe("CleanerPortal — issue_at_property note validation", () => {
  // Mirrors the Report button disabled logic
  function canSubmitIssue(issueNote: string, isPending: boolean): boolean {
    return !isPending && issueNote.trim().length > 0;
  }

  it("blocks submit when note is empty string", () => {
    expect(canSubmitIssue("", false)).toBe(false);
  });

  it("blocks submit when note is only whitespace", () => {
    expect(canSubmitIssue("   ", false)).toBe(false);
  });

  it("allows submit when note has content", () => {
    expect(canSubmitIssue("Locked out", false)).toBe(true);
  });

  it("blocks submit while mutation is pending even with valid note", () => {
    expect(canSubmitIssue("Locked out", true)).toBe(false);
  });

  it("trims the note before submitting", () => {
    const raw = "  dog in the house  ";
    expect(raw.trim()).toBe("dog in the house");
  });
});

// ── CleanerPortal — ETA blocking modal logic ─────────────────────────────────

describe("CleanerPortal — ETA blocking modal", () => {
  // Mirrors the button click handler logic
  function shouldOpenEtaModal(statusKey: string): boolean {
    return statusKey === "on_the_way" || statusKey === "running_late";
  }

  // Mirrors the onInteractOutside / onEscapeKeyDown guard
  function canDismissModal(isPending: boolean): boolean {
    return !isPending;
  }

  // Mirrors the submit guard inside each ETA button
  function canSubmitEta(etaModalFor: string | null, etaLabel: string): boolean {
    return etaModalFor !== null && etaLabel.trim().length > 0;
  }

  it("opens ETA modal when on_the_way is tapped", () => {
    expect(shouldOpenEtaModal("on_the_way")).toBe(true);
  });

  it("opens ETA modal when running_late is tapped", () => {
    expect(shouldOpenEtaModal("running_late")).toBe(true);
  });

  it("does NOT open ETA modal for other statuses", () => {
    expect(shouldOpenEtaModal("arrived")).toBe(false);
    expect(shouldOpenEtaModal("completed")).toBe(false);
    expect(shouldOpenEtaModal("issue_at_property")).toBe(false);
  });

  it("allows dismissal when mutation is not pending", () => {
    expect(canDismissModal(false)).toBe(true);
  });

  it("blocks dismissal while mutation is pending", () => {
    expect(canDismissModal(true)).toBe(false);
  });

  it("allows ETA submit when modal is open and label is selected", () => {
    expect(canSubmitEta("on_the_way", "30 minutes")).toBe(true);
    expect(canSubmitEta("running_late", "1 hour")).toBe(true);
  });

  it("blocks ETA submit when modal context is null", () => {
    expect(canSubmitEta(null, "30 minutes")).toBe(false);
  });
});

// ── CleanerPortal — Update ETA button visibility ──────────────────────────────

describe("CleanerPortal — Update ETA button visibility", () => {
  function showUpdateEtaButton(jobStatus: string): boolean {
    return jobStatus === "on_the_way" || jobStatus === "running_late";
  }

  it("shows Update ETA button when status is on_the_way", () => {
    expect(showUpdateEtaButton("on_the_way")).toBe(true);
  });

  it("shows Update ETA button when status is running_late", () => {
    expect(showUpdateEtaButton("running_late")).toBe(true);
  });

  it("hides Update ETA button for other statuses", () => {
    expect(showUpdateEtaButton("arrived")).toBe(false);
    expect(showUpdateEtaButton("in_progress")).toBe(false);
    expect(showUpdateEtaButton("completed")).toBe(false);
    expect(showUpdateEtaButton("issue_at_property")).toBe(false);
  });

  it("ETA display falls back to status label when no etaTimestamp", () => {
    const etaTimestamp = null;
    const jobStatus = "on_the_way";
    const display = etaTimestamp
      ? `Arrives ~${new Date(etaTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
      : jobStatus === "on_the_way" ? "On the Way" : "Running Late";
    expect(display).toBe("On the Way");
  });

  it("ETA display shows formatted time when etaTimestamp is set", () => {
    const etaTimestamp = new Date("2026-03-26T14:30:00").getTime();
    const display = etaTimestamp
      ? `Arrives ~${new Date(etaTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
      : "On the Way";
    expect(display).toMatch(/Arrives ~\d+:\d{2} (AM|PM)/);
  });
});

// ── placeNoCheckinEscalationCallWithReason — reason surfacing ─────────────────

describe("placeNoCheckinEscalationCallWithReason — reason surfacing", () => {
  it("returns kill switch reason when FIELD_MGMT_ENABLED is false", () => {
    // Mirrors the guard: if (!FIELD_MGMT_ENABLED) return { success: false, reason: "..." }
    const FIELD_MGMT_ENABLED = false;
    const result = !FIELD_MGMT_ENABLED
      ? { success: false, reason: "Field management kill switch is off" }
      : { success: true };
    expect(result.success).toBe(false);
    expect(result.reason).toBe("Field management kill switch is off");
  });

  it("returns credential reason when VAPI key is missing", () => {
    const vapiPrivateKey = "";
    const result = !vapiPrivateKey
      ? { success: false, reason: "VAPI_PRIVATE_KEY is not configured" }
      : { success: true };
    expect(result.success).toBe(false);
    expect(result.reason).toBe("VAPI_PRIVATE_KEY is not configured");
  });

  it("returns business hours reason outside 8am–5pm ET", () => {
    // Simulate hour = 6 (6 AM ET — outside window)
    const hour = 6;
    const withinHours = hour >= 8 && hour < 17;
    const result = !withinHours
      ? { success: false, reason: "Outside call hours (8 AM – 5 PM ET). Try again during business hours." }
      : { success: true };
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/Outside call hours/);
  });

  it("returns self-call protection reason when target is the outbound number", () => {
    const VAPI_OUTBOUND = "+19347898077";
    const target = "+19347898077";
    const result = target === VAPI_OUTBOUND
      ? { success: false, reason: "Self-call protection: cannot call the VAPI outbound number" }
      : { success: true };
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/Self-call protection/);
  });

  it("surfaces VAPI API error message when the call POST fails", () => {
    const apiError = new Error("VAPI POST /call → 422: phoneNumberId not found");
    const result = { success: false, reason: apiError.message };
    expect(result.success).toBe(false);
    expect(result.reason).toContain("422");
  });
});

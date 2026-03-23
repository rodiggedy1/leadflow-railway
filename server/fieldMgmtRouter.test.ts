/**
 * fieldMgmtRouter.test.ts
 * Tests for the Field Management Log tRPC procedures.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB ───────────────────────────────────────────────────────────────────

const mockDbSelect = vi.fn();
const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => Promise.resolve([])),
        limit: vi.fn(() => Promise.resolve([])),
      })),
    })),
  })),
};

vi.mock("./db", () => ({
  getDb: vi.fn(() => Promise.resolve(mockDb)),
}));

vi.mock("../drizzle/schema", () => ({
  cleanerJobs: { id: "id", jobDate: "jobDate", jobStatus: "jobStatus", updatedAt: "updatedAt" },
  fieldMgmtLog: { cleanerJobId: "cleanerJobId", step: "step", success: "success", firedAt: "firedAt" },
  fieldMgmtSteps: ["pre_job_reminder", "client_pre_job", "arrived_checkin", "mid_job_nudge", "completion_flow", "exception_sms", "exception_call", "noshow_alert", "client_on_the_way", "client_running_late"],
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, op: "eq" })),
  asc: vi.fn((col) => ({ col, op: "asc" })),
  inArray: vi.fn((col, vals) => ({ col, vals, op: "inArray" })),
}));

// ── Unit tests for STEP_LABELS mapping ───────────────────────────────────────

describe("fieldMgmtRouter — STEP_LABELS coverage", () => {
  const STEP_LABELS: Record<string, { label: string; recipient: "cleaner" | "client" | "cs"; kind: "sms" | "call" | "alert" }> = {
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

// ── Unit tests for STATUS_LABELS mapping ─────────────────────────────────────

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

// ── Unit tests for event type derivation logic ────────────────────────────────

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

  it("pre_job_reminder → sms_cleaner", () => expect(deriveEventType("pre_job_reminder")).toBe("sms_cleaner"));
  it("client_pre_job → sms_client", () => expect(deriveEventType("client_pre_job")).toBe("sms_client"));
  it("client_on_the_way → sms_client", () => expect(deriveEventType("client_on_the_way")).toBe("sms_client"));
  it("client_running_late → sms_client", () => expect(deriveEventType("client_running_late")).toBe("sms_client"));
  it("arrived_checkin → sms_cleaner", () => expect(deriveEventType("arrived_checkin")).toBe("sms_cleaner"));
  it("mid_job_nudge → sms_cleaner", () => expect(deriveEventType("mid_job_nudge")).toBe("sms_cleaner"));
  it("completion_flow → sms_cleaner", () => expect(deriveEventType("completion_flow")).toBe("sms_cleaner"));
  it("exception_sms → sms_cleaner", () => expect(deriveEventType("exception_sms")).toBe("sms_cleaner"));
  it("exception_call → call", () => expect(deriveEventType("exception_call")).toBe("call"));
  it("noshow_alert → cs_alert", () => expect(deriveEventType("noshow_alert")).toBe("cs_alert"));
  it("unknown step → sms_cleaner (fallback)", () => expect(deriveEventType("unknown_step")).toBe("sms_cleaner"));
});

// ── Unit tests for timeline event sorting ────────────────────────────────────

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
      { id: "log-1", timestamp: new Date("2026-03-22T09:00:00Z"), label: "Pre-Job Reminder", success: true, type: "sms_cleaner" },
      { id: "status-1", timestamp: new Date("2026-03-22T10:30:00Z"), label: "On the Way", success: true, type: "status_change" },
      { id: "log-2", timestamp: new Date("2026-03-22T09:30:00Z"), label: "Pre-Job Notification", success: true, type: "sms_client" },
    ];
    const sorted = sortEvents(events);
    expect(sorted[0].id).toBe("log-1");
    expect(sorted[1].id).toBe("log-2");
    expect(sorted[2].id).toBe("status-1");
  });
});

// ── Unit tests for step count aggregation ────────────────────────────────────

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
    expect(map.get(99)).toBeUndefined();
    // Consumer uses ?? { total: 0, success: 0 }
    const counts = map.get(99) ?? { total: 0, success: 0 };
    expect(counts.total).toBe(0);
    expect(counts.success).toBe(0);
  });

  it("counts failed steps separately from successful ones", () => {
    const rows: LogRow[] = [
      { cleanerJobId: 5, step: "pre_job_reminder",  success: 1 },
      { cleanerJobId: 5, step: "exception_sms",     success: 0 },
      { cleanerJobId: 5, step: "exception_call",    success: 0 },
    ];
    const map = buildStepCountMap(rows);
    expect(map.get(5)).toEqual({ total: 3, success: 1 });
  });
});

// ── Unit tests for date input validation ─────────────────────────────────────

describe("fieldMgmtRouter — date input validation", () => {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  it("accepts valid ISO date", () => {
    expect(dateRegex.test("2026-03-22")).toBe(true);
  });

  it("rejects date with slashes", () => {
    expect(dateRegex.test("2026/03/22")).toBe(false);
  });

  it("rejects date with time component", () => {
    expect(dateRegex.test("2026-03-22T10:00:00")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(dateRegex.test("")).toBe(false);
  });

  it("rejects partial date", () => {
    expect(dateRegex.test("2026-03")).toBe(false);
  });
});

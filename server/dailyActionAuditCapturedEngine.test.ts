import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AuditCandidate, AuditExpectation, AuditMessage, AuditRecord, AuditThread } from "../shared/dailyActionAudit";
import { verifyAuditCandidates, type VerifyAuditCandidatesInput } from "./dailyActionAuditEngine";

const phone = "+12025550123";
const date = "2026-11-18";
const auditDate = "2026-11-12";
const timeZone = "America/New_York";
const asOf = "2026-11-13T02:00:00.000Z";
function message(overrides: Partial<AuditMessage> = {}): AuditMessage {
  return { key: "in1", sessionId: 1, customerPhone: phone, businessPhone: "+12025550199", direction: "inbound", text: "Please move BK-7 to November 18, 2026 at 9 AM.", occurredAt: null, observedAt: "2026-11-12T15:01:00.000Z", timeBasis: "received", delivery: "received", source: "inbound_sms", ...overrides };
}
function outbound(overrides: Partial<AuditMessage> = {}): AuditMessage {
  return message({ key: "out1", direction: "outbound", text: "Draft: BK-7 is confirmed at 11 AM.", delivery: "unknown", source: "conversation_history", occurredAt: "2026-11-12T16:00:00.000Z", timeBasis: "history", ...overrides });
}
function thread(messages: AuditMessage[] = [message()], overrides: Partial<AuditThread> = {}): AuditThread {
  return { key: "t1", customerPhone: phone, customerName: "Offline Customer", messages, truncated: false, ...overrides };
}
function expectation(overrides: Partial<AuditExpectation> = {}): AuditExpectation {
  return { bookingReference: "BK-7", date, originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null, teamName: null, amountCents: null, ...overrides };
}
function candidate(overrides: Partial<AuditCandidate> = {}, expected: Partial<AuditExpectation> = {}): AuditCandidate {
  return { id: "a1", threadKey: "t1", action: "reschedule", agreement: "requested", anchorMessageKey: "in1", evidenceKeys: ["in1"], expected: expectation(expected), explanation: "Explicit captured inbound request from an offline fixture.", confidence: 0.99, supersededByMessageKey: null, ambiguous: false, ...overrides };
}
function booking(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return { key: "b7", source: "bookings", bookingId: 7, jobId: null, publicBookingNumber: "BK-7", seriesId: null, customerPhone: phone, customerName: "Offline Customer", date, time: "09:00", timeZone, status: "confirmed", address: "123 Test Street, Apt 2", serviceName: "Deep Cleaning", extras: ["inside-oven"], teamName: "Blue Team", recurrence: "one-time", paymentStatus: null, paidAmountCents: null, ...overrides };
}
function job(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return booking({ key: "j70", source: "leadflow_jobs", jobId: 70, publicBookingNumber: null, status: "assigned", ...overrides });
}
function input(overrides: Partial<VerifyAuditCandidatesInput> = {}): VerifyAuditCandidatesInput {
  return { auditDate, timeZone, asOf, evidenceMode: "captured", candidates: [candidate()], threads: [thread()], records: [booking(), job()], ...overrides };
}
function run(overrides: Partial<VerifyAuditCandidatesInput> = {}) { return verifyAuditCandidates(input(overrides))[0]; }
function untimed(overrides: Partial<AuditExpectation> = {}) { return { time: null, timeKind: "unspecified" as const, ...overrides }; }

// Synthetic pure fixtures only: no model, provider, database, clock, writer or service.
describe("captured daily action audit current-state verifier", () => {
  it("matches captured 9 AM against actual 9 AM with explicit provenance caveats", () => {
    const item = run();
    expect(item.status).toBe("matches");
    expect(item.agreement).toBe("requested");
    expect(item.evidenceBasis).toBe("captured");
    expect(item.records.map(record => record.source)).toEqual(["bookings", "leadflow_jobs"]);
    expect(item.evidenceWarnings?.join(" ")).toContain("unverified provider-time");
    expect(item.evidenceWarnings?.join(" ")).toContain("No verified sent confirmation");
    expect(item.evidenceWarnings?.join(" ")).toContain("historical completion");
    expect(item.evidence[0].timeBasis).toBe("received");
    expect(item.evidence[0].occurredAt).toBeNull();
  });
  it("needs action for actual 11 AM despite a matching canonical 9 AM preference", () => {
    const item = run({ records: [booking(), job({ time: "11:00" })] });
    expect(item.status).toBe("needs_action");
    expect(item.verification).toContain("leadflow_jobs j70 scheduled time differs");
  });
  it("retains the strict default refusal for the identical unverified captured request", () => {
    const item = run({ evidenceMode: undefined });
    expect(item.status).toBe("cannot_verify");
    expect(item.records).toEqual([]);
    expect(item.evidenceBasis).toBeUndefined();
    expect(item.evidenceWarnings).toBeUndefined();
  });
  it("uses valid history occurrence as the review day without upgrading it to provider time", () => {
    const item = run({ threads: [thread([message({ source: "conversation_history", timeBasis: "history", occurredAt: "2026-11-12T15:00:00.000Z", observedAt: null })])] });
    expect(item.status).toBe("matches");
    expect(item.evidence[0].timeBasis).toBe("history");
    expect(run({ evidenceMode: undefined, threads: [thread(item.evidence)] }).status).toBe("cannot_verify");
  });
  it("downgrades confirmed to requested only with a valid received inbound anchor", () => {
    const item = run({ candidates: [candidate({ agreement: "confirmed" })], records: [booking(), job({ time: "11:00" })] });
    expect(item.agreement).toBe("requested");
    expect(item.status).toBe("needs_action");
    expect(item.verification).toContain("downgraded to requested");
    expect(run({ candidates: [candidate({ agreement: "confirmed" })] }).status).toBe("matches");
  });
  it("does not let unknown, failed or untimed outbound context poison a clear inbound comparison", () => {
    for (const draft of [outbound(), outbound({ occurredAt: null, observedAt: null, timeBasis: "unknown" }), outbound({ delivery: "failed" as AuditMessage["delivery"] }), outbound({ delivery: "sent", timeBasis: "history" })]) {
      const item = run({ threads: [thread([message(), draft])], candidates: [candidate({ agreement: "confirmed", evidenceKeys: ["in1", "out1"] })], records: [booking(), job({ time: "11:00" })] });
      expect(item.status).toBe("needs_action");
      expect(item.agreement).toBe("requested");
      expect(item.evidence).toHaveLength(2);
    }
  });
  it("does not establish a standalone action from unknown outbound drafts regardless of labels", () => {
    for (const agreement of ["requested", "confirmed"] as const) {
      const item = run({ candidates: [candidate({ agreement, anchorMessageKey: "out1", evidenceKeys: ["out1"] })], threads: [thread([outbound()])] });
      expect(item.status).toBe("cannot_verify");
      expect(item.agreement).toBe(agreement);
    }
  });
  it("never reanchors an outbound draft to an unrelated inbound message", () => {
    const item = run({ candidates: [candidate({ agreement: "confirmed", anchorMessageKey: "out1", evidenceKeys: ["in1", "out1"] })], threads: [thread([message({ text: "Thank you." }), outbound()])] });
    expect(item.status).toBe("cannot_verify");
    expect(item.agreement).toBe("confirmed");
    expect(item.verification).not.toContain("downgraded");
  });
  it("requires actual received delivery for captured inbound action anchors", () => {
    const item = run({ threads: [thread([message({ delivery: "unknown" })])] });
    expect(item.status).toBe("cannot_verify");
    expect(item.verification).toContain("actually received");
  });
  it("keeps an exact current record visible when timing provenance is unclear", () => {
    for (const overrides of [{ occurredAt: null, observedAt: null, timeBasis: "unknown" as const }, { observedAt: "2026-11-12T15:01:00", timeBasis: "received" as const }]) {
      const item = run({ threads: [thread([message(overrides)])] });
      expect(item.status).toBe("cannot_verify");
      expect(item.records.map(record => record.key)).toEqual(["b7", "j70"]);
      expect(item.verification).toContain("candidate evidence only");
    }
  });
  it("does not let capture timing globally suppress otherwise valid actions", () => {
    const bad = candidate({ id: "bad", anchorMessageKey: "badtime", evidenceKeys: ["badtime"] });
    const items = verifyAuditCandidates(input({ candidates: [candidate(), bad], threads: [thread([message(), message({ key: "badtime", observedAt: null, occurredAt: null })])], records: [booking(), job({ time: "11:00" })] }));
    expect(items.map(item => item.status)).toEqual(["needs_action", "cannot_verify"]);
  });
  it("enforces business-local selected-day captured dates and asOf", () => {
    for (const observedAt of ["2026-11-11T15:00:00.000Z", "2026-11-13T15:00:00.000Z", "2026-02-30T15:00:00.000Z"]) {
      expect(run({ threads: [thread([message({ observedAt })])] }).status).toBe("cannot_verify");
    }
    expect(run({ auditDate: "2026-03-07", asOf: "2026-03-08T08:00:00.000Z", threads: [thread([message({ observedAt: "2026-03-08T04:30:00.000Z" })])] }).status).toBe("matches");
    expect(run({ auditDate: "2026-03-08", asOf: "2026-03-08T08:00:00.000Z", threads: [thread([message({ observedAt: "2026-03-08T04:30:00.000Z" })])] }).status).toBe("cannot_verify");
  });
  it("cannot verify model ambiguity, uncertain visit scope or low confidence but displays uniquely selected exact records", () => {
    for (const c of [candidate({ ambiguous: true }), candidate({ confidence: 0.79 }), candidate({ confidence: Number.NaN }), candidate({ agreement: "unclear" }), candidate({}, { scope: "subsequent" })]) {
      const item = run({ candidates: [c] });
      expect(item.status).toBe("cannot_verify");
      expect(item.records.map(record => record.key)).toEqual(["b7", "j70"]);
      expect(item.recordLinks).toEqual([{ label: "Bookings", href: "/admin/bookings" }, { label: "Schedule", href: "/admin/schedule" }]);
    }
  });
  it("does not select ambiguous same-phone household bookings without an exact reference", () => {
    const records = [booking(), job(), booking({ key: "b8", bookingId: 8, publicBookingNumber: "BK-8" }), job({ key: "j80", bookingId: 8, jobId: 80 })];
    for (const ambiguous of [false, true]) {
      const item = run({ candidates: [candidate({ ambiguous }, { bookingReference: null })], records });
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
      expect(item.recordLinks).toEqual([]);
    }
  });
  it("does not attach multiple operational jobs or invalid snapshot identities", () => {
    for (const records of [[booking(), job(), job({ key: "j71", jobId: 71 })], [booking({ bookingId: null }), job()], [booking(), job({ jobId: null })], [booking(), job(), booking()], [booking({ date: "2026-02-30" }), job()]]) {
      const item = run({ records });
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
    }
  });
  it("does not fuzzy-select a nearest visit, a suffix phone, or another customer's same reference/name", () => {
    for (const records of [[booking({ customerPhone: "+12025550124" }), job({ customerPhone: "+12025550124" })], [booking({ customerPhone: "9992025550123" }), job({ customerPhone: "9992025550123" })], [booking({ date: "2026-11-19" }), job({ date: "2026-11-19" })]]) {
      const item = run({ candidates: [candidate({}, { bookingReference: null })], records });
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
    }
  });
  it("blocks same-phone conflicting customer names instead of using a fuzzy household match", () => {
    for (const records of [[booking(), job({ customerName: "Other Household" })], [booking({ customerName: "Offline Customer Jr" }), job({ customerName: "Offline Customer Jr" })]]) {
      const item = run({ records });
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
      expect(item.verification).toContain("no fuzzy name selection");
    }
    expect(run({ records: [booking({ customerName: " OFFLINE   CUSTOMER " }), job({ customerName: null })] }).status).toBe("matches");
    expect(run({ threads: [thread(), thread([message({ key: "other" })], { key: "t2", customerName: "Other Household" })] }).records).toEqual([]);
  });
  it("treats key/thread/phone identity collisions as fatal without attached records", () => {
    const variants: Partial<VerifyAuditCandidatesInput>[] = [
      { candidates: [candidate({ evidenceKeys: [] })] },
      { candidates: [candidate({ evidenceKeys: ["in1", "in1"] })] },
      { candidates: [candidate({ evidenceKeys: ["in1", "missing"] })] },
      { threads: [thread([message({ customerPhone: "+12025550124" })])] },
      { threads: [thread(), thread([message()], { key: "t2" })] },
      { threads: [thread(), thread([message({ key: "other" })])] },
      { threads: [thread(), thread([message({ key: "foreign", customerPhone: "+12025550124" })], { key: "t2", customerPhone: "+12025550124" })], candidates: [candidate({ evidenceKeys: ["in1", "foreign"] })] },
      { threads: [thread([message()], { customerPhone: "invalid" })] },
      { candidates: [candidate(), candidate()] },
    ];
    for (const variant of variants) {
      const item = run(variant);
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
      expect(item.recordLinks).toEqual([]);
    }
  });
  it("rejects cross-customer canonical/job linkage without attaching even the partial group", () => {
    const item = run({ records: [booking(), job({ customerPhone: "+12025550124" })] });
    expect(item.status).toBe("cannot_verify");
    expect(item.verification).toContain("cross-customer linkage");
    expect(item.records).toEqual([]);
  });
  it("does not supersede via later captured chronology alone or unknown outbound corrections", () => {
    const old = candidate({ supersededByMessageKey: "later" });
    const later = candidate({ id: "a2", anchorMessageKey: "later", evidenceKeys: ["later"], contextOnly: true }, { time: "11:00" });
    for (const next of [message({ key: "later", observedAt: "2026-11-12T16:00:00.000Z", text: "Please move BK-7 to November 18, 2026 at 11 AM." }), outbound({ key: "later" }), outbound({ key: "later", timeBasis: "provider", delivery: "unknown" })]) {
      const item = run({ candidates: [old, later], threads: [thread([message(), next])], records: [booking(), job({ time: "11:00" })] });
      expect(item.status).toBe("needs_action");
    }
  });
  it("retains provider-verified correction semantics only with complete valid sent context", () => {
    const first = message({ timeBasis: "provider", occurredAt: "2026-11-12T15:00:00.000Z" });
    const next = outbound({ key: "later", timeBasis: "provider", delivery: "sent", occurredAt: "2026-11-12T16:00:00.000Z" });
    const old = candidate({ supersededByMessageKey: "later" });
    const later = candidate({ id: "a2", agreement: "confirmed", contextOnly: true, anchorMessageKey: "later", evidenceKeys: ["later"] }, { time: "11:00" });
    const options = { candidates: [old, later], threads: [thread([first, next])], records: [booking({ time: "11:00" }), job({ time: "11:00" })] };
    expect(run(options).status).toBe("superseded");
    expect(run({ ...options, threads: [thread([first, next, outbound()])] }).status).toBe("needs_action");
    expect(run({ ...options, candidates: [old, { ...later, confidence: 0.4 }] }).status).toBe("needs_action");
  });
  it("never upgrades provider-timed unknown outbound to a sent confirmation", () => {
    const first = message({ timeBasis: "provider", occurredAt: "2026-11-12T15:00:00.000Z" });
    const unknown = outbound({ timeBasis: "provider", delivery: "unknown" });
    for (const messages of [[first, unknown], [first, unknown, outbound({ key: "sent", timeBasis: "provider", delivery: "sent", text: "Thanks for contacting us." })]]) {
      const item = run({ candidates: [candidate({ agreement: "confirmed", evidenceKeys: messages.map(m => m.key) })], threads: [thread(messages)], records: [booking(), job({ time: "11:00" })] });
      expect(item.agreement).toBe("requested");
      expect(item.status).toBe("needs_action");
    }
  });
  it("preserves paid/captured exact-cent rules without confusing card, quote, authorization or links", () => {
    const c = candidate({ action: "payment" }, untimed({ amountCents: 12000 }));
    expect(run({ candidates: [c], records: [booking({ paymentStatus: "captured", paidAmountCents: 12000 }), job()] }).status).toBe("matches");
    expect(run({ candidates: [c], records: [booking({ paymentStatus: "paid", paidAmountCents: 11999 }), job()] }).status).toBe("needs_action");
    expect(run({ candidates: [c], records: [booking({ paymentStatus: "captured", paidAmountCents: null }), job()] }).status).toBe("cannot_verify");
    expect(run({ candidates: [candidate({ action: "payment" }, untimed())], records: [booking({ paymentStatus: "paid", paidAmountCents: 12000 }), job()] }).status).toBe("cannot_verify");
    for (const paymentStatus of ["card_on_file", "authorized", "link_sent", "pending"]) {
      expect(run({ candidates: [c], records: [booking({ paymentStatus, paidAmountCents: 12000 }), job()] }).status).toBe("needs_action");
    }
  });
  it("preserves recurring exact-occurrence comparison and cannot infer subsequent series coverage", () => {
    const records = [booking({ recurrence: "weekly", time: "11:00" }), job({ recurrence: "Weekly", time: "11:00", status: "completed" }), job({ key: "j71", jobId: 71, recurrence: "Weekly", date: "2026-11-25" })];
    const item = run({ candidates: [candidate({}, { date: "2026-11-25" })], records });
    expect(item.status).toBe("matches");
    expect(item.records.map(record => record.key)).toEqual(["b7", "j71"]);
    expect(item.verification).toContain("first-visit preferences");
    expect(run({ candidates: [candidate({}, { date: "2026-11-25", scope: "subsequent" })], records }).status).toBe("cannot_verify");
    expect(run({ candidates: [candidate({}, { date: "2026-11-25", scope: "unspecified" })], records }).status).toBe("cannot_verify");
  });
  it("compares other hours and windows with the same schedule rules", () => {
    expect(run({ candidates: [candidate({}, { time: "11:00" })], records: [booking({ time: "11:00" }), job({ time: "11:00" })] }).status).toBe("matches");
    const c = candidate({}, { timeKind: "window", time: "09:00", windowEnd: "11:00" });
    expect(run({ candidates: [c], records: [booking({ time: "09:30" }), job({ time: "10:30" })] }).status).toBe("matches");
    expect(run({ candidates: [c], records: [booking(), job({ time: "11:01" })] }).status).toBe("needs_action");
    expect(run({ records: [booking()] }).status).toBe("cannot_verify");
  });
  it("rejects invalid global input without attaching current records", () => {
    for (const variant of [{ auditDate: "2026-02-30" }, { timeZone: "Invalid/Zone" }, { asOf: "not-a-timestamp" }]) {
      const item = run(variant);
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
    }
  });
  it("is deterministic, read-only and independent of network or implicit time", () => {
    const snapshot = input();
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
    freeze(snapshot);
    const before = JSON.stringify(snapshot);
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network forbidden"); });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("clock forbidden"); });
    try {
      const a = verifyAuditCandidates(snapshot), b = verifyAuditCandidates(snapshot);
      expect(a).toEqual(b);
      a[0].records[0].extras?.push("output only");
      expect(JSON.stringify(snapshot)).toBe(before);
      expect(network).not.toHaveBeenCalled();
      expect(clock).not.toHaveBeenCalled();
    } finally { network.mockRestore(); clock.mockRestore(); }
  });
  it("keeps the engine import surface pure and uses only LeadFlow-owned record sources", () => {
    const source = readFileSync(new URL("./dailyActionAuditEngine.ts", import.meta.url), "utf8");
    expect(source.match(/^import[\s\S]*?from ["'][^"']+["'];/gm)).toHaveLength(3);
    expect(source).not.toMatch(/\b(?:fetch|setTimeout|setInterval)\s*\(/);
    expect(source).not.toMatch(new RegExp("cleaner" + "_jobs|cleaner" + "Jobs"));
    expect(run().records.every(record => ["bookings", "leadflow_jobs"].includes(record.source))).toBe(true);
  });
});

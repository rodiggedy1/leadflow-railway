import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AuditCandidate, AuditExpectation, AuditMessage, AuditRecord, AuditThread } from "../shared/dailyActionAudit";
import { verifyAuditCandidates, type VerifyAuditCandidatesInput } from "./dailyActionAuditEngine";

const phone = "+12025550123";
const businessPhone = "+12025550199";
const date = "2026-11-18";
const auditDate = "2026-11-12";
const timeZone = "America/New_York";
const asOf = "2026-11-13T02:00:00.000Z";
function message(overrides: Partial<AuditMessage> = {}): AuditMessage {
  return { key: "m1", sessionId: 1, customerPhone: phone, businessPhone, direction: "outbound",
    text: "Your BK-7 cleaning is on November 18, 2026 at 9 AM.", occurredAt: "2026-11-12T15:00:00.000Z",
    observedAt: "2026-11-12T15:01:00.000Z", timeBasis: "history", delivery: "unknown", source: "conversation_history", ...overrides };
}
function thread(messages = [message()], overrides: Partial<AuditThread> = {}): AuditThread {
  return { key: "t1", customerPhone: phone, customerName: "Offline Customer", messages, truncated: false, ...overrides };
}
function expectation(overrides: Partial<AuditExpectation> = {}): AuditExpectation {
  return { bookingReference: "BK-7", date, originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null,
    scope: "visit", address: null, serviceName: null, extras: null, teamName: null, amountCents: null, ...overrides };
}
function candidate(overrides: Partial<AuditCandidate> = {}, expected: Partial<AuditExpectation> = {}): AuditCandidate {
  return { id: "a1", threadKey: "t1", action: "reschedule", agreement: "confirmed", anchorMessageKey: "m1", evidenceKeys: ["m1"],
    expected: expectation(expected), explanation: "Explicit full stored-text target from a synthetic fixture.", confidence: 0.99,
    supersededByMessageKey: null, ambiguous: false, ...overrides };
}
function booking(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return { key: "b7", source: "bookings", bookingId: 7, jobId: null, publicBookingNumber: "BK-7", seriesId: null,
    customerPhone: phone, customerName: "Offline Customer", date, time: "09:00", timeZone, status: "confirmed",
    address: "123 Test Street, Apt 2", serviceName: "Deep Cleaning", extras: ["inside-oven"], teamName: "Blue Team",
    recurrence: "one-time", paymentStatus: null, paidAmountCents: null, ...overrides };
}
function job(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return booking({ key: "j70", source: "leadflow_jobs", jobId: 70, publicBookingNumber: null, status: "assigned", ...overrides });
}
function input(overrides: Partial<VerifyAuditCandidatesInput> = {}): VerifyAuditCandidatesInput {
  return { auditDate, timeZone, asOf, evidenceMode: "recorded", threads: [thread()], candidates: [candidate()], records: [booking(), job()], ...overrides };
}
function run(overrides: Partial<VerifyAuditCandidatesInput> = {}) { return verifyAuditCandidates(input(overrides))[0]; }
const untimed = { time: null, timeKind: "unspecified" as const };

// Offline pure synthetic fixtures only. No service, model, DB, provider or application entry point is imported.
describe("Live Text Monitor isolated recorded-state engine", () => {
  it.each(["unknown", "sent", "delivered"] as const)("uses full outgoing %s text as a comparison target, not sent proof", delivery => {
    const source = message({ delivery });
    for (const agreement of ["confirmed", "requested"] as const) {
      const options = { threads: [thread([source])], candidates: [candidate({ agreement })] };
      const matches = run(options);
      expect(matches.status).toBe("matches");
      expect(matches.agreement).toBe("requested");
      expect(matches.evidence).toEqual([source]);
      expect(matches.evidenceBasis).toBe("captured");
      expect(matches.verification).toContain("sent confirmation and historical completion are not proven");
      const wrong = run({ ...options, records: [booking(), job({ time: "11:00" })] });
      expect(wrong.status).toBe("needs_action");
      expect(wrong.agreement).toBe("requested");
      expect(wrong.verification.startsWith("leadflow_jobs j70 scheduled time differs from the exact request.")).toBe(true);
    }
  });
  it("compares failed outgoing stored text without converting failed delivery to sent", () => {
    const source = message({ delivery: "failed" as AuditMessage["delivery"] });
    const options = { threads: [thread([source])] };
    expect(run(options).status).toBe("matches");
    const item = run({ ...options, records: [booking(), job({ time: "11:00" })] });
    expect(item.status).toBe("needs_action");
    expect(item.evidence).toEqual([source]);
    expect(item.evidence[0].delivery).toBe("failed");
    for (const evidenceMode of [undefined, "captured"] as const) {
      expect(run({ ...options, evidenceMode }).status).toBe("cannot_verify");
    }
  });
  it.each(["received", "unknown"] as const)("uses full incoming %s stored text for the same comparison", delivery => {
    const source = message({ direction: "inbound", delivery, source: "inbound_sms", timeBasis: "received", occurredAt: null,
      text: "Please move BK-7 to November 18, 2026 at 9 AM." });
    const options = { threads: [thread([source])] };
    expect(run(options).status).toBe("matches");
    expect(run({ ...options, records: [booking(), job({ time: "11:00" })] }).status).toBe("needs_action");
    expect(run(options).evidence).toEqual([source]);
  });
  it.each(["unknown", "history", "received", "provider"] as const)("does not require or upgrade %s timestamp basis for explicit calendar targets", timeBasis => {
    const source = message({ timeBasis, occurredAt: null, observedAt: null, delivery: "unknown" });
    expect(run({ threads: [thread([source])] }).status).toBe("matches");
    const item = run({ threads: [thread([source])], records: [booking(), job({ time: "11:00" })] });
    expect(item.status).toBe("needs_action");
    expect(item.evidence).toEqual([source]);
    expect(item.evidenceWarnings?.join(" ")).toContain("not established or upgraded");
  });
  it("does not turn a stored review timestamp into authoritative selected-day or historical proof", () => {
    const source = message({ occurredAt: "2026-11-01T15:00:00.000Z", observedAt: null });
    const item = run({ threads: [thread([source])] });
    expect(item.status).toBe("matches");
    expect(item.evidence[0].timeBasis).toBe("history");
    expect(item.verification).toContain("supplied current snapshot as of");
    expect(item.verification).toContain("does not prove sent confirmation, historical completion, when changes were made, or charge events");
  });
  it("compares 9 AM and 11 AM uniformly, with no default-hour exemption", () => {
    expect(run({ records: [booking({ time: "11:00" }), job({ time: "11:00" })] }).status).toBe("needs_action");
    expect(run({ candidates: [candidate({}, { time: "11:00" })], records: [booking({ time: "11:00" }), job({ time: "11:00" })] }).status).toBe("matches");
  });
  it("requires the operational visit, not just a matching canonical preference", () => {
    expect(run({ records: [booking()] }).status).toBe("cannot_verify");
    expect(run({ candidates: [candidate({}, { bookingReference: null })], records: [job({ bookingId: null })] }).status).toBe("matches");
  });
  it("keeps exact public references case-sensitive and phone-scoped", () => {
    for (const bookingReference of ["BK-8", "bk-7"]) {
      const item = run({ candidates: [candidate({}, { bookingReference })] });
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
    }
    expect(run({ records: [booking({ customerPhone: "+12025550124" }), job({ customerPhone: "+12025550124" })] }).status).toBe("cannot_verify");
  });
  it("does not use fuzzy, suffix, invalid phones or cross-customer linked records", () => {
    for (const customerPhone of ["9992025550123", "bad", "+12025550124"]) {
      const item = run({ records: [booking(), job({ customerPhone })] });
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
    }
    expect(run({ threads: [thread([message({ customerPhone: "+12025550124" })])] }).records).toEqual([]);
    expect(run({ records: [booking({ customerPhone: "(202) 555-0123" }), job({ customerPhone: "2025550123" })] }).status).toBe("matches");
  });
  it.each([
    { candidates: [candidate({ threadKey: "missing" })] },
    { candidates: [candidate({ anchorMessageKey: "missing" })] },
    { candidates: [candidate({ evidenceKeys: [] })] },
    { candidates: [candidate({ evidenceKeys: ["m1", "m1"] })] },
    { candidates: [candidate({ evidenceKeys: ["m1", "missing"] })] },
    { candidates: [candidate(), candidate()] },
    { threads: [thread([message()], { customerPhone: "bad" })] },
    { threads: [thread(), thread([message({ key: "other" })])] },
    { threads: [thread(), thread([message()], { key: "sibling" })] },
    { threads: [thread([message(), message()])] },
  ] satisfies Partial<VerifyAuditCandidatesInput>[])("rejects absent/duplicated/misbound exact source keys %#", options => {
    const item = run(options);
    expect(item.status).toBe("cannot_verify");
    expect(item.records).toEqual([]);
    expect(item.recordLinks).toEqual([]);
  });
  it("never borrows evidence from a sibling session/thread even for the same phone", () => {
    const sibling = thread([message({ key: "m2", sessionId: 2 })], { key: "t2" });
    expect(run({ threads: [thread(), sibling], candidates: [candidate({ evidenceKeys: ["m1", "m2"] })] }).status).toBe("cannot_verify");
    expect(run({ threads: [sibling] }).status).toBe("cannot_verify");
  });
  it.each([
    { sessionId: 2 }, { sessionId: null }, { customerPhone: "+12025550124" },
    { businessPhone: "+12025550198" }, { businessPhone: null }, { businessPhone: "bad" },
  ] satisfies Partial<AuditMessage>[])("blocks sibling/misbound session/customer/line context even when uncited %#", changes => {
    const item = run({ threads: [thread([message(), message({ key: "context", ...changes })])] });
    expect(item.status).toBe("cannot_verify");
    expect(item.records).toEqual([]);
  });
  it("accepts consistently unknown stored business line without inventing one", () => {
    const source = message({ businessPhone: null });
    expect(run({ threads: [thread([source])] }).status).toBe("matches");
    expect(run({ threads: [thread([source])] }).evidence[0].businessPhone).toBeNull();
    expect(run({ threads: [thread([source, message({ key: "known" })])] }).status).toBe("cannot_verify");
  });
  it("rejects invalid anchor session/line and missing full source text", () => {
    for (const changes of [{ sessionId: null }, { sessionId: 0 }, { sessionId: 1.5 }, { businessPhone: "bad" }, { businessPhone: phone },
      { text: "" }, { text: "   " }, { source: "not_a_source" as AuditMessage["source"] }]) {
      const item = run({ threads: [thread([message(changes)])] });
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
    }
  });
  it("keeps conflicting same-phone customer/household identity in review", () => {
    const item = run({ records: [booking(), job({ customerName: "Other Household" })] });
    expect(item.status).toBe("cannot_verify");
    expect(item.records).toEqual([]);
    expect(item.verification).toContain("Conflicting customer/household");
  });
  it.each([
    candidate({ ambiguous: true }), candidate({ confidence: 0.79 }), candidate({ confidence: Number.NaN }),
    candidate({ agreement: "declined" }), candidate({ agreement: "unclear" }),
    candidate({}, { date: null }), candidate({}, { date: "2026-02-30" }), candidate({}, { date: "11/18/2026" }),
    candidate({}, { time: "morning" }), candidate({}, { time: "9" }), candidate({}, { time: null }),
    candidate({}, { timeKind: "window", time: "11:00", windowEnd: "09:00" }), candidate({}, { scope: "subsequent" }),
  ])("does not guess ambiguous date/time/recurrence, declined/unclear or low-confidence targets %#", c => {
    const item = run({ candidates: [c], records: [booking(), job({ time: "11:00" })] });
    expect(item.status).toBe("cannot_verify");
    expect(item.expected).toEqual(c.expected);
    if (["declined", "unclear"].includes(c.agreement)) expect(item.agreement).toBe(c.agreement);
  });
  it("never chooses multiple jobs or household bookings, invalid identities, or duplicate snapshots", () => {
    const cases = [
      [booking(), job(), job({ key: "j71", jobId: 71 })],
      [booking(), job(), booking({ key: "b8", bookingId: 8, publicBookingNumber: "BK-8" }), job({ key: "j80", bookingId: 8, jobId: 80 })],
      [booking({ bookingId: null }), job()], [booking(), job({ jobId: null })], [booking(), job(), booking()],
    ];
    for (const records of cases) {
      const item = run({ records, candidates: [candidate({}, { bookingReference: null })] });
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
    }
  });
  it("keeps ambiguous multiple recurrence dates in review but compares a uniquely scoped exact visit", () => {
    const records = [booking({ recurrence: "weekly", seriesId: "s7" }), job({ recurrence: "weekly", seriesId: "s7" }),
      job({ key: "j71", jobId: 71, recurrence: "weekly", seriesId: "s7", date: "2026-11-25" })];
    expect(run({ records, candidates: [candidate({}, { scope: "unspecified" })] }).status).toBe("cannot_verify");
    expect(run({ records, candidates: [candidate({}, { scope: "visit" })] }).status).toBe("matches");
  });
  it("still requires persisted paid/captured status plus the exact paid cents", () => {
    const c = candidate({ action: "payment" }, { ...untimed, amountCents: 12000 });
    const threads = [thread([message({ text: "BK-7 on November 18, 2026: charge $120.00." })])];
    for (const paymentStatus of ["paid", "captured"]) {
      expect(run({ threads, candidates: [c], records: [booking({ paymentStatus, paidAmountCents: 12000 }), job()] }).status).toBe("matches");
      expect(run({ threads, candidates: [c], records: [booking({ paymentStatus, paidAmountCents: 11999 }), job()] }).status).toBe("needs_action");
      expect(run({ threads, candidates: [c], records: [booking({ paymentStatus, paidAmountCents: null }), job()] }).status).toBe("cannot_verify");
    }
    expect(run({ threads, candidates: [candidate({ action: "payment" }, untimed)], records: [booking({ paymentStatus: "paid", paidAmountCents: 12000 }), job()] }).status).toBe("cannot_verify");
  });
  it("does not treat saved cards, authorization, quoted price or payment links as a captured charge", () => {
    const c = candidate({ action: "payment" }, { ...untimed, amountCents: 12000 });
    for (const paymentStatus of ["card_on_file", "saved_card", "authorized", "link_sent", "pending"]) {
      expect(run({ candidates: [c], records: [booking({ paymentStatus, paidAmountCents: 12000 }), job()] }).status).toBe("needs_action");
    }
    const saved = { ...booking(), hasStripeCard: true, quotedPriceCents: 12000, paymentLinkSent: true };
    expect(run({ candidates: [c], records: [saved, job()] }).status).toBe("cannot_verify");
  });
  it("never suppresses a recorded action on correction hints, including provider/sent-labelled corrections", () => {
    const old = candidate({ supersededByMessageKey: "m2" });
    const later = candidate({ id: "a2", anchorMessageKey: "m2", evidenceKeys: ["m2"] }, { time: "11:00" });
    for (const changes of [{}, { delivery: "sent" as const, timeBasis: "provider" as const }]) {
      const threads = [thread([message({ delivery: "sent", timeBasis: "provider" }), message({ key: "m2", text: "Correction: BK-7, November 18, 2026 at 11 AM.", occurredAt: "2026-11-12T16:00:00.000Z", ...changes })])];
      const options = { candidates: [old, later], threads, records: [booking({ time: "11:00" }), job({ time: "11:00" })] };
      expect(verifyAuditCandidates(input(options)).map(item => item.status)).toEqual(["needs_action", "matches"]);
      expect(verifyAuditCandidates(input({ ...options, candidates: [old, { ...later, contextOnly: true }] })).map(item => item.status)).toEqual(["needs_action"]);
      expect(run({ ...options, candidates: [old] }).status).toBe("needs_action");
    }
  });
  it("leaves absent strict and captured outcomes and metadata controls unchanged", () => {
    const unverified = input();
    for (const evidenceMode of [undefined, "captured"] as const) {
      const item = verifyAuditCandidates({ ...unverified, evidenceMode })[0];
      expect(item.status).toBe("cannot_verify");
      expect(item.agreement).toBe("confirmed");
      expect(item.evidence[0].delivery).toBe("unknown");
    }
    const sent = input({ threads: [thread([message({ timeBasis: "provider", delivery: "sent" })])] });
    for (const evidenceMode of [undefined, "captured"] as const) {
      expect(verifyAuditCandidates({ ...sent, evidenceMode })[0].status).toBe("matches");
      expect(verifyAuditCandidates({ ...sent, evidenceMode, records: [booking(), job({ time: "11:00" })] })[0].status).toBe("conflict");
    }
    const incoming = input({ threads: [thread([message({ direction: "inbound", delivery: "received", source: "inbound_sms", timeBasis: "received", occurredAt: null })])], candidates: [candidate({ agreement: "requested" })] });
    expect(verifyAuditCandidates({ ...incoming, evidenceMode: undefined })[0].status).toBe("cannot_verify");
    expect(verifyAuditCandidates({ ...incoming, evidenceMode: "captured" })[0].status).toBe("matches");
  });
  it("preserves strict/captured supersession while recorded does not suppress", () => {
    const old = candidate({ supersededByMessageKey: "m2" });
    const later = candidate({ id: "a2", anchorMessageKey: "m2", evidenceKeys: ["m2"] }, { time: "11:00" });
    const options = input({ candidates: [old, later], records: [booking({ time: "11:00" }), job({ time: "11:00" })],
      threads: [thread([message({ timeBasis: "provider", delivery: "sent" }), message({ key: "m2", timeBasis: "provider", delivery: "sent", occurredAt: "2026-11-12T16:00:00.000Z" })])] });
    for (const evidenceMode of [undefined, "captured"] as const) {
      expect(verifyAuditCandidates({ ...options, evidenceMode }).map(item => item.status)).toEqual(["superseded", "matches"]);
    }
    expect(verifyAuditCandidates(options).map(item => item.status)).toEqual(["needs_action", "matches"]);
  });
  it("never lets actual record values fill missing expected fields or alter requested targets", () => {
    const c = candidate({}, { date: null, time: null, timeKind: "unspecified", address: null, amountCents: null });
    const item = run({ candidates: [c] });
    expect(item.status).toBe("cannot_verify");
    expect(item.expected).toEqual(c.expected);
    expect(item.expected.date).toBeNull();
    expect(item.expected.time).toBeNull();
    const wrong = run({ records: [booking(), job({ time: "11:00" })] });
    expect(wrong.expected.time).toBe("09:00");
  });
  it("rejects invalid global snapshot settings", () => {
    for (const changes of [{ auditDate: "2026-02-30" }, { timeZone: "Unknown/Zone" }, { asOf: "bad" }]) {
      const item = run(changes);
      expect(item.status).toBe("cannot_verify");
      expect(item.records).toEqual([]);
    }
  });
  it("is deterministic, deep-copying and read-only without implicit clock or network", () => {
    const snapshot = input();
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
    freeze(snapshot);
    const before = JSON.stringify(snapshot);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network forbidden"); });
    const clockSpy = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("clock forbidden"); });
    try {
      const first = verifyAuditCandidates(snapshot);
      expect(first).toEqual(verifyAuditCandidates(snapshot));
      first[0].records[0].extras?.push("output only");
      first[0].evidence[0].text = "output only";
      first[0].expected.time = "output only";
      expect(JSON.stringify(snapshot)).toBe(before);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(clockSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); clockSpy.mockRestore(); }
  });
  it("uses only existing pure helpers/static imports and LeadFlow-owned records", () => {
    const source = readFileSync(new URL("./dailyActionAuditEngine.ts", import.meta.url), "utf8");
    expect(source.match(/^import[\s\S]*?from ["'][^"']+["'];/gm)).toHaveLength(3);
    expect(source).not.toMatch(/\b(?:fetch|setTimeout|setInterval)\s*\(/);
    expect(source).not.toMatch(new RegExp("cleaner" + "_jobs|cleaner" + "Jobs"));
    expect(run().records.map(record => record.source)).toEqual(["bookings", "leadflow_jobs"]);
    expect(source).toContain("selectRecords(effective, proof.phone!, input.records)");
    expect(source).toContain("compareState(effective, selection, input.timeZone)");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AuditCandidate, AuditExpectation, AuditMessage, AuditRecord, AuditThread } from "../shared/dailyActionAudit";
import { auditBusinessDate, isValidAuditDate, normalizeAuditPhone, normalizeAuditTime, verifyAuditCandidates } from "./dailyActionAuditEngine";

const phone = "+12025550123";
const date = "2026-11-18";
const auditDate = "2026-11-12";
const timeZone = "America/New_York";
const asOf = "2026-11-13T02:00:00.000Z";
function message(overrides: Partial<AuditMessage> = {}): AuditMessage {
  return { key: "m1", sessionId: 1, customerPhone: phone, businessPhone: "+12025550199", direction: "outbound", text: "Your visit is confirmed at 9 AM.", occurredAt: "2026-11-12T15:00:00.000Z", observedAt: "2026-11-12T15:01:00.000Z", timeBasis: "provider", delivery: "sent", source: "madison_sent", ...overrides };
}
function thread(messages: AuditMessage[] = [message()], overrides: Partial<AuditThread> = {}): AuditThread {
  return { key: "t1", customerPhone: phone, customerName: "Synthetic Customer", messages, truncated: false, ...overrides };
}
function expectation(overrides: Partial<AuditExpectation> = {}): AuditExpectation {
  return { bookingReference: "BK-7", date, originalDate: null, time: "09:00", timeKind: "exact", windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null, teamName: null, amountCents: null, ...overrides };
}
function candidate(overrides: Partial<AuditCandidate> = {}, expected: Partial<AuditExpectation> = {}): AuditCandidate {
  return { id: "a1", threadKey: "t1", action: "reschedule", agreement: "confirmed", anchorMessageKey: "m1", evidenceKeys: ["m1"], expected: expectation(expected), explanation: "Synthetic agreement extracted from offline fixture.", confidence: 0.99, supersededByMessageKey: null, ambiguous: false, ...overrides };
}
function booking(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return { key: "b7", source: "bookings", bookingId: 7, jobId: null, publicBookingNumber: "BK-7", seriesId: null, customerPhone: phone, customerName: "Synthetic Customer", date, time: "09:00", timeZone, status: "confirmed", address: "123 Test Street, Apt 2", serviceName: "Deep Cleaning", extras: ["Inside Oven"], teamName: "Blue Team", recurrence: "one-time", paymentStatus: null, paidAmountCents: null, ...overrides };
}
function job(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return booking({ key: "j70", source: "leadflow_jobs", jobId: 70, publicBookingNumber: null, status: "assigned", ...overrides });
}
function run(c = candidate(), records = [booking(), job()], threads = [thread()]) {
  return verifyAuditCandidates({ auditDate, timeZone, asOf, candidates: [c], threads, records })[0];
}
function untimed(overrides: Partial<AuditExpectation> = {}) { return { time: null, timeKind: "unspecified" as const, ...overrides }; }

describe("daily action audit deterministic snapshot verifier", () => {
  it("matches actual canonical and linked operational 9 AM without historical claims", () => {
    const item = run();
    expect(item.status).toBe("matches");
    expect(item.records.map(record => record.source)).toEqual(["bookings", "leadflow_jobs"]);
    expect(item.verification).toContain("current snapshot");
    expect(item.verification).toContain("does not prove historical");
  });
  it("conflicts with an 11 AM actual job even when canonical 9 AM preference matches", () => {
    const item = run(candidate(), [booking(), job({ time: "11:00" })]);
    expect(item.status).toBe("conflict");
    expect(item.verification).toContain("leadflow_jobs j70 scheduled time differs");
  });
  it("does not grant a 9 AM exception when both records are wrong", () => {
    expect(run(candidate(), [booking({ time: "11:00" }), job({ time: "11:00" })]).status).toBe("conflict");
  });
  it("applies the uniform exact-time rule equally to another hour", () => {
    expect(run(candidate({}, { time: "11:00" }), [booking({ time: "11:00" }), job({ time: "11:00" })]).status).toBe("matches");
    expect(run(candidate({}, { time: "11:00" })).status).toBe("conflict");
  });
  it("checks windows rather than silently treating them as exact starts", () => {
    const c = candidate({}, { time: "09:00", timeKind: "window", windowEnd: "11:00" });
    expect(run(c, [booking({ time: "09:30" }), job({ time: "10:30" })]).status).toBe("matches");
    expect(run(c, [booking(), job({ time: "11:01" })]).status).toBe("conflict");
  });
  it("cannot verify the actual scheduled visit from canonical preferences only", () => {
    const item = run(candidate(), [booking()]);
    expect(item.status).toBe("cannot_verify");
    expect(item.verification).toContain("no linked operational job");
  });
  it("rejects wrong customer even with the same name and public number", () => {
    const item = run(candidate(), [booking({ customerPhone: "+12025550124" }), job({ customerPhone: "+12025550124" })]);
    expect(item.status).toBe("cannot_verify");
    expect(item.records).toEqual([]);
  });
  it("accepts only exact valid US phone normalization via the central helper", () => {
    expect(normalizeAuditPhone("(202) 555-0123")).toBe(phone);
    expect(normalizeAuditPhone("12025550123")).toBe(phone);
    expect(normalizeAuditPhone(phone)).toBe(phone);
    for (const bad of ["5550123", "02025550123", "+442071838750", "+2025550123", "+12025550123x", "name2025550123", "202-155-0123", "+120255501234"]) expect(normalizeAuditPhone(bad)).toBeNull();
    expect(run(candidate(), [booking({ customerPhone: "(202) 555-0123" }), job({ customerPhone: "2025550123" })]).status).toBe("matches");
  });
  it("does not fuzzy-match suffix digits or an invalid phone", () => {
    expect(run(candidate(), [booking({ customerPhone: "9992025550123" }), job({ customerPhone: "9992025550123" })]).status).toBe("cannot_verify");
    expect(run(candidate(), [booking(), job()], [thread([message()], { customerPhone: "bad" })]).status).toBe("cannot_verify");
  });
  it("does not guess among multiple household bookings on the same date", () => {
    const item = run(candidate({}, { bookingReference: null }), [booking(), job(), booking({ key: "b8", bookingId: 8, publicBookingNumber: "BK-8" }), job({ key: "j80", bookingId: 8, jobId: 80 })]);
    expect(item.status).toBe("cannot_verify");
    expect(item.verification).toContain("Multiple bookings/households");
  });
  it("uses the exact original date to identify a moved visit without selecting another visit", () => {
    const c = candidate({}, { bookingReference: null, originalDate: "2026-11-17" });
    const records = [booking(), job({ date: "2026-11-17", time: "11:00" }), booking({ key: "b8", bookingId: 8, publicBookingNumber: "BK-8" }), job({ key: "j80", bookingId: 8, jobId: 80 })];
    const item = run(c, records);
    expect(item.status).toBe("conflict");
    expect(item.records.every(record => record.bookingId === 7)).toBe(true);
  });
  it("cannot use a date-less instruction to choose the customer's only record", () => {
    const c = candidate({ action: "address" }, untimed({ date: null, bookingReference: null, address: "123 Test Street, Apt 2" }));
    expect(run(c).status).toBe("cannot_verify");
  });
  it("cannot verify recurring multiple dates with unspecified scope", () => {
    const records = [booking({ recurrence: "weekly", seriesId: "s7" }), job({ recurrence: "weekly", seriesId: "s7" }), job({ key: "j71", jobId: 71, recurrence: "weekly", seriesId: "s7", date: "2026-11-25" })];
    const item = run(candidate({}, { scope: "unspecified" }), records);
    expect(item.status).toBe("cannot_verify");
    expect(item.verification).toContain("Recurring visits");
  });
  it("cannot infer recurring scope when series IDs are unavailable across multiple dates", () => {
    const records = [booking({ recurrence: "weekly" }), job({ recurrence: "weekly" }), booking({ key: "b8", bookingId: 8, publicBookingNumber: "BK-8", date: "2026-11-25", recurrence: "weekly" }), job({ key: "j80", bookingId: 8, jobId: 80, date: "2026-11-25", recurrence: "weekly" })];
    expect(run(candidate({}, { scope: "unspecified" }), records).status).toBe("cannot_verify");
  });
  it("cannot prove all subsequent recurring visits even if every supplied time agrees", () => {
    expect(run(candidate({}, { scope: "subsequent" }), [booking({ recurrence: "weekly" }), job({ recurrence: "weekly" })]).status).toBe("cannot_verify");
  });
  it("selects an exact recurring visit only with explicit visit scope", () => {
    const records = [booking({ seriesId: "s7", recurrence: "weekly" }), job({ seriesId: "s7", recurrence: "weekly" }), job({ key: "j71", jobId: 71, seriesId: "s7", recurrence: "weekly", date: "2026-11-25" })];
    const item = run(candidate(), records);
    expect(item.status).toBe("matches");
    expect(item.records.map(record => record.key)).toEqual(["b7", "j70"]);
  });
  it("compares an exact linked future recurring occurrence, not the first-visit date/time anchor", () => {
    // The existing worker retains bookingId but may leave seriesId null.
    const records = [booking({ recurrence: "weekly", time: "11:00" }), job({ recurrence: "Weekly", time: "11:00", status: "completed" }), job({ key: "j71", jobId: 71, recurrence: "Weekly", date: "2026-11-25" })];
    const item = run(candidate({}, { date: "2026-11-25" }), records);
    expect(item.status).toBe("matches");
    expect(item.records.map(record => record.key)).toEqual(["b7", "j71"]);
    expect(item.records[0].time).toBe("11:00");
    expect(item.verification).toContain("first-visit preferences");
    expect(item.verification).toContain("does not prove historical");
    expect(run(candidate({}, { date: "2026-11-25", scope: "subsequent" }), records).status).toBe("cannot_verify");
    expect(run(candidate({}, { date: "2026-11-25", scope: "unspecified" }), records).status).toBe("cannot_verify");
  });
  it("does not falsely conflict when a recurring snapshot cannot prove first versus later visit purpose", () => {
    const records = [booking({ recurrence: "weekly", time: "11:00" }), job({ recurrence: "Weekly", date: "2026-11-25" })];
    const item = run(candidate({}, { date: "2026-11-25" }), records);
    expect(item.status).toBe("cannot_verify");
    expect(item.verification).toContain("first versus later recurring occurrence");
    expect(run(candidate({}, { date: "2026-11-25" }), [booking({ recurrence: "weekly" }), job({ recurrence: "Weekly" })]).status).toBe("cannot_verify");
  });
  it("still compares the canonical first-visit time mirror when that exact visit is selected", () => {
    const records = [booking({ recurrence: "weekly", time: "11:00" }), job({ recurrence: "Weekly" }), job({ key: "j71", jobId: 71, recurrence: "Weekly", date: "2026-11-25" })];
    const item = run(candidate(), records);
    expect(item.status).toBe("conflict");
    expect(item.verification).toContain("bookings b7 scheduled time differs");
  });
  it("retains actual future-job conflicts and canonical cancellation/expiry contradictions", () => {
    const records = [booking({ recurrence: "weekly", time: "11:00" }), job({ recurrence: "Weekly", time: "11:00" }), job({ key: "j71", jobId: 71, recurrence: "Weekly", date: "2026-11-25", time: "11:00" })];
    const c = candidate({}, { date: "2026-11-25" });
    expect(run(c, records).status).toBe("conflict");
    expect(run(candidate({ agreement: "requested" }, { date: "2026-11-25" }), records).status).toBe("needs_action");
    for (const status of ["cancelled", "expired"]) {
      const item = run(c, [booking({ recurrence: "weekly", status }), job({ recurrence: "Weekly" }), job({ key: "j71", jobId: 71, recurrence: "Weekly", date: "2026-11-25" })]);
      expect(item.status).toBe("conflict");
      expect(item.verification).toContain("bookings b7");
    }
  });
  it("does not use an unrelated series or recurrence label to bypass a one-time time-mirror conflict", () => {
    const records = [booking(), job({ time: "11:00", seriesId: "s7" })];
    expect(run(candidate(), records).status).toBe("conflict");
    expect(run(candidate(), [booking({ recurrence: "ad hoc" }), job({ recurrence: "ad hoc", time: "11:00" })]).status).toBe("conflict");
  });
  it("cannot verify duplicate first-visit anchors as proof of a future recurring occurrence", () => {
    const records = [booking({ recurrence: "weekly" }), job({ recurrence: "Weekly" }), job({ key: "j72", jobId: 72, recurrence: "Weekly" }), job({ key: "j71", jobId: 71, recurrence: "Weekly", date: "2026-11-25" })];
    expect(run(candidate({}, { date: "2026-11-25" }), records).status).toBe("cannot_verify");
  });
  it("never chooses one of duplicate same-date jobs linked to the same booking", () => {
    expect(run(candidate(), [booking(), job(), job({ key: "j71", jobId: 71 })]).status).toBe("cannot_verify");
  });
  it("detects cross-customer canonical/operational booking linkage instead of using names", () => {
    const item = run(candidate(), [booking(), job({ customerPhone: "+12025550124" })]);
    expect(item.status).toBe("cannot_verify");
    expect(item.verification).toContain("different or invalid customer phone");
    expect(item.records.every(record => record.customerPhone === phone)).toBe(true);
  });
  it("matches a persisted new booking with its operational job, not missing or draft records", () => {
    const c = candidate({ action: "book" });
    expect(run(c).status).toBe("matches");
    expect(run(c, []).status).toBe("conflict");
    expect(run(candidate({ action: "book", agreement: "requested" }), []).status).toBe("needs_action");
    expect(run(c, [booking({ status: "pending_card" }), job()]).status).toBe("conflict");
  });
  it("matches cancellation only when both persisted booking and linked job are cancelled", () => {
    const c = candidate({ action: "cancel" }, untimed());
    expect(run(c, [booking({ status: "cancelled" }), job({ status: "canceled" })]).status).toBe("matches");
    expect(run(c, [booking({ status: "cancelled" }), job()]).status).toBe("conflict");
    expect(run(c, []).status).toBe("cannot_verify");
  });
  it("does not match a cancellation or address claim for the wrong exact visit date", () => {
    const wrongDate = [booking({ date: "2026-11-25", status: "cancelled" }), job({ date: "2026-11-25", status: "cancelled" })];
    expect(run(candidate({ action: "cancel" }, untimed()), wrongDate).status).toBe("conflict");
    expect(run(candidate({ action: "address" }, untimed({ address: "123 Test Street, Apt 2" })), [booking({ date: "2026-11-25" }), job({ date: "2026-11-25" })]).status).toBe("conflict");
  });
  it("matches the current state of a fulfilled request without claiming a sent confirmation", () => {
    expect(run(candidate({ agreement: "requested" })).status).toBe("matches");
    expect(run(candidate({ agreement: "requested" })).verification).toContain("sent confirmation and historical completion are not proven");
    expect(run(candidate({ agreement: "requested" }), [booking(), job({ time: "11:00" })]).status).toBe("needs_action");
  });
  it("matches a requested 9 AM active schedule despite canonical billing needs_attention", () => {
    const inbound = [thread([message({ direction: "inbound", delivery: "received", source: "provider", text: "Please book my visit at 9 AM without payment." })])];
    for (const action of ["book", "reschedule"] as const) for (const status of ["assigned", "unassigned"]) {
      const item = run(candidate({ action, agreement: "requested" }), [booking({ status: "needs_attention", paymentStatus: "not_started" }), job({ status })], inbound);
      expect(item.status).toBe("matches");
      expect(item.verification).toContain("sent confirmation and historical completion are not proven");
    }
  });
  it("requires the actual active job and retains wrong-time severity despite billing attention", () => {
    const records = [booking({ status: "needs_attention" }), job({ time: "11:00" })];
    expect(run(candidate({ agreement: "requested" }), records).status).toBe("needs_action");
    expect(run(candidate(), records).status).toBe("conflict");
    expect(run(candidate(), [booking({ status: "needs_attention" })]).status).toBe("cannot_verify");
    expect(run(candidate(), [booking({ status: "needs_attention" }), job({ status: "cancelled" })]).status).toBe("conflict");
    expect(run(candidate(), [booking({ status: "needs_attention" }), job({ status: null })]).status).toBe("cannot_verify");
  });
  it("never treats an expired or cancelled canonical booking plus an active job as matching", () => {
    for (const status of ["cancelled", "expired"]) expect(run(candidate(), [booking({ status }), job()]).status).toBe("conflict");
  });
  it("never labels declined or unclear proposals matches", () => {
    expect(run(candidate({ agreement: "declined" })).status).toBe("cannot_verify");
    expect(run(candidate({ agreement: "unclear" })).status).toBe("cannot_verify");
  });
  it("checks address exact normalized whitespace/case but never guesses apartments or abbreviations", () => {
    const c = candidate({ action: "address" }, untimed({ address: " 123 TEST Street,   Apt 2 " }));
    expect(run(c).status).toBe("matches");
    expect(run(c, [booking(), job({ address: "123 Test Street, Apt 3" })]).status).toBe("conflict");
    expect(run(candidate({ action: "address" }, untimed({ address: "123 Test St" }))).status).toBe("conflict");
    expect(run(candidate({ action: "address", ambiguous: true }, untimed({ address: "123 Test Street" }))).status).toBe("cannot_verify");
  });
  it("checks service and extras exactly, independent of extras order", () => {
    const c = candidate({ action: "service" }, untimed({ serviceName: "DEEP   CLEANING", extras: ["Inside Oven", "Inside fridge"], extrasMode: "replace" }));
    const records = [booking({ extras: ["inside-fridge", "inside-oven"] }), job({ extras: ["Inside Oven", "inside-fridge"] })];
    expect(run(c, records).status).toBe("matches");
    expect(run(c).status).toBe("conflict");
    expect(run(c, [booking({ extras: null }), job({ extras: null })]).status).toBe("cannot_verify");
  });
  it("matches the exact Inside oven catalog label to the persisted inside-oven ID", () => {
    const c = candidate({ action: "service" }, untimed({ extras: ["Inside oven"], extrasMode: "replace" }));
    expect(run(c, [booking({ extras: ["inside-oven"] }), job({ extras: ["inside-oven"] })]).status).toBe("matches");
  });
  it("verifies additions without asserting unrelated extras must be deleted", () => {
    const c = candidate({ action: "service" }, untimed({ extras: ["Inside oven"], extrasMode: "add" }));
    expect(run(c, [booking({ extras: ["inside-fridge", "inside-oven"] }), job({ extras: ["inside-fridge", "inside-oven"] })]).status).toBe("matches");
    expect(run(c, [booking({ extras: ["inside-fridge"] }), job({ extras: ["inside-fridge"] })]).status).toBe("conflict");
  });
  it("verifies an exact removal without requiring other extras to disappear", () => {
    const c = candidate({ action: "service" }, untimed({ extras: ["Inside oven"], extrasMode: "remove" }));
    expect(run(c, [booking({ extras: ["inside-fridge"] }), job({ extras: ["inside-fridge"] })]).status).toBe("matches");
    expect(run(c, [booking({ extras: ["inside-fridge", "inside-oven"] }), job({ extras: ["inside-fridge", "inside-oven"] })]).status).toBe("conflict");
  });
  it("marks unknown aliases, quantities and unspecified extras operations cannot_verify, not false conflicts", () => {
    for (const extras of [["Oven"], ["Interior windows × 5"], ["invented-extra"]]) {
      expect(run(candidate({ action: "service" }, untimed({ extras, extrasMode: "replace" }))).status).toBe("cannot_verify");
    }
    expect(run(candidate({ action: "service" }, untimed({ extras: ["Inside oven"] }))).status).toBe("cannot_verify");
    const c = candidate({ action: "service" }, untimed({ extras: ["Inside oven"], extrasMode: "replace" }));
    expect(run(c, [booking({ extras: ["unsupported-stored-extra"] }), job({ extras: ["unsupported-stored-extra"] })]).status).toBe("cannot_verify");
  });
  it("does not prove removal when a stored alias is unsupported, or accept empty add/remove targets", () => {
    const c = candidate({ action: "service" }, untimed({ extras: ["Inside oven"], extrasMode: "remove" }));
    expect(run(c, [booking({ extras: ["oven"] }), job({ extras: ["oven"] })]).status).toBe("cannot_verify");
    for (const extrasMode of ["add", "remove"] as const) expect(run(candidate({ action: "service" }, untimed({ extras: [], extrasMode }))).status).toBe("cannot_verify");
  });
  it("never accepts unsent outbound anchors even when the model calls them requests", () => {
    const c = candidate({ agreement: "requested" });
    const result = run(c, [booking(), job()], [thread([message({ delivery: "unknown" })])]);
    expect(result.status).toBe("cannot_verify");
    expect(result.verification).toContain("actually sent/delivered");
  });
  it("does not supersede a real request using an unsent correction mislabeled requested", () => {
    const old = candidate({ supersededByMessageKey: "m2" });
    const later = candidate({ id: "a2", agreement: "requested", anchorMessageKey: "m2", evidenceKeys: ["m2"] }, { time: "11:00" });
    const input = { auditDate, timeZone, asOf, candidates: [old, later], records: [booking({ time: "11:00" }), job({ time: "11:00" })], threads: [thread([message(), message({ key: "m2", delivery: "unknown", occurredAt: "2026-11-12T16:00:00.000Z", text: "Correction: 11 AM is confirmed." })])] };
    expect(verifyAuditCandidates(input).map(item => item.status)).toEqual(["conflict", "cannot_verify"]);
  });
  it("rejects provider-timed incoming anchors whose receipt is not established", () => {
    const c = candidate({ agreement: "requested" });
    expect(run(c, [booking(), job()], [thread([message({ direction: "inbound", delivery: "unknown" })])]).status).toBe("cannot_verify");
  });
  it("requires an exact full team designation and cannot use an ambiguous first name", () => {
    expect(run(candidate({ action: "assignment" }, untimed({ teamName: "blue team" }))).status).toBe("matches");
    expect(run(candidate({ action: "assignment" }, untimed({ teamName: "Red Team" }))).status).toBe("conflict");
    expect(run(candidate({ action: "assignment" }, untimed({ teamName: "Maria" })), [booking({ teamName: "Maria" }), job({ teamName: "Maria" })]).status).toBe("cannot_verify");
    expect(run(candidate({ action: "assignment" }, untimed({ teamName: "Blue Team" })), [booking()]).status).toBe("cannot_verify");
  });
  it("proves payment only with persisted paid/captured status and the exact requested cents", () => {
    const c = candidate({ action: "payment" }, untimed({ amountCents: 12000 }));
    expect(run(c, [booking({ paymentStatus: "captured", paidAmountCents: 12000 }), job()]).status).toBe("matches");
    expect(run(c, [booking({ paymentStatus: "paid", paidAmountCents: 11999 }), job()]).status).toBe("conflict");
    expect(run(c, [booking({ paymentStatus: "captured", paidAmountCents: null }), job()]).status).toBe("cannot_verify");
    expect(run(candidate({ action: "payment" }, untimed()), [booking({ paymentStatus: "paid", paidAmountCents: 12000 }), job()]).status).toBe("cannot_verify");
  });
  it("rejects card-on-file, quoted amount, sent payment link and authorized hold as paid proof", () => {
    const c = candidate({ action: "payment" }, untimed({ amountCents: 12000 }));
    for (const paymentStatus of ["card_on_file", "authorized", "link_sent", "pending"]) expect(run(c, [booking({ paymentStatus, paidAmountCents: 12000 }), job()]).status).toBe("conflict");
    const quoted = { ...booking(), hasStripeCard: true, quotedPriceCents: 12000, paymentLinkSent: true };
    expect(run(c, [quoted, job()]).status).toBe("cannot_verify");
  });
  it("requires actual sent/delivered outbound proof, never an unknown draft or inbound assertion", () => {
    expect(run(candidate(), [booking(), job()], [thread([message({ delivery: "unknown" })])]).status).toBe("cannot_verify");
    expect(run(candidate(), [booking(), job()], [thread([message({ direction: "inbound", delivery: "received", source: "inbound_sms" })])]).status).toBe("cannot_verify");
    expect(run(candidate(), [booking(), job()], [thread([message({ delivery: "delivered" })])]).status).toBe("matches");
  });
  it("does not mistake observed/received processing time for strict-day occurred evidence", () => {
    const item = run(candidate(), [booking(), job()], [thread([message({ occurredAt: null, observedAt: "2026-11-12T15:01:00.000Z", timeBasis: "received" })])]);
    expect(item.status).toBe("cannot_verify");
    expect(item.evidence).toHaveLength(1);
    expect(item.verification).toContain("strict-day");
    expect(run(candidate(), [booking(), job()], [thread([message({ timeBasis: "unknown" })])]).status).toBe("cannot_verify");
  });
  it("keeps generic history processing timestamps unverifiable without provider provenance", () => {
    const item = run(candidate(), [booking(), job()], [thread([message({ source: "conversation_history", timeBasis: "history" })])]);
    expect(item.status).toBe("cannot_verify");
    expect(item.evidence).toHaveLength(1);
  });
  it("uses business-local calendar days including spring/fall DST rather than UTC slices", () => {
    expect(auditBusinessDate("2026-03-08T04:30:00.000Z", timeZone)).toBe("2026-03-07");
    expect(auditBusinessDate("2026-03-08T07:30:00.000Z", timeZone)).toBe("2026-03-08");
    expect(auditBusinessDate("2026-11-01T05:30:00.000Z", timeZone)).toBe("2026-11-01");
    expect(auditBusinessDate("2026-11-01T06:30:00.000Z", timeZone)).toBe("2026-11-01");
    const input = { auditDate: "2026-03-07", timeZone, asOf: "2026-03-08T08:00:00.000Z", candidates: [candidate()], records: [booking(), job()], threads: [thread([message({ occurredAt: "2026-03-08T04:30:00.000Z" })])] };
    expect(verifyAuditCandidates(input)[0].status).toBe("matches");
    expect(verifyAuditCandidates({ ...input, auditDate: "2026-03-08" })[0].status).toBe("cannot_verify");
  });
  it("rejects evidence keys misbound across threads/customers or absent anchor keys", () => {
    const other = thread([message({ key: "m2", customerPhone: "+12025550124" })], { key: "t2", customerPhone: "+12025550124" });
    expect(run(candidate({ evidenceKeys: ["m1", "m2"] }), [booking(), job()], [thread(), other]).status).toBe("cannot_verify");
    expect(run(candidate(), [booking(), job()], [thread([message({ customerPhone: "+12025550124" })])]).status).toBe("cannot_verify");
    expect(run(candidate({ evidenceKeys: [] })).status).toBe("cannot_verify");
    expect(run(candidate(), [booking(), job()], [thread(), thread([message()], { key: "t2" })]).status).toBe("cannot_verify");
  });
  it("rejects impossible/offset-less dates, invalid timezones, reversed windows and future evidence", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "11/18/2026", "2026-11-1"]) {
      expect(isValidAuditDate(bad)).toBe(false);
      expect(run(candidate({}, { date: bad })).status).toBe("cannot_verify");
    }
    expect(run(candidate(), [booking({ date: "2026-02-30" }), job()]).status).toBe("cannot_verify");
    expect(auditBusinessDate("2026-11-12T15:00:00", timeZone)).toBeNull();
    expect(auditBusinessDate("2026-02-30T15:00:00.000Z", timeZone)).toBeNull();
    expect(run(candidate(), [booking(), job()], [thread([message({ occurredAt: "2026-11-12T15:00:00" })])]).status).toBe("cannot_verify");
    expect(run(candidate({}, { timeKind: "window", time: "11:00", windowEnd: "09:00" })).status).toBe("cannot_verify");
    const input = { auditDate, timeZone: "Not/A_Zone", asOf, candidates: [candidate()], records: [booking(), job()], threads: [thread()] };
    expect(verifyAuditCandidates(input)[0].status).toBe("cannot_verify");
    expect(verifyAuditCandidates({ ...input, timeZone, asOf: "bad" })[0].status).toBe("cannot_verify");
    expect(verifyAuditCandidates({ ...input, timeZone, asOf: "2026-11-12T14:00:00.000Z" })[0].status).toBe("cannot_verify");
  });
  it("normalizes explicit clocks and refuses invalid or underspecified clocks", () => {
    expect(normalizeAuditTime("9:00 AM")).toBe("09:00");
    expect(normalizeAuditTime("9 AM")).toBe("09:00");
    expect(normalizeAuditTime("12 PM")).toBe("12:00");
    expect(normalizeAuditTime("12 AM")).toBe("00:00");
    for (const bad of ["9", "25:00", "9:99 AM", "13 PM", "09:00:30", "morning"]) expect(normalizeAuditTime(bad)).toBeNull();
  });
  it("supersedes only a later validated same-customer candidate for the same job and action", () => {
    const old = candidate({ supersededByMessageKey: "m2" });
    const later = candidate({ id: "a2", anchorMessageKey: "m2", evidenceKeys: ["m2"] }, { time: "11:00" });
    const input = { auditDate, timeZone, asOf, candidates: [old, later], records: [booking({ time: "11:00" }), job({ time: "11:00" })], threads: [thread([message(), message({ key: "m2", occurredAt: "2026-11-12T16:00:00.000Z", text: "Correction: 11 AM is confirmed." })])] };
    expect(verifyAuditCandidates(input).map(item => item.status)).toEqual(["superseded", "matches"]);
    expect(verifyAuditCandidates({ ...input, candidates: [old] })[0].status).toBe("conflict");
  });
  it("supersedes a Nov 11 request with directly referenced Nov 12 provider context without rendering context", () => {
    const old = candidate({ agreement: "requested", supersededByMessageKey: "m2" });
    const later = candidate({ id: "a2", contextOnly: true, anchorMessageKey: "m2", evidenceKeys: ["m2"] }, { time: "10:00" });
    const input = { auditDate: "2026-11-11", timeZone, asOf, candidates: [old, later], records: [booking({ time: "10:00" }), job({ time: "10:00" })], threads: [thread([message({ occurredAt: "2026-11-11T15:00:00.000Z", direction: "inbound", delivery: "received", text: "Please move BK-7 to 9 AM." }), message({ key: "m2", text: "Correction: BK-7 is at 10 AM." })])] };
    const items = verifyAuditCandidates(input);
    expect(items.map(item => [item.id, item.status])).toEqual([["a1", "superseded"]]);
    expect(verifyAuditCandidates({ ...input, candidates: [later] })).toEqual([]);
    expect(verifyAuditCandidates({ ...input, candidates: [old, { ...later, contextOnly: false }] }).map(item => item.status)).toEqual(["needs_action", "cannot_verify"]);
  });
  it("cannot use unknown-time, future-asOf, missing-key or cross-customer context to suppress a request", () => {
    const old = candidate({ agreement: "requested", supersededByMessageKey: "m2" });
    const later = candidate({ id: "a2", contextOnly: true, anchorMessageKey: "m2", evidenceKeys: ["m2"] }, { time: "10:00" });
    const first = message({ occurredAt: "2026-11-11T15:00:00.000Z", direction: "inbound", delivery: "received" });
    const input = { auditDate: "2026-11-11", timeZone, asOf, candidates: [old, later], records: [] as AuditRecord[], threads: [thread([first, message({ key: "m2" })])] };
    // A missing scheduled visit cannot be hidden even by otherwise valid context.
    expect(verifyAuditCandidates(input)[0].status).toBe("cannot_verify");
    for (const overrides of [{ timeBasis: "unknown" as const }, { timeBasis: "history" as const }, { occurredAt: null }, { occurredAt: "2026-11-13T15:00:00.000Z" }, { customerPhone: "+12025550124" }, { delivery: "unknown" as const }]) {
      expect(verifyAuditCandidates({ ...input, records: [booking({ time: "10:00" }), job({ time: "10:00" })], threads: [thread([first, message({ key: "m2", ...overrides })])] })[0].status).toBe("needs_action");
    }
    expect(verifyAuditCandidates({ ...input, records: [booking({ time: "10:00" }), job({ time: "10:00" })], threads: [thread([first])] })[0].status).toBe("needs_action");
  });
  it("does not suppress a wrong state merely because a later candidate repeats the same instruction", () => {
    const old = candidate({ supersededByMessageKey: "m2" });
    const later = candidate({ id: "a2", anchorMessageKey: "m2", evidenceKeys: ["m2"] });
    const items = verifyAuditCandidates({ auditDate, timeZone, asOf, candidates: [old, later], records: [booking({ time: "11:00" }), job({ time: "11:00" })], threads: [thread([message(), message({ key: "m2", occurredAt: "2026-11-12T16:00:00.000Z" })])] });
    expect(items.map(item => item.status)).toEqual(["conflict", "conflict"]);
  });
  it("does not allow an unrelated later SMS or different action to suppress a conflict", () => {
    const old = candidate({ supersededByMessageKey: "m2" });
    const later = candidate({ id: "a2", action: "payment", anchorMessageKey: "m2", evidenceKeys: ["m2"] }, untimed({ amountCents: 12000 }));
    const input = { auditDate, timeZone, asOf, candidates: [old, later], records: [booking({ time: "11:00" }), job({ time: "11:00" })], threads: [thread([message(), message({ key: "m2", occurredAt: "2026-11-12T16:00:00.000Z", text: "Thanks for the payment link." })])] };
    expect(verifyAuditCandidates(input)[0].status).toBe("conflict");
  });
  it("rejects non-later corrections, different-booking corrections, and arbitrary candidate IDs", () => {
    const old = candidate({ supersededByMessageKey: "m2" });
    const later = candidate({ id: "a2", anchorMessageKey: "m2", evidenceKeys: ["m2"] }, { time: "11:00" });
    const input = { auditDate, timeZone, asOf, candidates: [old, later], records: [booking({ time: "11:00" }), job({ time: "11:00" })], threads: [thread([message(), message({ key: "m2", occurredAt: "2026-11-12T14:00:00.000Z" })])] };
    expect(verifyAuditCandidates(input)[0].status).toBe("conflict");
    const other = { ...later, expected: expectation({ bookingReference: "BK-8", time: "11:00" }) };
    expect(verifyAuditCandidates({ ...input, candidates: [old, other], records: [...input.records, booking({ key: "b8", bookingId: 8, publicBookingNumber: "BK-8", time: "11:00" }), job({ key: "j80", bookingId: 8, jobId: 80, time: "11:00" })], threads: [thread([message(), message({ key: "m2", occurredAt: "2026-11-12T16:00:00.000Z" })])] })[0].status).toBe("conflict");
    expect(run(candidate({ supersededByMessageKey: "arbitrary-llm-id" }), input.records).status).toBe("conflict");
    expect(verifyAuditCandidates({ ...input, candidates: [old, { ...later, id: old.id }] }).every(item => item.status === "cannot_verify")).toBe(true);
  });
  it("uses only fixed supported admin links with no customer information or invented query parameters", () => {
    expect(run().recordLinks).toEqual([{ label: "Bookings", href: "/admin/bookings" }, { label: "Schedule", href: "/admin/schedule" }]);
    expect(run(candidate(), []).recordLinks).toEqual([]);
  });
  it("is deterministic and leaves deep-frozen input unchanged without clocks or network calls", () => {
    const input = { auditDate, timeZone, asOf, candidates: [candidate()], records: [booking(), job()], threads: [thread()] };
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
    freeze(input);
    const before = JSON.stringify(input);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network forbidden"); });
    const clockSpy = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("implicit clock forbidden"); });
    try {
      const first = verifyAuditCandidates(input), second = verifyAuditCandidates(input);
      expect(first).toEqual(second);
      expect(JSON.stringify(input)).toBe(before);
      first[0].records[0].extras?.push("Changed output only");
      expect(JSON.stringify(input)).toBe(before);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(clockSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); clockSpy.mockRestore(); }
  });
  it("imports only shared types, the pure phone helper and static catalog, without runtime integration dependencies", () => {
    const source = readFileSync(new URL("./dailyActionAuditEngine.ts", import.meta.url), "utf8");
    const imports = source.match(/^import[\s\S]*?from ["'][^"']+["'];/gm) ?? [];
    expect(imports).toHaveLength(3);
    expect(imports[0]).toContain('import type');
    expect(imports[0]).toContain('../shared/dailyActionAudit');
    expect(imports[1]).toContain('./utils/phone');
    expect(imports[2]).toContain('../shared/bookingWidgetConfig');
    expect(source).not.toMatch(/\b(?:fetch|setTimeout|setInterval)\s*\(/);
  });
});

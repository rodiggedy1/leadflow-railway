import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { AuditActionType, AuditDayCollection, AuditExpectation, AuditItem, AuditMessage, AuditStatus, DailyActionAuditResult } from "../shared/dailyActionAudit";
import * as auditFailures from "../shared/dailyActionAudit";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "../shared/bookingWidgetConfig";

// LOCAL ONLY: transpile and exercise the actual page source. No app/router,
// provider, DB, browser, live customer data, network, or classifier imports.
const root = resolve(import.meta.dirname, "..");
const pageSource = readFileSync(resolve(root, "client/src/pages/DailyActionAudit.tsx"), "utf8");
const icon = (props: any) => React.createElement("svg", props);
const icons = new Proxy({}, { get: () => icon });
const PHONE = "+13015550123";
const NAME = "Synthetic customer";
const ORDER: AuditStatus[] = ["needs_action", "conflict", "cannot_verify", "matches", "superseded"];

type Person = {
  key: string; customerPhone: string; customerName: string | null;
  nameConflict: boolean; items: AuditItem[]; reviewCount: number; status: AuditStatus;
};
type Summary = {
  people: number; actions: number; needsReview: number; matches: number; superseded: number;
  totals: Record<AuditStatus, number>;
};
type ActualUi = {
  groupAuditPeople(items: AuditItem[]): Person[];
  summarizeAuditItems(items: AuditItem[]): Summary;
  actionSummary(item: AuditItem): string;
  AuditResults: React.ComponentType<{ result: DailyActionAuditResult; filter?: "all" | "affectsTomorrow" }>;
  mergeAuditBatches(previous: DailyActionAuditResult | null, next: DailyActionAuditResult): DailyActionAuditResult;
  isSafeAuditRecordLink(href: string): boolean;
};

function load(react: any = React, clock: typeof Date = Date): ActualUi {
  const module = { exports: {} as ActualUi };
  const output = ts.transpileModule(pageSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  runInNewContext(output, {
    module, exports: module.exports, Date: clock, Intl, Error, Map, Set,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc: {} };
      if (id === "@shared/dailyActionAudit") return auditFailures;
      if (id === "@shared/bookingWidgetConfig") return { BOOKING_WIDGET_PRICED_EXTRAS };
      if (id === "@/components/daily-action-audit/AuditCalendar") return { __esModule: true, default: () => null };
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected actual compact UI import: ${id}`);
    },
  }, { timeout: 1500 });
  return module.exports;
}
const ui = load();
const totals = (): Record<AuditStatus, number> => ({ needs_action: 0, conflict: 0, cannot_verify: 0, matches: 0, superseded: 0 });
function sms(key: string, overrides: Partial<AuditMessage> = {}): AuditMessage {
  return {
    key, sessionId: 1, customerPhone: PHONE, businessPhone: "+13015550987", direction: "inbound",
    text: "Please move the visit to Friday at 10.", occurredAt: "2026-11-11T17:00:00Z",
    observedAt: "2026-11-11T17:01:00Z", timeBasis: "provider", delivery: "received", source: "inbound_sms", ...overrides,
  };
}
function item(id: string, status: AuditStatus = "needs_action", overrides: Partial<AuditItem> = {}): AuditItem {
  return {
    id, action: "reschedule", agreement: "confirmed", status, customerPhone: PHONE, customerName: NAME,
    affectedDate: "2026-11-13",
    expected: {
      bookingReference: "REF-1", date: "2026-11-13", originalDate: "2026-11-12", time: "10:00", timeKind: "exact",
      windowEnd: null, scope: "visit", address: "Expected synthetic address", serviceName: "Standard",
      extras: ["Oven"], extrasMode: "add", teamName: "Expected Team A", amountCents: 15000,
    },
    explanation: `Synthetic explanation ${id}`, verification: `Synthetic verification ${id}`,
    evidence: [sms(`${id}-request`), sms(`${id}-reply`, { direction: "outbound", delivery: "sent", source: "madison_sent", text: "Confirmed, Friday at 10." })],
    records: [{
      key: `record-${id}`, source: "bookings", bookingId: 1, jobId: null, publicBookingNumber: `TEST-${id}`, seriesId: null,
      customerPhone: PHONE, customerName: NAME, date: "2026-11-12", time: "09:00", timeZone: "America/New_York", status: "scheduled",
      address: "Actual synthetic address", serviceName: "Deep clean", extras: [], teamName: "Actual Team B",
      recurrence: "weekly", paymentStatus: "unpaid", paidAmountCents: 0,
    }],
    recordLinks: [{ label: "Bookings", href: "/admin/bookings" }, { label: "Schedule", href: "/admin/schedule" }],
    verifiedAt: "2026-11-12T15:00:00Z", ...overrides,
  };
}
function result(items: AuditItem[] = [], overrides: Partial<DailyActionAuditResult> = {}): DailyActionAuditResult {
  const counts = totals();
  for (const entry of items) counts[entry.status]++;
  return {
    auditDate: "2026-11-11", timeZone: "America/New_York", asOf: "2026-11-12T15:00:00Z", items, totals: counts,
    coverage: { status: "partial", messagesRead: 8, threadsRead: 3, threadsAnalyzed: 2, truncated: false, warnings: [] },
    nextCursor: null, ...overrides,
  };
}
function collection(overrides: Partial<AuditDayCollection> = {}): AuditDayCollection {
  return { status: "complete", scope: "organization", start: "2026-11-11T05:00:00Z", end: "2026-11-12T05:00:00Z",
    messages: [{ id: "RAW-1", from: PHONE, to: ["+13015550987", "+13015550124"], text: "Synthetic grouped source", phoneNumberId: "LINE-1",
      conversationId: "GROUP-1", direction: "incoming", status: "received", createdAt: "2026-11-11T17:00:00Z", updatedAt: "2026-11-11T17:01:00Z", media: [] }],
    pagesRead: 2, incoming: 1, outgoing: 0, duplicates: 0, outOfWindow: 0, failure: null, ...overrides };
}
function expected(overrides: Partial<AuditExpectation>): AuditExpectation { return { ...item("base").expected, ...overrides }; }
const htmlFor = (value: DailyActionAuditResult, filter: "all" | "affectsTomorrow" = "all", loaded = ui) => renderToStaticMarkup(React.createElement(loaded.AuditResults, { result: value, filter }));

// Resolve only the actual pure result components, so hierarchy tests can distinguish
// visible system evidence from optional nested record/SMS details without a DOM.
type Node = { type: string; props: Record<string, any>; children: Node[]; text: string };
function nodes(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (typeof value === "string" || typeof value === "number") return [{ type: "#text", props: {}, children: [], text: String(value) }];
  if (!React.isValidElement(value)) return [];
  const props = value.props as any;
  if (typeof value.type === "function") return nodes((value.type as any)(props));
  if (typeof value.type !== "string") return nodes(props.children);
  const children = nodes(props.children);
  return [{ type: value.type, props, children, text: children.map(child => child.text).join("") }];
}
function flatten(values: Node[]): Node[] { return values.flatMap(node => [node, ...flatten(node.children)]); }
function classIs(node: Node, name: string) { return String(node.props.className ?? "").split(/\s+/).includes(name); }
function rendered(value: DailyActionAuditResult) { return flatten(nodes(React.createElement(ui.AuditResults, { result: value }))); }
function withoutNestedDetails(node: Node): string {
  return node.type === "details" ? "" : node.type === "#text" ? node.text : node.children.map(withoutNestedDetails).join("");
}
function parse(source: string) { return ts.createSourceFile("actual.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function all<T extends ts.Node>(node: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (child: ts.Node) => { if (guard(child)) found.push(child); ts.forEachChild(child, visit); };
  visit(node); return found;
}

describe("Daily Action Audit compact actual-source grouping", () => {
  it("exports the agreed pure helper contracts", () => {
    for (const helper of [ui.groupAuditPeople, ui.summarizeAuditItems, ui.actionSummary]) expect(helper).toBeTypeOf("function");
    expect(ui.groupAuditPeople([])).toEqual([]);
    expect(ui.summarizeAuditItems([])).toEqual({ people: 0, actions: 0, needsReview: 0, matches: 0, superseded: 0, totals: totals() });
  });

  it("keeps one exact canonical person across several dates, actions, and manual batches", () => {
    const first = result([item("move"), item("pay", "matches", { action: "payment", affectedDate: "2026-11-14" })], {
      nextCursor: { sessionAfterId: 20, inboundAfterId: 100, asOf: "2026-11-12T15:00:00Z" },
    });
    const next = result([item("address", "conflict", { action: "address", affectedDate: "2026-11-20" }), item("move", "matches")]);
    const merged = ui.mergeAuditBatches(first, next);
    const people = ui.groupAuditPeople(merged.items);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ customerPhone: PHONE, customerName: NAME, nameConflict: false, reviewCount: 1, status: "conflict" });
    expect(people[0].items.map(entry => entry.id).sort()).toEqual(["address", "move", "pay"]);
    const tree = rendered(merged);
    expect(tree.filter(node => node.type === "details" && classIs(node, "daa-person"))).toHaveLength(1);
    expect(tree.filter(node => classIs(node, "daa-action"))).toHaveLength(3);
  });

  it("never merges the same name at different canonical phones or fuzzy similar names", () => {
    const people = ui.groupAuditPeople([
      item("a"), item("b", "matches", { customerPhone: "+13015550124" }),
      item("c", "conflict", { customerPhone: "+13015550125", customerName: "Synthetic Customer Jr" }),
    ]);
    expect(people).toHaveLength(3);
    expect(new Set(people.map(person => person.key)).size).toBe(3);
    expect(people.map(person => person.customerPhone).sort()).toEqual([PHONE, "+13015550124", "+13015550125"]);
  });

  it("keeps missing, invalid, and merely formatted phones separate per item without client normalization", () => {
    const phones = ["", "", "invalid", "invalid", "+15550101234", "+15550101234", "3015550123", "3015550123", "(301) 555-0123", "(301) 555-0123"];
    const entries = phones.map((customerPhone, index) => item(`missing-${index}`, "cannot_verify", { customerPhone, customerName: NAME }));
    const people = ui.groupAuditPeople([item("canonical"), ...entries]);
    expect(people).toHaveLength(entries.length + 1);
    expect(new Set(people.map(person => person.key)).size).toBe(entries.length + 1);
    expect(people.every(person => person.items.length === 1)).toBe(true);
    expect(people.find(person => person.items[0].id === "canonical")?.customerPhone).toBe(PHONE);
  });

  it("does not select an unrelated name or declare matches when one phone has conflicting names", () => {
    const entries = [item("a", "matches", { customerName: "Synthetic Alpha" }), item("b", "matches", { customerName: "Synthetic Beta" })];
    const people = ui.groupAuditPeople(entries);
    expect(people).toHaveLength(1);
    expect(people[0].nameConflict).toBe(true);
    expect(people[0].customerName).toBeNull();
    expect(people[0].items).toHaveLength(2);
    expect(people[0].items.map(entry => entry.status)).toEqual(["matches", "matches"]);
    const rows = rendered(result(entries)).filter(node => classIs(node, "daa-person-summary"));
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toContain(PHONE);
    expect(rows[0].text).toMatch(/name.*(?:conflict|review)|(?:conflict|review).*name/i);
    expect(rows[0].text).not.toContain("Synthetic Alpha");
    expect(rows[0].text).not.toContain("Synthetic Beta");
  });

  it("a missing name is not a conflict and missing names never merge distinct phones", () => {
    const people = ui.groupAuditPeople([item("unnamed", "matches", { customerName: null }), item("named", "matches"), item("other", "matches", { customerName: null, customerPhone: "+13015550124" })]);
    expect(people).toHaveLength(2);
    expect(people.find(person => person.customerPhone === PHONE)).toMatchObject({ customerName: NAME, nameConflict: false });
    expect(people.find(person => person.customerPhone === "+13015550124")).toMatchObject({ customerName: null, nameConflict: false });
  });

  it("deduplicates item IDs using the latest input entry before grouping and recounting every status", () => {
    const entries = [item("duplicate", "matches", { customerPhone: "+13015550124" }), item("needs"), item("conflict", "conflict"), item("unknown", "cannot_verify"), item("match", "matches"), item("old", "superseded"), item("duplicate", "conflict")];
    const before = JSON.stringify(entries);
    const people = ui.groupAuditPeople(entries);
    expect(people).toHaveLength(1);
    expect(people[0].items).toHaveLength(6);
    expect(people[0].items.find(entry => entry.id === "duplicate")).toBe(entries[6]);
    expect(people[0].reviewCount).toBe(4);
    expect(people[0].status).toBe("needs_action");
    expect(ui.summarizeAuditItems(entries)).toEqual({
      people: 1, actions: 6, needsReview: 4, matches: 1, superseded: 1,
      totals: { needs_action: 1, conflict: 2, cannot_verify: 1, matches: 1, superseded: 1 },
    });
    expect(JSON.stringify(entries)).toBe(before);
    expect(entries[0].status).toBe("matches");
    const summary = ui.summarizeAuditItems(entries);
    const html = htmlFor(result(entries, { totals: { needs_action: 99, conflict: 99, cannot_verify: 99, matches: 99, superseded: 99 } }));
    for (const status of ORDER) expect(html).toContain(`data-status-count="${status}"><strong>${summary.totals[status]}</strong>`);
    expect(rendered(result(entries)).filter(node => classIs(node, "daa-action"))).toHaveLength(6);
  });

  it("sorts people and their actions by the existing severity order without changing the input", () => {
    const entries = [...ORDER].reverse().map((status, index) => item(status, status, { customerPhone: `+1301555012${index + 3}` }));
    const original = entries.map(entry => entry.id);
    expect(ui.groupAuditPeople(entries).map(person => person.status)).toEqual(ORDER);
    const samePerson = entries.map(entry => ({ ...entry, customerPhone: PHONE }));
    expect(ui.groupAuditPeople(samePerson)[0].items.map(entry => entry.status)).toEqual(ORDER);
    expect(entries.map(entry => entry.id)).toEqual(original);
  });

  it("accepts frozen input and nested fixtures without mutating or losing actions", () => {
    const entries = [item("z", "superseded"), item("a")];
    for (const entry of entries) {
      Object.freeze(entry.expected); Object.freeze(entry.evidence); Object.freeze(entry.records); Object.freeze(entry);
    }
    Object.freeze(entries);
    expect(() => ui.groupAuditPeople(entries)).not.toThrow();
    expect(() => ui.summarizeAuditItems(entries)).not.toThrow();
    expect(() => ui.actionSummary(entries[0])).not.toThrow();
    expect(entries.map(entry => entry.id)).toEqual(["z", "a"]);
  });
});

describe("Daily Action Audit compact structured action summaries", () => {
  const cases: Array<[AuditActionType, RegExp, Partial<AuditExpectation>, RegExp[]]> = [
    ["reschedule", /reschedul|move/i, { time: "10:00", windowEnd: "12:00", timeKind: "window" }, [/10:00/, /12:00/, /window/i]],
    ["cancel", /cancel/i, {}, []],
    ["book", /book/i, { serviceName: "Synthetic booking service" }, [/Synthetic booking service/]],
    ["address", /address/i, { address: "Synthetic new address" }, [/Synthetic new address/]],
    ["service", /service/i, { serviceName: "Synthetic changed service", extras: ["Oven"], extrasMode: "remove" }, [/Synthetic changed service/, /Oven/i, /remove/i]],
    ["assignment", /team|assign/i, { teamName: "Synthetic new team" }, [/Synthetic new team/]],
    ["payment", /payment|pay/i, { amountCents: 15000 }, [/\$150\.00/]],
  ];
  it.each(cases)("summarizes %s from structured fields, including affected date and relevant values", (action, label, change, values) => {
    const entry = item(`summary-${action}`, "needs_action", { action, expected: expected(change), explanation: "RAW EXPLANATION NOT AN ACTION SUMMARY", evidence: [sms("raw", { text: "RAW FULL CONVERSATION SHOULD NOT BECOME THE SUMMARY" })] });
    const summary = ui.actionSummary(entry);
    expect(summary).toMatch(label);
    expect(summary).toMatch(/Nov\s*13|Nov[^\n]*13|2026-11-13/);
    for (const value of values) expect(summary).toMatch(value);
    expect(summary).not.toContain("RAW EXPLANATION");
    expect(summary).not.toContain("RAW FULL CONVERSATION");
  });

  it("retains original/affected dates, exact time, and subsequent scope rather than implying only this visit", () => {
    const summary = ui.actionSummary(item("later", "needs_action", { expected: expected({ scope: "subsequent", time: "10:00", timeKind: "exact" }) }));
    expect(summary).toMatch(/Nov[^\n]*12|2026-11-12/);
    expect(summary).toMatch(/Nov[^\n]*13|2026-11-13/);
    expect(summary).toMatch(/10:00/);
    expect(summary).toMatch(/subsequent|later|future visits/i);
  });

  it("preserves an affected date even if the expected date differs", () => {
    const summary = ui.actionSummary(item("affected", "needs_action", { affectedDate: "2026-11-20", expected: expected({ date: "2026-11-13" }) }));
    expect(summary).toMatch(/Nov[^\n]*20|2026-11-20/);
  });

  it("makes unsupported/missing action values, dates, times, and scope explicit rather than invented", () => {
    const empty: AuditExpectation = { bookingReference: null, date: null, originalDate: null, time: null, timeKind: "unspecified", windowEnd: null, scope: "unspecified", address: null, serviceName: null, extras: null, extrasMode: "unspecified", teamName: null, amountCents: null };
    for (const action of cases.map(([action]) => action)) {
      const summary = ui.actionSummary(item(`missing-${action}`, "cannot_verify", { action, affectedDate: null, expected: { ...empty } }));
      expect(summary).toMatch(/date.*(?:not available|unavailable|missing|unspecified|unknown|unresolved)|(?:not available|unavailable|missing|unspecified|unknown|unresolved).*date/i);
      expect(summary).toMatch(/not available|unavailable|missing|unspecified|unknown|unsupported|unresolved/i);
      expect(summary).not.toContain("undefined");
      expect(summary).not.toContain("NaN");
      expect(summary).not.toContain("$0.00");
      expect(summary).not.toContain("This visit");
    }
    const reschedule = ui.actionSummary(item("missing-time", "cannot_verify", { expected: { ...empty } }));
    expect(reschedule).toMatch(/time.*(?:not available|unavailable|missing|unspecified|unknown)|(?:not available|unavailable|missing|unspecified|unknown).*time/i);
    expect(reschedule).toMatch(/scope.*(?:not available|unavailable|missing|unspecified|unknown)|(?:not available|unavailable|missing|unspecified|unknown).*scope/i);
  });

  it("preserves zero payment amounts, empty extras, and the extras operation without inventing payment completion", () => {
    expect(ui.actionSummary(item("zero", "matches", { action: "payment", expected: expected({ amountCents: 0 }) }))).toContain("$0.00");
    const service = ui.actionSummary(item("extras", "cannot_verify", { action: "service", expected: expected({ extras: [], extrasMode: "replace" }) }));
    expect(service).toMatch(/replace/i);
    expect(service).toMatch(/none|empty|no extras/i);
  });
});

describe("Daily Action Audit compact result hierarchy and safety", () => {
  it("renders overall summary before one collapsed native details row per person, not full date cards or a conversation view", () => {
    const value = result([item("move"), item("pay", "matches", { action: "payment", affectedDate: "2026-11-20" })]);
    const tree = rendered(value);
    const overview = tree.find(node => classIs(node, "daa-overview"));
    const people = tree.filter(node => classIs(node, "daa-person"));
    expect(overview?.text).toMatch(/overall summary/i);
    expect(people).toHaveLength(1);
    expect(tree.indexOf(overview!)).toBeLessThan(tree.indexOf(people[0]));
    expect(people[0].type).toBe("details");
    expect([undefined, false]).toContain(people[0].props.open);
    expect(people[0].children[0].type).toBe("summary");
    expect(classIs(people[0].children[0], "daa-person-summary")).toBe(true);
    expect(people[0].children[0].text).toContain(NAME);
    expect(people[0].children[0].text).toContain(PHONE);
    expect(tree.some(node => classIs(node, "daa-person-body"))).toBe(true);
    for (const details of tree.filter(node => node.type === "details")) expect([undefined, false]).toContain(details.props.open);
    const html = htmlFor(value);
    expect(html).toMatch(/by person/i);
    expect(html).not.toContain("daa-date-group");
    expect(html).not.toContain("daa-audit-card");
    expect(html).not.toMatch(/full conversation|view full thread|conversation viewer/i);
    expect(tree.some(node => classIs(node, "daa-coverage-details"))).toBe(true);
    expect(tree.some(node => classIs(node, "daa-record-details"))).toBe(true);
    expect(tree.some(node => classIs(node, "daa-evidence"))).toBe(true);
  });

  it("retains every action and actual system record evidence directly under the person expansion", () => {
    const actionTypes: AuditActionType[] = ["reschedule", "cancel", "book", "address", "service", "assignment", "payment"];
    const entries = actionTypes.map((action, index) => item(`action-${index}`, ORDER[index % ORDER.length], { action }));
    const tree = rendered(result(entries));
    const actions = tree.filter(node => classIs(node, "daa-action"));
    expect(actions).toHaveLength(7);
    expect(actions.map(node => node.props["data-audit-status"])).toEqual([...entries].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)).map(entry => entry.status));
    const body = tree.find(node => classIs(node, "daa-person-body"))!;
    const visible = withoutNestedDetails(body);
    expect(visible).toMatch(/action items/i);
    expect(visible).toMatch(/system record evidence/i);
    for (const entry of entries) expect(visible).toContain(entry.verification);
    // A further SMS/full-record expander must not be required to see what
    // the current system actually records, distinct from the SMS expectation.
    expect(visible).toContain("Actual Team B");
    expect(visible).toMatch(/Nov[^\n]*12|2026-11-12/);
    expect(visible).toContain("09:00");
    expect(visible).toContain("scheduled");
    expect(visible).toContain("Actual synthetic address");
    expect(visible).toContain("Deep clean");
    expect(visible).toContain("unpaid");
    expect(visible).toContain("$0.00");
  });

  it("keeps full-scan identity conflicts visible when tomorrow shows only one of that phone's actions", () => {
    const value = result([
      item("tomorrow", "matches", { customerName: "Synthetic Alpha", affectedDate: "2026-11-13" }),
      item("later", "needs_action", { customerName: "Synthetic Beta", affectedDate: "2026-11-20" }),
    ]);
    const html = htmlFor(value, "affectsTomorrow");
    const row = html.match(/<summary class="daa-person-summary">([\s\S]*?)<\/summary>/)?.[1];
    expect(row).toContain("Name needs review");
    expect(row).toContain(PHONE);
    expect(row).not.toContain("Synthetic Alpha");
    expect(row).not.toContain("Synthetic Beta");
    expect(row).toContain("1 action");
    expect(row).toContain("0 need review");
    expect(row).toContain("Matches now");
    expect(html).toContain("Different names appear for this phone");
    expect(html).toContain("1 of 2 actions");
    expect(value.items.map(entry => entry.status)).toEqual(["matches", "needs_action"]);
  });

  it.each(["reschedule", "book"] as const)("shows every compared actual field for %s without another action supplying the evidence", action => {
    const base = item("schedule-fields", "conflict", { action });
    const entry = { ...base, verification: "The actual team and extras differ from the requested values.", records: [{ ...base.records[0], extras: ["Oven"] }] };
    const body = rendered(result([entry])).find(node => classIs(node, "daa-person-body"))!;
    const visible = withoutNestedDetails(body);
    for (const evidence of ["Actual address: Actual synthetic address", "Actual service: Deep clean", "Actual extras: Oven", "Actual team: Actual Team B", entry.verification, "09:00", "scheduled"]) expect(visible).toContain(evidence);
  });

  it.each(["reschedule", "book"] as const)("does not turn missing compared %s system fields into proof", action => {
    const base = item("missing-fields", "cannot_verify", { action });
    const entry = { ...base, records: [{ ...base.records[0], address: null, serviceName: null, extras: null, teamName: null }] };
    const body = rendered(result([entry])).find(node => classIs(node, "daa-person-body"))!;
    const visible = withoutNestedDetails(body);
    for (const evidence of ["Actual address: unavailable", "Actual service: unavailable", "Actual extras: unavailable", "Actual team: unavailable", "Cannot verify"]) expect(visible).toContain(evidence);
    expect(entry.status).toBe("cannot_verify");
  });

  it("keeps partial and empty/all-matched scans explicitly incomplete, with warnings and no Done/Completed claim", () => {
    for (const entries of [[], [item("matched", "matches")]]) {
      const value = result(entries, { coverage: { status: "partial", messagesRead: 9, threadsRead: 3, threadsAnalyzed: 1, truncated: true, warnings: ["Synthetic source unavailable"] } });
      const html = htmlFor(value);
      expect(html).toContain("Partial coverage");
      expect(html).toContain("not a complete reconciliation");
      expect(html).toContain("Coverage remains partial");
      expect(html).toContain("Synthetic source unavailable");
      expect(html).toContain("Scan truncated.");
      expect(html).not.toContain("All messages reviewed");
      expect(html).not.toMatch(/>\s*(?:Done|Completed|All done)\s*</i);
    }
    expect(htmlFor(result())).toContain("An empty scan does not confirm");
    expect(htmlFor(result([item("match", "matches")]))).toContain("Matches now");
  });

  it("sent Madison SMS and current-state matches never become proof of action completion", () => {
    const entry = item("sent", "matches", { evidence: [sms("sent", { direction: "outbound", delivery: "sent", source: "madison_sent", text: "I have sent the requested confirmation." })] });
    const html = htmlFor(result([entry]));
    expect(html).toContain("Matches now");
    expect(html).toContain("Madison sent SMS");
    expect(html).toMatch(/does not establish when an action (?:was completed|happened)/);
    expect(html).not.toMatch(/>\s*(?:Done|Completed|All done)\s*</i);
    expect(html).not.toContain("completed yesterday");
    expect(ui.actionSummary(entry)).not.toMatch(/\bdone\b|\bcompleted\b/i);
  });

  it("keeps missing records and SMS evidence explicit in the compact view", () => {
    const entry = item("missing", "cannot_verify", { evidence: [], records: [], affectedDate: null, expected: expected({ date: null, originalDate: null, time: null }), verification: "" });
    const html = htmlFor(result([entry]));
    expect(html).toContain("No matching current record was available");
    expect(html).toContain("This is not proof that the action was missed");
    expect(html).toContain("Source SMS evidence is missing");
    expect(html).toContain("Do not treat this item as a verified agreement");
    expect(html).toContain("Verification detail unavailable");
    expect(html).toMatch(/date unresolved|Service date: undated \/ unresolved/);
  });

  it("renders only fixed safe local links and React-escapes names, summaries, records, explanations, warnings, and SMS", () => {
    const unsafe = '<script>bad()</script> https://external.invalid/';
    const badLinks = ["javascript:bad()", "//external.invalid", "https://external.invalid", "/admin/bookings?phone=3015550123", "/admin/bookings?jobId=1", "/admin/schedule#3015550123", "/admin/bookings/../settings"];
    const base = item("safe");
    const entry = item("safe", "needs_action", { customerName: unsafe, action: "address", expected: expected({ address: unsafe }), explanation: unsafe, verification: unsafe,
      records: [{ ...base.records[0], address: unsafe }], evidence: [sms("unsafe", { text: unsafe })],
      recordLinks: [...base.recordLinks, ...badLinks.map(href => ({ label: unsafe, href }))],
    });
    const html = htmlFor(result([entry], { coverage: { ...result().coverage, warnings: [unsafe] } }));
    expect([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual(["/admin/bookings", "/admin/schedule"]);
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/>\s*(Fix|Send|Reschedule)\s*</i);
    for (const href of badLinks) expect(ui.isSafeAuditRecordLink(href)).toBe(false);
    expect(ui.isSafeAuditRecordLink("/admin/bookings")).toBe(true);
    expect(ui.isSafeAuditRecordLink("/admin/schedule")).toBe(true);
  });

  it("uses fixed snapshot Eastern Time for tomorrow regardless of machine clock and retains ET evidence timestamps", () => {
    const clock = (now: string) => class extends Date {
      constructor(value?: string | number) { super(value ?? now); }
      static now() { return Date.parse(now); }
    } as typeof Date;
    const value = result([
      item("ET", "needs_action", { customerName: "Synthetic ET", affectedDate: "2026-11-12" }),
      item("UTC", "conflict", { customerName: "Synthetic UTC", customerPhone: "+13015550124", affectedDate: "2026-11-13" }),
      item("undated", "cannot_verify", { customerName: "Synthetic undated", customerPhone: "+13015550125", affectedDate: null }),
    ], { asOf: "2026-11-12T02:00:00Z" });
    const early = htmlFor(value, "affectsTomorrow", load(React, clock("2000-01-01T00:00:00Z")));
    const late = htmlFor(value, "affectsTomorrow", load(React, clock("2099-12-31T23:59:59Z")));
    expect(early).toBe(late);
    expect(early).toContain("Synthetic ET");
    expect(early).not.toContain("Synthetic UTC");
    expect(early).not.toContain("Synthetic undated");
    expect(early).toContain("1 of 3 actions");
    expect(early).toContain("Nov 11, 2026, 9:00 PM EST");
    expect(early).toContain("Nov 11, 2026, 12:00 PM EST");
    expect(early).toContain("Undated items are excluded");
    expect(htmlFor({ ...value, asOf: "invalid" }, "affectsTomorrow")).toContain("snapshot timestamp is invalid");
  });

  it("handles invalid and timezone-less timestamps without browser-local interpretations or Intl exceptions", () => {
    const value = result([item("invalid", "cannot_verify", { affectedDate: "2026-02-31", expected: expected({ date: "invalid" }), verifiedAt: "invalid", evidence: [sms("bad", { occurredAt: "2026-11-11T10:00:00", observedAt: "invalid" })] })]);
    expect(() => htmlFor(value)).not.toThrow();
    const html = htmlFor(value);
    expect(html).toContain("Date not available");
    expect(html).toContain("Timestamp unavailable");
    expect(html).not.toContain("Invalid Date");
  });

  it("pure grouping, summaries, and result rendering add no hooks, mutations, timers, or network work", () => {
    const forbiddenHook = vi.fn(() => { throw new Error("Compact read-only results may not invoke hooks"); });
    const local = load({ ...React, useState: forbiddenHook, useEffect: forbiddenHook, useRef: forbiddenHook, useMemo: forbiddenHook, useCallback: forbiddenHook });
    const entries = [item("read-only")];
    local.groupAuditPeople(entries); local.summarizeAuditItems(entries); local.actionSummary(entries[0]);
    expect(() => htmlFor(result(entries), "all", local)).not.toThrow();
    expect(forbiddenHook).not.toHaveBeenCalled();
    const source = parse(pageSource);
    const calls = all(source, ts.isCallExpression).map(node => node.expression.getText(source));
    expect(calls.filter(call => call.endsWith(".useQuery"))).toEqual(["trpc.agents.me.useQuery"]);
    expect(calls.filter(call => call.endsWith(".useMutation"))).toEqual(["trpc.aiActions.dailyAudit.run.useMutation"]);
    expect(calls.filter(call => call.endsWith(".mutateAsync"))).toEqual(["run.mutateAsync"]);
    expect(calls.filter(call => call === "useEffect")).toHaveLength(1);
    expect(calls.filter(call => call === "useState")).toHaveLength(8);
    expect(calls.filter(call => call === "useRef")).toHaveLength(4);
    for (const forbidden of ["fetch(", "setInterval", "setTimeout", "WebSocket", "EventSource", "localStorage", "sessionStorage", "dangerouslySetInnerHTML"]) expect(pageSource).not.toContain(forbidden);
    const namedFunctions = all(source, ts.isFunctionDeclaration);
    for (const name of ["groupAuditPeople", "summarizeAuditItems", "actionSummary", "AuditResults"]) {
      const declaration = namedFunctions.find(node => node.name?.text === name);
      expect(declaration, `${name} remains in actual source`).toBeTruthy();
      const bodyCalls = all(declaration!, ts.isCallExpression).map(node => node.expression.getText(source));
      expect(bodyCalls.some(call => /(?:^|\.)use[A-Z]|mutate|fetch|setTimeout|setInterval/.test(call))).toBe(false);
    }
  });

  it("keeps proven SMS status and one closed source expander ahead of the compact overall summary and people", () => {
    const value = result([item("move"), item("pay", "matches", { action: "payment" })], { collection: collection(),
      analysis: { status: "partial", threadsTotal: 3, threadsAnalyzed: 2, failedThreads: 1, omittedMessages: 0, unsupportedMessages: 1 } });
    const tree = rendered(value);
    const sourceStatus = tree.find(node => classIs(node, "daa-collection-status"))!;
    const corpus = tree.find(node => classIs(node, "daa-day-sms"))!;
    const analysis = tree.find(node => classIs(node, "daa-analysis-status"))!;
    const overview = tree.find(node => classIs(node, "daa-overview"))!;
    const person = tree.find(node => classIs(node, "daa-person"))!;
    expect(tree.indexOf(sourceStatus)).toBeLessThan(tree.indexOf(overview));
    expect(tree.indexOf(corpus)).toBeLessThan(tree.indexOf(overview));
    expect(tree.indexOf(analysis)).toBeLessThan(tree.indexOf(overview));
    expect(tree.indexOf(overview)).toBeLessThan(tree.indexOf(person));
    expect(sourceStatus.text).toContain("SMS collection complete · all organization lines");
    expect(sourceStatus.text).toContain("1 unique SMS · 1 incoming · 0 outgoing · 2 pages read");
    expect(analysis.text).toContain("2 of 3 threads analyzed · 1 failed · 1 unsupported messages · 0 omitted messages");
    expect(corpus.type).toBe("details"); expect(corpus.props.open).toBeUndefined();
    expect(corpus.children[0].type).toBe("summary");
    expect(tree.filter(node => classIs(node, "daa-day-sms"))).toHaveLength(1);
    expect(tree.filter(node => classIs(node, "daa-person"))).toHaveLength(1);
    expect(tree.filter(node => classIs(node, "daa-action"))).toHaveLength(2);
    expect(person.props.open).toBeUndefined();
    expect(withoutNestedDetails(person.children.find(node => classIs(node, "daa-person-body"))!)).toContain("System record evidence");
    expect(htmlFor(value)).not.toMatch(/full conversation|view full thread|conversation viewer/i);
  });

  it("legacy 57-message/13-thread/zero-analysis results never show a zero-action summary or empty-action finding", () => {
    const value = result([], { coverage: { status: "partial", messagesRead: 57, threadsRead: 13, threadsAnalyzed: 0, truncated: false, warnings: [] } });
    const html = htmlFor(value);
    expect(html).toContain("SMS loaded; analysis unavailable");
    expect(html).toContain("0 of 13 threads analyzed");
    expect(html).toContain("SMS collection completeness not established");
    expect(html).not.toContain("Overall summary");
    expect(html).not.toContain("No actionable items");
    expect(html).not.toContain('data-status-count=');
  });

  it("shows validated partial chunk findings even when no entire conversation completed analysis", () => {
    const value = result([item("partial-chunk", "needs_action")], { collection: collection(),
      analysis: { status: "partial", threadsTotal: 1, threadsAnalyzed: 0, failedThreads: 1, omittedMessages: 0, unsupportedMessages: 0 } });
    const html = htmlFor(value);
    expect(html).toContain("Partial action analysis · returned findings only");
    expect(html).toContain("0 of 1 threads analyzed · 1 failed");
    expect(html).toContain("Overall summary"); expect(html).toContain('data-audit-status="needs_action"');
    expect(html).not.toContain("No actionable items"); expect(html).not.toContain("Action analysis complete");
  });

  it("source failure or unavailable analysis cannot surface stale item findings while retaining captured SMS", () => {
    const unavailable: DailyActionAuditResult[] = [
      result([item("stale", "matches")], { collection: collection({ status: "failed", failure: "ACCESS" }) }),
      result([item("stale", "matches")], { collection: collection(), analysis: { status: "failed", threadsTotal: 1, threadsAnalyzed: 0, failedThreads: 1, omittedMessages: 0, unsupportedMessages: 0 } }),
    ];
    for (const value of unavailable) {
      const html = htmlFor(value);
      expect(html).toContain('data-sms-id="RAW-1"');
      expect(html).not.toContain("Overall summary");
      expect(html).not.toContain("No actionable items");
      expect(html).not.toContain('data-audit-status="matches"');
      expect(html).not.toContain('data-status-count=');
    }
  });

  it("source grouping never changes existing action identity/conflicts/status when tomorrow filters the actions", () => {
    const entries = [item("tomorrow", "matches", { customerName: "Synthetic Alpha" }), item("later", "needs_action", { customerName: "Synthetic Beta", affectedDate: "2026-11-20" })];
    const value = result(entries, { collection: collection(), analysis: { status: "complete", threadsTotal: 1, threadsAnalyzed: 1, failedThreads: 0, omittedMessages: 0, unsupportedMessages: 0 } });
    const html = htmlFor(value, "affectsTomorrow");
    const row = html.match(/<summary class="daa-person-summary">([\s\S]*?)<\/summary>/)?.[1];
    expect(row).toContain("Name needs review"); expect(row).toContain("Matches now");
    expect(row).toContain("1 action"); expect(row).toContain("0 need review");
    expect(html).toContain("GROUP-1"); expect(html).toContain("Synthetic grouped source");
    expect(html).toContain("1 of 2 actions");
    expect(entries.map(entry => entry.status)).toEqual(["matches", "needs_action"]);
  });
});

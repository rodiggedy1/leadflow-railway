import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

// Read source, never import the component, application startup, database or providers.
const root = resolve(import.meta.dirname, "..");
const pagePath = "client/src/pages/CommandChatExactLive.tsx";
const source = readFileSync(resolve(root, pagePath), "utf8");
const helperNames = [
  "normalizedLeadPhone",
  "leadNamesMatch",
  "displayLeadSource",
  "smsInboxTimestamp",
  "leadForConversation",
  "quoteAssistantLeadFacts",
] as const;
const NOW = Date.parse("2026-11-05T18:00:00.000Z");
const MESSAGE_TS = Date.parse("2026-11-05T17:30:00.000Z");
const RECEIVED_TS = Date.parse("2026-11-05T16:00:00.000Z");

function parsePage(text: string) {
  return ts.createSourceFile(pagePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function functionDeclaration(ast: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const matches = ast.statements.filter(
    (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  if (matches.length !== 1 || !matches[0].body) {
    throw new Error(`Expected exactly one actual top-level helper with a body: ${name}`);
  }
  return matches[0];
}

const ast = parsePage(source);
const extractedSource = helperNames.map(name => functionDeclaration(ast, name).getText(ast)).join("\n\n");
const compiled = ts.transpileModule(extractedSource, {
  fileName: "commandChatLeadIdentity.helpers.ts",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, alwaysStrict: true },
  reportDiagnostics: true,
});
const compileErrors = compiled.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
if (compileErrors.length) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(compileErrors, {
    getCurrentDirectory: () => root,
    getCanonicalFileName: name => name,
    getNewLine: () => "\n",
  }));
}

// Only Date.now is replaced to pin the existing zero-timestamp fallback. The VM
// receives no require, process, renderer, network API, application or provider.
const context = createContext({ Date: Object.freeze({ now: () => NOW }) }, {
  codeGeneration: { strings: false, wasm: false },
});
const helpers = runInContext(`${compiled.outputText}\n;({ ${helperNames.join(", ")} });`, context, {
  filename: "commandChatLeadIdentity.helpers.js",
  timeout: 1_000,
}) as {
  normalizedLeadPhone: (value: string | null) => string;
  leadNamesMatch: (left: string, right: string) => boolean;
  displayLeadSource: (value: string | null | undefined) => string;
  smsInboxTimestamp: (conversation: Conversation) => number;
  leadForConversation: (conversation: Conversation, leads: Lead[]) => Lead | null;
  quoteAssistantLeadFacts: (lead: Lead | null) => string;
};

type Lead = {
  id: number;
  sessionId: number | null;
  name: string;
  phone: string | null;
  address: string | null;
  sourceLabel: string;
  detail: string;
  serviceType: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  propertyType: string | null;
  frequency: string | null;
  extras: string[];
  summary: string | null;
  description: string | null;
  [key: string]: unknown;
};

type Conversation = {
  id: number;
  leadName: string | null;
  leadPhone: string | null;
  leadSource: string | null;
  lastMessageText: string | null;
  lastMsgTs: number | null;
  lastMessageTs: number | null;
  lastSenderRole: string | null;
  hasUnanswered: boolean;
  aiSummary: string | null;
  personType: "team" | "customer";
  lastInboundPhoneNumberId: string | null;
  receivedAt: number;
  calledAt: number | null;
};

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 1, sessionId: null, receivedAt: RECEIVED_TS, name: "Jordan Smith",
    sourceLabel: "Quote", detail: "Smith-only inquiry", phone: null,
    address: "100 Smith-only Street", claimedBy: "Fixture agent", isBooked: false,
    bookedByAgentName: null, priceLabel: "$123", ts: RECEIVED_TS, queue: "web",
    serviceType: "Smith-only deep clean", location: "Smith-only city", requestedDates: "Smith-only date",
    bedrooms: "3", bathrooms: "2", homeSize: "Smith-only size", rooms: "Smith-only rooms",
    propertyType: "House", frequency: "Monthly", extras: ["Smith-only oven"],
    summary: "Smith-only summary", description: "Smith-only description",
    negotiationId: "Smith-only negotiation", requestId: "Smith-only request", customerId: "Smith-only customer",
    category: "Smith-only category", categoryId: "Smith-only category id", pets: "Smith-only pets",
    travelPreferences: ["Smith-only travel"], nativeDetails: [{ question: "Fixture", answer: "Smith-only answer" }],
    proposedTimes: [{ start: "2026-11-06T10:00:00Z" }], status: "new", leadPrice: "123",
    leadPriceBreakdown: { fixture: "Smith-only price" }, estimate: { fixture: "Smith-only estimate" },
    createdAt: "2026-11-05T16:00:00Z", requestReviewLink: "Smith-only review", refundRequestLink: "Smith-only refund",
    attachments: [{ fixture: "Smith-only attachment" }], messageId: 5,
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 101, leadName: "Jordan Smith", leadPhone: "+1 (202) 555-0101", leadSource: "quote_form",
    lastMessageText: "Conversation-only message", lastMsgTs: MESSAGE_TS, lastMessageTs: RECEIVED_TS,
    lastSenderRole: "user", hasUnanswered: true, aiSummary: "Conversation-only AI summary",
    personType: "customer", lastInboundPhoneNumberId: null, receivedAt: RECEIVED_TS, calledAt: null,
    ...overrides,
  };
}

function sanders(overrides: Partial<Lead> = {}) {
  return lead({
    id: 2, sessionId: 202, name: "Jordan Sanders", phone: "+1 202 555 0202",
    address: "900 Sanders-only Lane", detail: "Sanders-only inquiry", serviceType: "Sanders-only move out",
    bedrooms: "9", bathrooms: "8", propertyType: "Sanders-only mansion", frequency: "Sanders-only weekly",
    extras: ["Sanders-only fridge", "Sanders-only cabinets"], summary: "Sanders-only summary",
    description: "Sanders-only description", ...overrides,
  });
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, otherIndex) => index !== otherIndex)).map(rest => [item, ...rest]),
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// Full expected object: no imported customer fields, no AI-summary enrichment,
// no booking defaults, and no mutation of the existing safe fallback contract.
function expectFallback(result: Lead | null, selected: Conversation, sourceLabel = "Quote", queue = "web", tsValue = MESSAGE_TS) {
  expect(result).toEqual({
    id: selected.id, sessionId: selected.id > 0 ? selected.id : null, receivedAt: selected.receivedAt,
    name: selected.leadName?.trim() || "Customer conversation", sourceLabel, detail: "Conversation",
    phone: selected.leadPhone, address: null, claimedBy: null, isBooked: false, bookedByAgentName: null,
    priceLabel: null, ts: tsValue, queue, serviceType: null, location: null, requestedDates: null,
    bedrooms: null, bathrooms: null, homeSize: null, rooms: null, propertyType: null, frequency: null,
    extras: [], summary: null, description: null, negotiationId: null, requestId: null, customerId: null,
    category: null, categoryId: null, pets: null, travelPreferences: [], nativeDetails: [], proposedTimes: [],
    status: null, leadPrice: null, leadPriceBreakdown: null, estimate: null, createdAt: null,
    requestReviewLink: null, refundRequestLink: null, attachments: [], messageId: null,
  });
  expect(helpers.quoteAssistantLeadFacts(result)).toBe(
    `Name: ${selected.leadName?.trim() || "Customer conversation"}\nLead details: Conversation`,
  );
}

describe("Command Chat lead identity source isolation", () => {
  it("extracts exactly the six actual pure helpers with no component imports or runtime capabilities", () => {
    const extracted = ts.createSourceFile("helpers.ts", extractedSource, ts.ScriptTarget.Latest, true);
    expect(extracted.statements).toHaveLength(helperNames.length);
    expect(extracted.statements.every(ts.isFunctionDeclaration)).toBe(true);
    expect(extracted.statements.map(statement => (statement as ts.FunctionDeclaration).name?.text)).toEqual(helperNames);
    expect(Object.keys(helpers)).toEqual(helperNames);
    expect(runInContext("[typeof require, typeof process, typeof fetch, typeof XMLHttpRequest, typeof WebSocket]", context))
      .toEqual(["undefined", "undefined", "undefined", "undefined", "undefined"]);
  });
});

describe("Command Chat authoritative lead identity", () => {
  it("does not take earlier fuzzy Jordan Sanders when the exact Jordan Smith identity is later", () => {
    const selected = conversation();
    const smith = lead({ sessionId: selected.id, phone: "202-555-0101" });
    const unrelated = sanders();
    expect(helpers.leadNamesMatch(selected.leadName!, unrelated.name)).toBe(true);
    for (const order of permutations([unrelated, smith])) {
      expect(helpers.leadForConversation(selected, order)).toBe(smith);
    }
  });

  it("gives an exact session priority over earlier exact phone, exact name and fuzzy name candidates", () => {
    const selected = conversation();
    // Explicit session authority accepts a known different phone; do not infer
    // an additional phone veto for an exact session identity.
    const authoritative = lead({ id: 10, sessionId: selected.id, name: "Session-authoritative customer", phone: "2025550999" });
    const samePhone = sanders({ phone: "2025550101" });
    const sameName = lead({ id: 3, sessionId: 303, phone: "2025550303" });
    for (const order of permutations([samePhone, sameName, authoritative])) {
      expect(helpers.leadForConversation(selected, order)).toBe(authoritative);
    }
  });

  it.each(["2025550101", "(202) 555-0101", "+1 202-555-0101", " 1 (202) 555 0101 "])(
    "uses normalized phone %s without a session match and ahead of fuzzy or exact names",
    phone => {
      const selected = conversation({ leadPhone: phone });
      const exactPhone = lead({ id: 10, name: "Phone-authoritative customer", phone: "202.555.0101", sessionId: null });
      const fuzzy = sanders();
      const exactName = lead({ id: 3, phone: "2025550303", sessionId: 303 });
      for (const order of permutations([fuzzy, exactName, exactPhone])) {
        expect(helpers.leadForConversation(selected, order)).toBe(exactPhone);
      }
    },
  );

  it("allows an exact phone on a historic different session when there is no exact selected session", () => {
    const selected = conversation();
    const historic = lead({ id: 10, sessionId: 77, name: "Historic same-phone customer", phone: "+1 (202) 555-0101" });
    for (const order of permutations([sanders(), historic])) {
      expect(helpers.leadForConversation(selected, order)).toBe(historic);
    }
  });

  it.each(["session", "phone"] as const)("retains the first existing record for duplicate exact %s identities", identity => {
    const selected = conversation();
    const first = lead({ id: 10, name: "First exact fixture", sessionId: identity === "session" ? selected.id : 77, phone: "2025550101" });
    const second = lead({ id: 11, name: "Second exact fixture", sessionId: identity === "session" ? selected.id : 88, phone: "2025550101" });
    for (const order of permutations([first, second])) {
      expect(helpers.leadForConversation(selected, order)).toBe(order[0]);
    }
  });

  it("can match a phone without a name, and a positive session without name or phone", () => {
    const samePhone = lead({ name: "Phone-only identity", phone: "2025550101" });
    expect(helpers.leadForConversation(conversation({ leadName: null }), [samePhone])).toBe(samePhone);
    const sameSession = lead({ sessionId: 101, name: "Session-only identity", phone: "2025550999" });
    expect(helpers.leadForConversation(conversation({ leadName: null, leadPhone: null }), [sameSession])).toBe(sameSession);
  });
});

describe("Command Chat safe name fallback", () => {
  it.each([
    { label: "unique exact name", name: "Jordan Smith", sessionId: null, phone: null },
    { label: "unique fuzzy name", name: "Jordan S.", sessionId: null, phone: null },
    { label: "case and surrounding whitespace", name: "  jOrDaN sMiTh  ", sessionId: null, phone: null },
    { label: "unknown zero session and nondigit phone", name: "Jordan Smith", sessionId: 0, phone: "not supplied" },
    { label: "unknown negative session", name: "Jordan Smith", sessionId: -1, phone: null },
  ])("accepts $label only as a single total name candidate with no conflicting known identity", row => {
    const selected = conversation({ leadName: "  JORDAN SMITH  " });
    const unique = lead({ name: row.name, sessionId: row.sessionId, phone: row.phone });
    const other = lead({ id: 3, name: "Taylor Brown", sessionId: 303, phone: "2025550303" });
    for (const order of permutations([other, unique])) {
      expect(helpers.leadForConversation(selected, order)).toBe(unique);
    }
  });

  it("does not infer a conflict from a known candidate phone or session when the conversation has neither", () => {
    const selected = conversation({ id: 0, leadPhone: null });
    const unique = lead({ sessionId: 77, phone: "2025550777" });
    expect(helpers.leadForConversation(selected, [unique])).toBe(unique);
  });

  it.each([
    { label: "two exact names", names: ["Jordan Smith", "Jordan Smith"] },
    { label: "exact plus fuzzy name", names: ["Jordan Smith", "Jordan Sanders"] },
    { label: "two fuzzy names", names: ["Jordan Sanders", "Jordan S."] },
  ])("returns only conversation-derived facts for ambiguous $label in either order", row => {
    const selected = conversation();
    const candidates = row.names.map((name, index) => lead({ id: index + 10, name, phone: null, sessionId: null }));
    for (const order of permutations(candidates)) {
      const result = helpers.leadForConversation(selected, order);
      expectFallback(result, selected);
      expect(order).not.toContain(result);
    }
  });

  it("counts every name candidate, even when one exact name looks safer than a conflicting fuzzy candidate", () => {
    const selected = conversation();
    const safeExact = lead({ phone: null, sessionId: null });
    const conflictingFuzzy = sanders();
    for (const order of permutations([safeExact, conflictingFuzzy])) {
      expectFallback(helpers.leadForConversation(selected, order), selected);
    }
  });

  it.each([
    { label: "exact name with different phone", name: "Jordan Smith", phone: "2025550999", sessionId: null },
    { label: "fuzzy name with different phone", name: "Jordan Sanders", phone: "2025550999", sessionId: null },
    { label: "exact name with different positive session", name: "Jordan Smith", phone: null, sessionId: 77 },
    { label: "fuzzy name with different positive session", name: "Jordan Sanders", phone: null, sessionId: 77 },
    { label: "both known identities conflicting", name: "Jordan Smith", phone: "2025550999", sessionId: 77 },
  ])("rejects a unique $label without leaking their quote facts", row => {
    const selected = conversation();
    const candidate = lead({ name: row.name, phone: row.phone, sessionId: row.sessionId });
    expectFallback(helpers.leadForConversation(selected, [candidate]), selected);
  });

  it("checks a positive session conflict even if the selected phone is absent", () => {
    const selected = conversation({ leadPhone: null });
    expectFallback(helpers.leadForConversation(selected, [lead({ sessionId: 77 })]), selected);
  });

  it("checks a known phone conflict even if the selected session is nonpositive", () => {
    const selected = conversation({ id: 0 });
    expectFallback(helpers.leadForConversation(selected, [lead({ phone: "2025550999" })]), selected);
  });

  it.each([null, "", "   "])("does not use names when the conversation name is %s", leadName => {
    const selected = conversation({ leadName, leadPhone: null });
    expectFallback(helpers.leadForConversation(selected, [lead(), sanders()]), selected);
  });

  it("does not fuzzy-match a single first name or borrow from an unrelated customer", () => {
    const selected = conversation({ leadName: "Jordan", leadPhone: null });
    expect(helpers.leadNamesMatch("Jordan", "Jordan Smith")).toBe(false);
    expectFallback(helpers.leadForConversation(selected, [lead(), sanders()]), selected);
    const unrelated = conversation({ leadName: "Taylor Brown" });
    expectFallback(helpers.leadForConversation(unrelated, [lead(), sanders()]), unrelated);
  });

  it.each([0, -1])("does not treat nonpositive session %s as an authoritative identity", id => {
    const selected = conversation({ id, leadName: null, leadPhone: null });
    expectFallback(helpers.leadForConversation(selected, [lead({ sessionId: id })]), selected);
  });

  it("returns null for a team conversation even when exact session, phone and name all match", () => {
    const selected = conversation({ personType: "team" });
    const exact = lead({ sessionId: selected.id, phone: selected.leadPhone });
    expect(helpers.leadForConversation(selected, [exact])).toBeNull();
    expect(helpers.quoteAssistantLeadFacts(helpers.leadForConversation(selected, [exact]))).toBe("");
  });
});

describe("Command Chat fallback and quote-fact preservation", () => {
  it("retains the full conversation fallback for an empty lead list, including original phone and trimmed name", () => {
    const selected = conversation({ leadName: "  Taylor Brown  " });
    expectFallback(helpers.leadForConversation(selected, []), selected);
  });

  it.each([
    { source: " THUMBTACK-native ", label: "Thumbtack", queue: "incoming" },
    { source: " bark ", label: "Bark.com", queue: "web" },
    { source: "EMAIL", label: "Email", queue: "web" },
    { source: "cs-inbound", label: "Cs Inbound", queue: "web" },
    { source: null, label: "Quote", queue: "web" },
  ])("preserves display source and queue for $source without using unrelated facts", row => {
    const selected = conversation({ leadSource: row.source });
    expectFallback(helpers.leadForConversation(selected, []), selected, row.label, row.queue);
  });

  it.each([
    { lastMsgTs: MESSAGE_TS, lastMessageTs: RECEIVED_TS, helperTs: MESSAGE_TS, fallbackTs: MESSAGE_TS },
    { lastMsgTs: null, lastMessageTs: RECEIVED_TS, helperTs: RECEIVED_TS, fallbackTs: RECEIVED_TS },
    { lastMsgTs: null, lastMessageTs: null, helperTs: 0, fallbackTs: NOW },
    { lastMsgTs: 0, lastMessageTs: RECEIVED_TS, helperTs: 0, fallbackTs: NOW },
  ])("preserves nullish timestamp precedence for $lastMsgTs / $lastMessageTs", row => {
    const selected = conversation({ lastMsgTs: row.lastMsgTs, lastMessageTs: row.lastMessageTs });
    expect(helpers.smsInboxTimestamp(selected)).toBe(row.helperTs);
    expectFallback(helpers.leadForConversation(selected, []), selected, "Quote", "web", row.fallbackTs);
  });

  it("preserves the default missing-identity object and never copies message or AI summary into quote facts", () => {
    const selected = conversation({ id: 0, leadName: null, leadPhone: null, leadSource: null, lastMsgTs: null, lastMessageTs: null });
    expectFallback(helpers.leadForConversation(selected, [lead(), sanders()]), selected, "Quote", "web", NOW);
  });

  it("quotes only the authoritative customer's exact retained facts, not another customer's data", () => {
    const selected = conversation();
    const smith = lead({ sessionId: selected.id, phone: "2025550101" });
    const unrelated = sanders();
    const expected = [
      "Name: Jordan Smith", "Service: Smith-only deep clean", "Bedrooms: 3", "Bathrooms: 2",
      "Property type: House", "Frequency: Monthly", "Extras: Smith-only oven",
      "Address: 100 Smith-only Street", "Summary: Smith-only summary", "Description: Smith-only description",
      "Lead details: Smith-only inquiry",
    ].join("\n");
    for (const order of permutations([unrelated, smith])) {
      const facts = helpers.quoteAssistantLeadFacts(helpers.leadForConversation(selected, order));
      expect(facts).toBe(expected);
      expect(facts).not.toContain("Sanders");
      expect(facts).not.toContain("Bedrooms: 9");
      expect(facts).not.toContain("Bathrooms: 8");
    }
    expect(helpers.quoteAssistantLeadFacts(null)).toBe("");
  });

  it("preserves original object and nested references and does not mutate any selection path", () => {
    const authoritative = lead({ sessionId: 101, phone: "2025550101" });
    const phone = lead({ id: 10, name: "Phone-only customer", sessionId: 77, phone: "2025550101" });
    const unique = lead();
    const conflicting = lead({ phone: "2025550999" });
    const scenarios: Array<{ selected: Conversation; candidates: Lead[]; expected: Lead | "fallback" | null }> = [
      { selected: conversation(), candidates: [sanders(), authoritative], expected: authoritative },
      { selected: conversation(), candidates: [sanders(), phone], expected: phone },
      { selected: conversation(), candidates: [unique], expected: unique },
      { selected: conversation(), candidates: [conflicting], expected: "fallback" },
      { selected: conversation(), candidates: [lead(), sanders({ sessionId: null, phone: null })], expected: "fallback" },
      { selected: conversation({ personType: "team" }), candidates: [authoritative], expected: null },
    ];
    for (const scenario of scenarios) {
      for (const order of permutations(scenario.candidates)) {
        const before = JSON.stringify({ selected: scenario.selected, order });
        const references = order.slice();
        deepFreeze(scenario.selected);
        deepFreeze(order);
        const result = helpers.leadForConversation(scenario.selected, order);
        helpers.quoteAssistantLeadFacts(result);
        expect(JSON.stringify({ selected: scenario.selected, order })).toBe(before);
        order.forEach((candidate, index) => expect(candidate).toBe(references[index]));
        if (scenario.expected === "fallback") {
          expectFallback(result, scenario.selected);
          expect(order).not.toContain(result);
        } else {
          expect(result).toBe(scenario.expected);
          if (result) {
            expect(result.extras).toBe(scenario.expected!.extras);
            expect(result.nativeDetails).toBe(scenario.expected!.nativeDetails);
            expect(result.attachments).toBe(scenario.expected!.attachments);
          }
        }
      }
    }
  });
});

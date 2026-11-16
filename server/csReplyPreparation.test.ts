import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CsReplyPreparationDependencies, CsReplyDraftInput } from "./csReplyStream";

const offline = vi.hoisted(() => ({
  env: { forgeApiUrl: "https://forge.offline.invalid/", forgeApiKey: "offline-only" },
  getDb: vi.fn(() => { throw new Error("Database access is forbidden in preparation tests"); }),
}));

// Keep runtime imports out of auth/database/schema trees. Only the actual KB and
// prompt/preparation module load; the analysis/retrieval seams are always injected.
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn() }));
vi.mock("./_core/sdk", () => ({ sdk: { verifySession: vi.fn() } }));
vi.mock("./_core/env", () => ({ ENV: offline.env }));
vi.mock("./db", () => ({ getDb: offline.getDb }));

import { prepareCsReplyMessages } from "./csReplyStream";
import { MAIDS_IN_BLACK_KNOWLEDGE_BASE } from "./knowledgeBase";

const frozenSha256 = "ede7717e899790ed5a12a4c7e8c26aaff4afedc136173e05dd858e201bd3468b";
const originalSource = execFileSync("git", ["show", "993bb452:server/csReplyStream.ts"], {
  cwd: new URL("..", import.meta.url), encoding: "utf8",
});
if (createHash("sha256").update(originalSource).digest("hex") !== frozenSha256) {
  throw new Error("Frozen original csReplyStream.ts does not match the verified baseline");
}
const originalAst = ts.createSourceFile("original.ts", originalSource, ts.ScriptTarget.Latest, true);
const currentSource = readFileSync(new URL("./csReplyStream.ts", import.meta.url), "utf8");
const currentAst = ts.createSourceFile("current.ts", currentSource, ts.ScriptTarget.Latest, true);

function namedFunction(ast: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const declaration = ast.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error(`Missing source function ${name}`);
  return declaration;
}

function routeHandler(ast: ts.SourceFile): ts.ArrowFunction {
  const registration = namedFunction(ast, "registerCsReplyStreamRoute");
  let handler: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "app.post") {
      const candidate = node.arguments[1];
      if (candidate && ts.isArrowFunction(candidate)) handler = candidate;
    }
    ts.forEachChild(node, visit);
  }
  visit(registration);
  if (!handler || !ts.isBlock(handler.body)) throw new Error("Missing registered primary route");
  return handler;
}

function initializerIn(block: ts.Block, name: string): ts.Expression {
  for (const statement of block.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(node => node.name.getText() === name);
    if (declaration?.initializer) return declaration.initializer;
  }
  throw new Error(`Missing source initializer ${name}`);
}

// A pure control extracted from the ORIGINAL registered handler, not a second
// implementation of its logic. Remove only HTTP/SSE/provider transport, retain
// its original normalization, try/catch, userParts and literal messages property.
const originalHandler = routeHandler(originalAst);
if (!ts.isBlock(originalHandler.body)) throw new Error("Original handler is not a block");
const originalHandlerText = originalHandler.body.getText(originalAst);
const preparationStart = originalHandlerText.indexOf("const { conversationContext");
const sseStart = originalHandlerText.indexOf("// SSE headers");
const assemblyStart = originalHandlerText.indexOf("const systemPrompt =");
const payloadStart = originalHandlerText.indexOf("const payload =");
if (!(preparationStart >= 0 && sseStart > preparationStart && assemblyStart > sseStart && payloadStart > assemblyStart)) {
  throw new Error("Frozen original extraction boundaries do not match");
}
const payload = initializerIn(originalHandler.body, "payload");
if (!ts.isObjectLiteralExpression(payload)) throw new Error("Original payload is not an object");
const messagesProperty = payload.properties.find((node): node is ts.PropertyAssignment =>
  ts.isPropertyAssignment(node) && node.name.getText(originalAst) === "messages");
if (!messagesProperty) throw new Error("Original payload has no messages");

// The KB control is also the actual immutable Git baseline, not a fabricated KB.
const frozenKbSource = execFileSync("git", ["show", "993bb452:server/knowledgeBase.ts"], {
  cwd: new URL("..", import.meta.url), encoding: "utf8",
});
const frozenKbExports: Record<string, unknown> = {};
runInNewContext(ts.transpileModule(frozenKbSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: frozenKbExports });
const originalKb = frozenKbExports.MAIDS_IN_BLACK_KNOWLEDGE_BASE as string;
const pureOriginalSource = [
  namedFunction(originalAst, "formatFewShotExamples").getText(originalAst),
  namedFunction(originalAst, "buildContextBlock").getText(originalAst),
  namedFunction(originalAst, "buildSystemPrompt").getText(originalAst).replace(/^export /, ""),
  "async function originalMessages(req, analyzeConversationState, retrieveExamples) {",
  originalHandlerText.slice(preparationStart, sseStart),
  originalHandlerText.slice(assemblyStart, payloadStart),
  `return ${messagesProperty.initializer.getText(originalAst)};`,
  "}",
  "originalMessages;",
].join("\n");
type Messages = Awaited<ReturnType<typeof prepareCsReplyMessages>>;
type State = NonNullable<Awaited<ReturnType<NonNullable<CsReplyPreparationDependencies["analyzeConversationState"]>>>>;
type Retrieval = Awaited<ReturnType<NonNullable<CsReplyPreparationDependencies["retrieveExamples"]>>>;
const originalMessages = runInNewContext(ts.transpileModule(pureOriginalSource, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
}).outputText, {
  ENV: offline.env,
  MAIDS_IN_BLACK_KNOWLEDGE_BASE: originalKb,
  console: { warn: () => {} },
}) as (req: { body: CsReplyDraftInput }, analyze: CsReplyPreparationDependencies["analyzeConversationState"], retrieve: CsReplyPreparationDependencies["retrieveExamples"]) => Promise<Messages>;

const state: State = {
  primaryIntent: "booking_inquiry",
  secondaryIntents: ["pricing_question"],
  customerType: "new_lead",
  customerGoal: "Understand deep cleaning and appliance extras",
  conversationStage: "initial_inquiry",
  lastAgentAction: "Asked which service the customer needs.",
  waitingOn: "agent",
  outstandingItems: ["service choice", "preferred date"],
  serviceCompleted: false,
  nextBestAction: "Explain deep cleaning and ask for a preferred date.",
  doNotAssume: ["No booking is confirmed", "Do not invent a quote"],
};
const examples: Retrieval["examples"] = [
  { id: 41, userMsg: "Does deep cleaning include the fridge?", agentReply: "Hi Dana! We can include inside the fridge upon request. What date works for you?", situation: "First lead asks about deep-clean extras", primaryIntent: "booking_inquiry", customerType: "new_lead" },
  { id: 42, userMsg: "Can you explain the difference?\nI have pets.", agentReply: "Absolutely — let's find the right service for your home.", situation: null, primaryIntent: "pricing_question", customerType: "new_lead" },
];
const leadInput: CsReplyDraftInput = {
  conversationContext: "Customer: Hi, what does a deep clean include? Is the oven extra?\nAgent: Happy to explain!",
  customerName: "  Élodie   van Dijk  ",
  jobContext: "Lead facts: 2 bedrooms, 1 bathroom; Washington DC; deep clean requested; no confirmed booking; pets.",
  scenario: "Write the complete first-lead reply about deep cleaning and extras.",
  sessionId: 23,
};

function seams(result: State | null = null, historical: Retrieval = { examples: [], selectedIds: [] }, failure?: "analysis" | "retrieval") {
  return {
    analyzeConversationState: vi.fn(async (_conversationContext: string, _jobContext: string, _forgeApiUrl: string) => {
      if (failure === "analysis") throw new Error("offline state failure");
      return result;
    }),
    retrieveExamples: vi.fn(async (_state: State, _sessionId: number | undefined, _forgeApiUrl: string) => {
      if (failure === "retrieval") throw new Error("offline retrieval failure");
      return historical;
    }),
  };
}

async function parity(input: CsReplyDraftInput, result: State | null = null, historical: Retrieval = { examples: [], selectedIds: [] }, failure?: "analysis" | "retrieval") {
  const actualSeams = seams(result, historical, failure);
  const controlSeams = seams(result, historical, failure);
  const expected = await originalMessages({ body: input }, controlSeams.analyzeConversationState, controlSeams.retrieveExamples);
  const actual = await prepareCsReplyMessages(input, actualSeams);
  expect(actual).toEqual(expected);
  // Compare serialized UTF-8 bytes, including whitespace, roles and ordering.
  expect(Buffer.from(JSON.stringify(actual), "utf8").equals(Buffer.from(JSON.stringify(expected), "utf8"))).toBe(true);
  expect(actualSeams.analyzeConversationState.mock.calls).toEqual(controlSeams.analyzeConversationState.mock.calls);
  expect(actualSeams.retrieveExamples.mock.calls).toEqual(controlSeams.retrieveExamples.mock.calls);
  return { actual, actualSeams };
}

beforeEach(() => {
  offline.env.forgeApiUrl = "https://forge.offline.invalid/";
  offline.getDb.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network/model calls are forbidden in preparation tests"); }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(offline.getDb).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("prepareCsReplyMessages — exact frozen-primary-source parity (offline)", () => {
  it("uses the verified frozen original and unchanged production helpers/KB", () => {
    expect(createHash("sha256").update(originalSource).digest("hex")).toBe(frozenSha256);
    for (const name of ["getCandidatePool", "analyzeConversationState", "retrieveExamples", "formatFewShotExamples", "buildContextBlock", "isAuthorizedOpsUser", "buildSystemPrompt"]) {
      expect(namedFunction(currentAst, name).getText(currentAst)).toBe(namedFunction(originalAst, name).getText(originalAst));
    }
    expect(MAIDS_IN_BLACK_KNOWLEDGE_BASE).toBe(originalKb);
  });

  it("uses unchanged production defaults without I/O when no conversation is supplied", async () => {
    const input = { customerName: "Avery Doe", jobContext: "First lead, not booked", scenario: "Explain deep cleaning" };
    const control = seams();
    const expected = await originalMessages({ body: input }, control.analyzeConversationState, control.retrieveExamples);
    const actual = await prepareCsReplyMessages(input);
    expect(Buffer.from(JSON.stringify(actual), "utf8").equals(Buffer.from(JSON.stringify(expected), "utf8"))).toBe(true);
    expect(control.analyzeConversationState).not.toHaveBeenCalled();
    expect(control.retrieveExamples).not.toHaveBeenCalled();
  });

  it.each([
    ["no history or fields", {}],
    ["raw conversation and lead facts", leadInput],
    ["no history, name, facts and scenario", { customerName: "Kate Jones", jobContext: "Deep-clean lead, not booked", scenario: "Answer the inquiry" }],
    ["nonstring history and facts", { conversationContext: { text: "ignored" }, jobContext: 99, sessionId: "23", scenario: false }],
    ["whitespace-only strings remain untouched", { conversationContext: " \n\t ", jobContext: "  ", scenario: "  " }],
  ] as Array<[string, CsReplyDraftInput]>)("preserves original raw/no-history behavior: %s", async (_label, input) => {
    const { actual, actualSeams } = await parity(input);
    expect(actual[1].content).not.toContain("=== CURRENT CONVERSATION STATE ===");
    expect(actualSeams.retrieveExamples).not.toHaveBeenCalled();
    if (typeof input.conversationContext !== "string" || !input.conversationContext) {
      expect(actualSeams.analyzeConversationState).not.toHaveBeenCalled();
    }
  });

  it("preserves successful analysis, dynamic historical examples, full KB and exact userParts sequence", async () => {
    const { actual, actualSeams } = await parity(leadInput, state, { examples, selectedIds: [41, 42] });
    expect(actualSeams.analyzeConversationState).toHaveBeenCalledWith(leadInput.conversationContext, leadInput.jobContext, "https://forge.offline.invalid/v1/chat/completions");
    expect(actualSeams.retrieveExamples).toHaveBeenCalledWith(state, 23, "https://forge.offline.invalid/v1/chat/completions");
    expect(actual[0].content).toContain(originalKb);
    expect(actual[0].content).toContain("=== REAL EXAMPLES FROM YOUR TEAM ===");
    for (const example of examples) {
      expect(actual[0].content).toContain(example.userMsg);
      expect(actual[0].content).toContain(example.agentReply);
    }
    const user = actual[1].content;
    expect(user.indexOf("=== CURRENT CONVERSATION STATE ===")).toBe(0);
    expect(user.indexOf("Customer's first name: Élodie")).toBeGreaterThan(user.indexOf("=== SOURCE PRIORITY"));
    expect(user.indexOf("Recent conversation with this customer:")).toBeGreaterThan(user.indexOf("Customer's first name:"));
    expect(user.indexOf("Customer service scenario:")).toBeGreaterThan(user.indexOf("Recent conversation with this customer:"));
    expect(user).toContain(leadInput.jobContext);
    expect(user).not.toContain("Upcoming job details:");
  });

  it("preserves KB deep-clean extras without replacing the complete instructions with a shared short prompt", async () => {
    const { actual } = await parity(leadInput, state, { examples, selectedIds: [41, 42] });
    expect(actual[0].content).toContain("## What's Included (Deep Cleaning)\n\nEverything in standard cleaning, plus:\n- Hard-to-reach spots and hidden grime\n- Inside appliances (oven, fridge) upon request\n- Baseboards, window sills, and light fixtures\n- More detailed scrubbing throughout");
    expect(actual[0].content).toContain("**Not included in standard cleaning:** Inside appliances (oven, fridge). These can be added as an extra service.");
    for (const heading of ["=== TONE ===", "=== WHAT NOT TO WRITE (BAD EXAMPLES) ===", "=== EMOJI RULES ===", "=== WRITING RULES ===", "=== MAIDS IN BLACK KNOWLEDGE BASE ==="]) expect(actual[0].content).toContain(heading);
  });

  it("keeps analyzed state with an empty historical example result and no booking facts", async () => {
    const { actual } = await parity({ conversationContext: "Customer: Hello", customerName: "Avery Doe" }, { ...state, outstandingItems: [], doNotAssume: [] });
    expect(actual[0].content).not.toContain("=== REAL EXAMPLES FROM YOUR TEAM ===");
    expect(actual[1].content).toContain("Outstanding items: none");
    expect(actual[1].content).toContain("Do NOT assume: none");
    expect(actual[1].content).toContain("No active booking on file");
  });

  it.each(["null", "analysis", "retrieval"] as const)("preserves %s fail-closed fallthrough", async failure => {
    const { actual, actualSeams } = await parity(leadInput, failure === "null" ? null : state, { examples, selectedIds: [41, 42] }, failure === "null" ? undefined : failure);
    expect(actual[0].content).not.toContain("=== REAL EXAMPLES FROM YOUR TEAM ===");
    expect(actual[1].content).not.toContain("=== CURRENT CONVERSATION STATE ===");
    expect(actual[1].content).toContain(`Upcoming job details:\n${leadInput.jobContext}`);
    expect(actual[1].content).toContain(leadInput.conversationContext);
    expect(actualSeams.retrieveExamples).toHaveBeenCalledTimes(failure === "retrieval" ? 1 : 0);
  });

  it("preserves original partial-assignment fallthrough when context formatting fails after examples", async () => {
    const malformedState = { ...state, outstandingItems: null } as unknown as State;
    const { actual } = await parity(leadInput, malformedState, { examples, selectedIds: [41, 42] });
    expect(actual[0].content).toContain("=== REAL EXAMPLES FROM YOUR TEAM ===");
    expect(actual[1].content).not.toContain("=== CURRENT CONVERSATION STATE ===");
    expect(actual[1].content).toContain("Upcoming job details:");
  });

  it.each([
    ["trimmed first name", "  Mary\tJane Smith ", "Mary"],
    ["Unicode first name", " 李 雷 ", "李"],
    ["single name", "Avery", "Avery"],
    ["whitespace", " \t\n", ""],
    ["null", null, ""],
    ["zero", 0, ""],
    ["false", false, ""],
    ["truthy numeric name", 17, "17"],
    ["original object coercion", { name: "Avery" }, "[object"],
  ] as Array<[string, unknown, string]>)("preserves original name behavior: %s", async (_label, customerName, firstName) => {
    const { actual } = await parity({ customerName, scenario: "Greeting" });
    if (firstName) expect(actual[1].content).toBe(`Customer's first name: ${firstName}\n\nCustomer service scenario: Greeting`);
    else expect(actual[1].content).toBe("Customer service scenario: Greeting");
  });

  it.each([undefined, "23", 0, 23, Number.NaN])("preserves original sessionId normalization for %s", async sessionId => {
    const { actualSeams } = await parity({ ...leadInput, sessionId }, state);
    expect(actualSeams.retrieveExamples.mock.calls[0]?.[1]).toEqual(typeof sessionId === "number" ? sessionId : undefined);
  });

  it.each(["", "   ", "https://forge.offline.invalid/custom", "https://forge.offline.invalid/custom/"])("preserves original Forge URL normalization for %s", async url => {
    offline.env.forgeApiUrl = url;
    await parity(leadInput, state);
  });

  it("preserves truthy nonstring scenario coercion and falsy default instructions", async () => {
    await parity({ customerName: "Morgan Doe", scenario: { kind: "inquiry" } });
    await parity({ conversationContext: "Customer: Hello", scenario: 0 });
  });

  it("introduces no truncation or new preparation limits", async () => {
    const longExamples = Array.from({ length: 10 }, (_, index) => ({ ...examples[0], id: index + 1, userMsg: `Customer ${index}: ${"detail ".repeat(200)}`, agentReply: `Reply ${index}: ${"history ".repeat(200)}` }));
    const input = { ...leadInput, conversationContext: "context ".repeat(2000), jobContext: "lead fact ".repeat(1000), scenario: "question ".repeat(1000) };
    const { actual } = await parity(input, state, { examples: longExamples, selectedIds: longExamples.map(example => example.id) });
    for (const example of longExamples) expect(actual[0].content).toContain(example.agentReply);
    expect(actual[1].content).toContain(input.conversationContext);
    expect(actual[1].content).toContain(input.jobContext);
    expect(actual[1].content).toContain(input.scenario);
  });

  it("wires the registered primary route to the helper and preserves auth/SSE/provider code and limits", () => {
    const currentHandler = routeHandler(currentAst);
    if (!ts.isBlock(currentHandler.body)) throw new Error("Current handler is not a block");
    const text = currentHandler.body.getText(currentAst);
    const call = initializerIn(currentHandler.body, "messages");
    expect(call.getText(currentAst)).toBe("await prepareCsReplyMessages({ conversationContext, customerName, jobContext, scenario, sessionId: reqSessionId })");
    const newPayload = initializerIn(currentHandler.body, "payload");
    expect(ts.isObjectLiteralExpression(newPayload)).toBe(true);
    if (!ts.isObjectLiteralExpression(newPayload)) throw new Error("Current payload is not an object");
    expect(newPayload.properties.find(node => node.name?.getText(currentAst) === "messages")?.getText(currentAst)).toBe("messages");
    for (const property of ["model", "stream", "max_tokens"]) {
      expect(newPayload.properties.find(node => node.name?.getText(currentAst) === property)?.getText(currentAst)).toBe(payload.properties.find(node => node.name?.getText(originalAst) === property)?.getText(originalAst));
    }
    const authEnd = originalHandlerText.indexOf("const { conversationContext");
    expect(text.slice(0, text.indexOf("const { conversationContext"))).toBe(originalHandlerText.slice(0, authEnd));
    const oldSse = originalHandlerText.slice(sseStart, assemblyStart);
    expect(text.slice(text.indexOf("// SSE headers"), text.indexOf("const payload ="))).toBe(oldSse);
    expect(text.indexOf("await prepareCsReplyMessages")).toBeLessThan(text.indexOf("res.flushHeaders()"));
    expect(text.indexOf("res.flushHeaders()")).toBeLessThan(text.indexOf("upstreamRes = await fetch"));
    expect(currentSource.slice(currentSource.indexOf("    let upstreamRes:"))).toBe(originalSource.slice(originalSource.indexOf("    let upstreamRes:")));
  });
});

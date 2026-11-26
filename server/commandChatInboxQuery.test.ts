import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeSessionSummary } from "./sessionSummary";

const read = (path: string) => readFileSync(path, "utf8");
const inboxProcedure = (() => {
  const s = read("server/commandCenterRouter.ts");
  return s.slice(s.indexOf("listCommandChatInbox: agentProcedure"), s.indexOf("prepareQuoteAssistant: agentProcedure"));
})();

describe("Command Chat text inbox: no full-history search", () => {
  it("decides 'the customer has messaged' from lastCustomerMessageTs, never by searching every stored history", () => {
    expect(inboxProcedure).toContain("const inboundMessageActivityFilter = isNotNull(conversationSessions.lastCustomerMessageTs);");
    expect(inboxProcedure).not.toContain("JSON_SEARCH");
    expect(inboxProcedure).not.toContain("conversationSessions.messageHistory");
  });
  it("keeps every other membership rule, ordering and unanswered rule unchanged", () => {
    for (const kept of [
      "and(or(inboundMessageActivityFilter, csTouchedOutboundFilter), isNull(conversationSessions.csResolvedAt)),",
      "inboundVoiceCallActivityFilter,", "isNotNull(conversationSessions.lastCalledAt),",
      'const csTouchedOutboundFilter = eq(conversationSessions.csQueue as any, "CS");',
      'hasUnanswered: session.lastMessageRole === "user",', ".sort((left, right) => right.lastMsgTs - left.lastMsgTs);",
    ]) expect(inboxProcedure, kept).toContain(kept);
  });
});

describe("every save path that adds a customer message keeps lastCustomerMessageTs current", () => {
  const paths: Array<[string, string, string]> = [
    ["server/webhooks.ts", "hiring interview reply", ".set({ messageHistory: JSON.stringify(history), lastCustomerMessageTs: computeSessionSummary(history).lastCustomerMessageTs })"],
    ["server/webhooks.ts", "reply routed to a hiring session", "messageHistory: JSON.stringify(hiringHistory),\n          lastCustomerMessageTs: computeSessionSummary(hiringHistory as any).lastCustomerMessageTs,"],
    ["server/webhooks.ts", "first text from a new customer", "messageHistory: JSON.stringify(history),\n          lastCustomerMessageTs: computeSessionSummary(history as any).lastCustomerMessageTs,\n          stage: \"OPEN\","],
    ["server/vapiService.ts", "inbound AI call", "messageHistory: JSON.stringify(messages),\n          lastCustomerMessageTs: computeSessionSummary(messages as any).lastCustomerMessageTs,"],
    ["server/routers.ts", "OpenPhone sync of missing texts", ".set({ messageHistory: JSON.stringify(merged), lastCustomerMessageTs: computeSessionSummary(merged).lastCustomerMessageTs } as any)"],
    ["server/clientStatusInquiryEngine.ts", "client status inquiry", "messageHistory: JSON.stringify(statusInquiryHistory),\n    lastCustomerMessageTs: computeSessionSummary(statusInquiryHistory).lastCustomerMessageTs,"],
  ];
  it.each(paths)("%s: %s", (path, _name, expected) => {
    const source = read(path);
    expect(source).toContain(expected);
    expect(source).toMatch(/import \{ computeSessionSummary \} from ["']\.\/sessionSummary["'];/);
  });
  it("only lastCustomerMessageTs is added: preview, last role and ordering fields stay as they were on these paths", () => {
    for (const [path, , expected] of paths) for (const field of ["lastMessageRole", "lastMessageText", "lastMessageTs:", "messageCount"])
      expect(expected, `${path} ${field}`).not.toContain(field);
  });
});

describe("the value written is the latest timed customer message, never invented", () => {
  it("uses the latest customer message that has a time, and stays empty when none has one", () => {
    expect(computeSessionSummary([{ role: "user", content: "a", ts: 100 }, { role: "assistant", content: "b", ts: 200 }, { role: "customer", content: "c", ts: 150 }] as any).lastCustomerMessageTs).toBe(150);
    expect(computeSessionSummary([{ role: "user", content: "no time" }, { role: "assistant", content: "b", ts: 200 }] as any).lastCustomerMessageTs).toBeNull();
    expect(computeSessionSummary([{ role: "assistant", content: "outbound only", ts: 200 }] as any).lastCustomerMessageTs).toBeNull();
  });
});

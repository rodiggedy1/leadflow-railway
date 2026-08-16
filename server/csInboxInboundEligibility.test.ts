import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type HistoryMessage = { role: string };

function hasInboundActivity(history: HistoryMessage[], hasLinkedVoiceCall: boolean): boolean {
  return hasLinkedVoiceCall || history.some(message => message.role === "user" || message.role === "customer");
}

const source = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
const listStart = source.indexOf("listCsInbox: opsChatProcedure");
const declarationStart = source.indexOf("const inboundMessageActivityFilter", listStart);
const declarationEnd = source.indexOf("const resolvedFilter", declarationStart);
const whereStart = source.indexOf(".where(", declarationEnd);
const whereEnd = source.indexOf(".orderBy(desc(conversationSessions.updatedAt))", whereStart);
const eligibilitySource = source.slice(declarationStart, declarationEnd) + source.slice(whereStart, whereEnd);

describe("CsInbox universal inbound eligibility", () => {
  it("does not use leadSource to decide CsInbox eligibility", () => {
    expect(eligibilitySource).not.toContain("leadSource");
  });

  it("accepts inbound messages from Thumbtack, Bark, CS, forms, widgets, manual leads, and future sources", () => {
    for (const sourceName of ["thumbtack", "bark", "cs-inbound", "form", "widget", "manual", "future-source"]) {
      expect(hasInboundActivity([{ role: "user" }], false), sourceName).toBe(true);
    }
  });

  it("keeps a customer conversation eligible after an agent replies", () => {
    expect(hasInboundActivity([{ role: "user" }, { role: "assistant" }], false)).toBe(true);
  });

  it("accepts a linked inbound call and excludes system-only activity", () => {
    expect(hasInboundActivity([], true)).toBe(true);
    expect(hasInboundActivity([{ role: "system" }, { role: "assistant" }], false)).toBe(false);
  });

  it("uses the persisted history roles and linked voice-call condition in the list query", () => {
    expect(eligibilitySource).toContain("JSON_SEARCH(${conversationSessions.messageHistory}, 'one', 'user'");
    expect(eligibilitySource).toContain("JSON_SEARCH(${conversationSessions.messageHistory}, 'one', 'customer'");
    expect(eligibilitySource).toContain("FROM voice_calls vc");
  });
});

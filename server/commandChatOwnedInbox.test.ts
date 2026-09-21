import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Command Chat owned SMS inbox", () => {
  it("uses conversation sessions and active team profiles without operational job lookups", () => {
    const source = read("server/commandCenterRouter.ts");
    const start = source.indexOf("listCommandChatInbox: agentProcedure");
    const end = source.indexOf("listInboundTeamSmsEvents: agentProcedure");
    const procedure = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(procedure).toContain("conversationSessions.messageHistory");
    expect(procedure).toContain("conversationSessions.lastInboundPhoneNumberId");
    expect(procedure).toContain("conversationSessions.lastMessageText");
    expect(procedure).toContain("conversationSessions.lastMessageTs");
    expect(procedure).toContain("conversationSessions.lastMessageRole");
    expect(procedure).toContain("FROM cleaner_profiles");
    expect(procedure).toContain('session.csQueue === "Teams"');
    expect(procedure).toContain("return canonicalSessions");

    for (const prohibited of ["cleaner" + "Jobs", "cleaner" + "_jobs"]) {
      expect(procedure).not.toContain(prohibited);
    }
  });
});

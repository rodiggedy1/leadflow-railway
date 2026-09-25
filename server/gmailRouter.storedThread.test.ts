import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "server/gmailRouter.ts"), "utf8");
const storedThreadBlock = source.slice(
  source.indexOf("getStoredThread: agentProcedure"),
  source.indexOf("sendReply: agentProcedure"),
);

describe("gmail.getStoredThread", () => {
  it("returns only saved inbound email content as a read-only fallback", () => {
    expect(storedThreadBlock).toContain("from(madisonEmailDrafts)");
    expect(storedThreadBlock).toContain("originalMessage: madisonEmailDrafts.originalMessage");
    expect(storedThreadBlock).toContain("bodyText: draft.originalMessage");
    expect(storedThreadBlock).toContain("where(eq(madisonEmailDrafts.threadId, input.threadId))");
    expect(storedThreadBlock).not.toContain("requireGmailConnected");
    expect(storedThreadBlock).not.toContain(".insert(");
    expect(storedThreadBlock).not.toContain(".update(");
  });
});

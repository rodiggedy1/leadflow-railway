import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "../client/src/components/CsInbox2.tsx"),
  "utf8",
);

describe("CsInbox2 Quo outbound sync contract", () => {
  it("uses the established Inbox1 server-side outbound importer", () => {
    expect(source).toContain("trpc.opsChat.syncCsOutboundMessages.useMutation");
    expect(source).toContain("syncQuoOutbound.mutate({ sessionId: selectedConv.id, leadPhone: selectedConv.phone })");
  });

  it("syncs only a valid selected CS session with a phone", () => {
    expect(source).toContain("if (!selectedConv || selectedConv.id <= 0 || !selectedConv.phone.trim()) return;");
    expect(source).toContain("}, [selectedConv?.id, selectedConv?.phone]);");
  });

  it("refreshes both the card list and the open detail after a successful merge", () => {
    expect(source).toContain("utils.leads.listCsInbox.invalidate({ showResolved: true })");
    expect(source).toContain("utils.leads.getCsConversation.invalidate({ sessionId: variables.sessionId })");
  });
});

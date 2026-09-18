import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const commandChat = readFileSync(resolve(root, "client/src/components/CommandChat.tsx"), "utf8");
const commandChatCss = readFileSync(resolve(root, "client/src/components/command-chat-rebuild.css"), "utf8");
const movesPanel = readFileSync(resolve(root, "client/src/components/MadisonsMovesPanel.tsx"), "utf8");

describe("Command Chat ground-up presentation rebuild", () => {
  it("loads one scoped visual layer around the live Command Chat", () => {
    expect(commandChat).toContain('import "./command-chat-rebuild.css";');
    expect(commandChat).toContain('className="command-chat-rebuild flex flex-1 min-h-0 overflow-hidden"');
    expect(commandChatCss).toContain(".command-chat-rebuild {");
    expect(commandChatCss).not.toMatch(/(^|\n)body\s*\{/);
  });

  it("keeps the live lead, reply, message, and composer handlers wired", () => {
    expect(commandChat).toContain('window.open(`/admin/leads?session=${sessionId}&tab=sms`, "_blank");');
    expect(commandChat).toContain("claimLeadMutation.mutate({ messageId: msg.id, sessionId: sessionId ?? undefined })");
    expect(commandChat).toContain("sendSmsMutation.mutateAsync({ sessionId, message: replyText.trim(), fromNumberId: \"PN0wVLcpCq\" })");
    expect(commandChat).toContain("dismissAlarmMutation.mutateAsync({ msgId: msg.id, handledReason: \"no_reply_needed\" })");
    expect(commandChat).toContain("onClick={handleSend}");
  });

  it("uses the approved three-column hierarchy with a compact header tool set", () => {
    for (const marker of [
      "mib-lead-rail",
      "mib-center-card",
      "mib-stream",
      "mib-message-bubble",
      "mib-moves-host",
      "mib-header-tools",
      "mib-command-tools",
    ]) {
      expect(commandChat).toContain(marker);
    }
    expect(commandChat).toContain('title="More command tools"');
    expect(commandChat).toContain("setLeadRepliesOpen(v => !v)");
    expect(commandChat).toContain("setShowCallPanel(true)");
    expect(commandChat).toContain("setShowPaymentModal(true)");
    expect(commandChat).toContain("setShowDebrief(true)");
    expect(commandChatCss).toContain(".mib-command-tools { display: none !important; }");
    expect(commandChatCss).toContain(".mib-header-tool-menu");
  });

  it("renders operational alerts as expandable dark stream events", () => {
    expect(commandChat).toContain("mib-unanswered-card");
    expect(commandChat).toContain("mib-unanswered-expanded");
    expect(commandChat).toContain("mib-ops-summary-card");
    expect(commandChatCss).toContain(".mib-unanswered-shell");
    expect(commandChatCss).toContain(".mib-unanswered-dismiss");
    expect(commandChatCss).toContain(".mib-ops-summary-card");
  });

  it("keeps Madison’s live recommendation panel and scopes it to the new surface", () => {
    expect(commandChat).toContain("<MadisonsMovesPanel />");
    expect(movesPanel).toContain('className="mib-moves flex h-full min-h-0 flex-col overflow-hidden border-l"');
    expect(commandChatCss).toContain(".mib-moves");
  });
});

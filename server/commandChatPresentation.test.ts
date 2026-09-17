import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const commandChat = readFileSync(resolve(root, "client/src/components/CommandChat.tsx"), "utf8");
const visualLayer = readFileSync(resolve(root, "client/src/components/command-chat-production.css"), "utf8");
const madisonsMoves = readFileSync(resolve(root, "client/src/components/MadisonsMovesPanel.tsx"), "utf8");

describe("Command Chat presentation-only production layer", () => {
  it("loads the scoped visual layer without moving live data or actions", () => {
    expect(commandChat).toContain('import "./command-chat-production.css";');
    expect(commandChat).toContain("command-chat-production");
    expect(commandChat).toContain("command-chat-production-left");
    expect(commandChat).toContain("command-chat-production-center");
    expect(commandChat).toContain("command-chat-production-right");

    // Existing operational dependencies and interaction paths remain in the live component.
    expect(commandChat).toContain("channelMsgs");
    expect(commandChat).toContain("onSendMessage");
    expect(commandChat).toContain("toggleReactionMutation");
    expect(commandChat).toContain("claimLeadMutation");
    expect(commandChat).toContain("setResolveIssueOpen");
    expect(commandChat).toContain("MadisonsMovesPanel");
    expect(commandChat).toContain("headerMenuOpen");
    expect(commandChat).toContain("setShowCallPanel(true)");
    expect(commandChat).toContain("command-chat-unanswered-card");
    expect(commandChat).toContain("handleNoReply");
    expect(commandChat).toContain("handleSend");
  });

  it("keeps the design layer scoped and non-destructive", () => {
    expect(visualLayer).toContain(".command-chat-production");
    expect(visualLayer).toContain(".command-chat-production-header");
    expect(visualLayer).toContain(".command-chat-production-stream");
    expect(visualLayer).toContain(".command-chat-production-composer");
    expect(visualLayer).toContain(".command-chat-production-right");
    expect(visualLayer).toContain(".command-chat-unanswered-card");
    expect(visualLayer).toContain(".madisons-moves-production");

    // No visibility or input disabling rules are part of this presentation-only migration.
    expect(visualLayer).not.toMatch(/display\s*:\s*none/i);
    expect(visualLayer).not.toMatch(/pointer-events\s*:\s*none/i);
    expect(visualLayer).not.toMatch(/visibility\s*:\s*hidden/i);
  });

  it("keeps Madison’s Moves backed by its existing live review and send paths", () => {
    expect(madisonsMoves).toContain('className="madisons-moves-production');
    expect(madisonsMoves).toContain("trpc.madisonMoves.list.useQuery");
    expect(madisonsMoves).toContain("trpc.madisonMoves.send.useMutation");
    expect(madisonsMoves).toContain("trpc.madisonMoves.dismiss.useMutation");
  });
});

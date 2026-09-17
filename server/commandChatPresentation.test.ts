import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const commandChat = readFileSync(resolve(root, "client/src/components/CommandChat.tsx"), "utf8");
const visualLayer = readFileSync(resolve(root, "client/src/components/command-chat-production.css"), "utf8");

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
  });

  it("keeps the design layer scoped and non-destructive", () => {
    expect(visualLayer).toContain(".command-chat-production");
    expect(visualLayer).toContain(".command-chat-production-header");
    expect(visualLayer).toContain(".command-chat-production-stream");
    expect(visualLayer).toContain(".command-chat-production-composer");
    expect(visualLayer).toContain(".command-chat-production-right");

    // No visibility or input disabling rules are part of this presentation-only migration.
    expect(visualLayer).not.toMatch(/display\s*:\s*none/i);
    expect(visualLayer).not.toMatch(/pointer-events\s*:\s*none/i);
    expect(visualLayer).not.toMatch(/visibility\s*:\s*hidden/i);
  });
});

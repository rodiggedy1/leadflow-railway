import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const pageSource = fs.readFileSync(path.resolve("client/src/pages/SettingsPage.tsx"), "utf8");
const surfaceSource = fs.readFileSync(path.resolve("client/src/pages/settings-command-surface.css"), "utf8");

describe("Settings command surface presentation contract", () => {
  it("adds the approved command composition without replacing the page implementation", () => {
    expect(pageSource).toContain('import "./settings-command-surface.css"');
    expect(pageSource).toContain('className="settings-command-surface min-h-screen bg-[#faf9f7]"');
    expect(pageSource).toContain("settings-command-hero");
    expect(pageSource).toContain("settings-command-tabs");
    expect(surfaceSource).toContain(".settings-command-surface");
    expect(surfaceSource).toContain(".settings-command-hero");
    expect(surfaceSource).toContain(".settings-command-tabs");
  });

  it("retains every existing live Settings boundary and action surface", () => {
    for (const marker of [
      "<AdminPageGuard pageId=\"settings\">",
      "useAgentPermissions()",
      "trpc.settings.getAll.useQuery()",
      "trpc.settings.update.useMutation()",
      "trpc.settings.getBookingWidgetDraft.useQuery()",
      "trpc.settings.updateBookingWidgetDraft.useMutation()",
      "trpc.settings.getPayRules.useQuery()",
      "trpc.settings.updatePayRules.useMutation()",
      "trpc.settings.listCustomPayRules.useQuery()",
      "trpc.settings.createCustomPayRule.useMutation()",
      "trpc.settings.updateCustomPayRule.useMutation()",
      "trpc.settings.deleteCustomPayRule.useMutation()",
      "<BookingWidgetConfigPanel",
      "<MessageFlowPanel",
      "<ResponseTemplatesTab />",
      "<OpenPhoneSyncCard />",
      "<SilencedServicesCard",
      "<AppVersionCard />",
    ]) {
      expect(pageSource).toContain(marker);
    }
  });

  it("keeps the presentation layer client-only", () => {
    expect(surfaceSource).not.toMatch(/trpc\.|useQuery|useMutation|fetch\(/);
  });
});

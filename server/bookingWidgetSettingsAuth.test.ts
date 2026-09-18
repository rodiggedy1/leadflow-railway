import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routerSource = fs.readFileSync(path.resolve("server/settingsRouter.ts"), "utf8");
const pageSource = fs.readFileSync(path.resolve("client/src/pages/SettingsExactLive.tsx"), "utf8");

describe("booking widget settings persistence contract", () => {
  it("uses the canonical page-permission guard for both widget draft procedures", () => {
    expect(routerSource).toContain('import { agentPageProcedure, router } from "./_core/trpc"');
    expect(routerSource).toContain('const settingsPageProcedure = agentPageProcedure("settings");');
    expect(routerSource).toMatch(/getBookingWidgetDraft:\s*settingsPageProcedure\.query/);
    expect(routerSource).toMatch(/updateBookingWidgetDraft:\s*settingsPageProcedure/);
  });

  it("gives every page-visible Settings procedure the same Settings-page guard", () => {
    expect(routerSource).toMatch(/getAll:\s*settingsPageProcedure\.query/);
    expect(routerSource).toMatch(/update:\s*settingsPageProcedure/);
    expect(routerSource).toMatch(/getPayRules:\s*settingsPageProcedure\.query/);
    expect(routerSource).toMatch(/updatePayRules:\s*settingsPageProcedure/);
    expect(routerSource).not.toContain("protectedProcedure");
    expect(routerSource).not.toContain("adminAgentProcedure");
  });

  it("reads and writes only the internal bookingWidgetDraft setting", () => {
    const widgetBlock = routerSource.slice(
      routerSource.indexOf("getBookingWidgetDraft:"),
      routerSource.indexOf("Get all settings"),
    );
    expect(widgetBlock).toContain("BOOKING_WIDGET_DRAFT_SETTING.key");
    expect(widgetBlock).toContain(".set({ value: input.value })");
    expect(widgetBlock).not.toContain("sendSms");
    expect(widgetBlock).not.toContain("createBooking");
  });

  it("bounds the serialized draft without accepting arbitrary setting keys", () => {
    expect(routerSource).toContain("value: z.string().min(2).max(60_000)");
    expect(routerSource).not.toContain("updateBookingWidgetDraft: settingsPageProcedure\n    .input(z.object({ key:");
  });

  it("routes only the Booking Widget panel through the dedicated read and write procedures", () => {
    expect(pageSource).toContain("trpc.settings.getBookingWidgetDraft.useQuery()");
    expect(pageSource).toContain("trpc.settings.updateBookingWidgetDraft.useMutation()");
    expect(pageSource).toContain("savedValue={bookingDraft?.value}");
    expect(pageSource).toContain("onSave={saveBooking}");
  });
});

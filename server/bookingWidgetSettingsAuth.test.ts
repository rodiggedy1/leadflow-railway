import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routerSource = fs.readFileSync(path.resolve("server/settingsRouter.ts"), "utf8");
const pageSource = fs.readFileSync(path.resolve("client/src/pages/SettingsPage.tsx"), "utf8");

describe("booking widget settings persistence contract", () => {
  it("uses the canonical LeadFlow admin-agent guard for both widget draft procedures", () => {
    expect(routerSource).toContain('import { adminAgentProcedure, protectedProcedure, router } from "./_core/trpc"');
    expect(routerSource).toMatch(/getBookingWidgetDraft:\s*adminAgentProcedure\.query/);
    expect(routerSource).toMatch(/updateBookingWidgetDraft:\s*adminAgentProcedure/);
  });

  it("keeps the legacy Settings procedures on their existing auth guard", () => {
    expect(routerSource).toMatch(/getAll:\s*protectedProcedure\.query/);
    expect(routerSource).toMatch(/update:\s*protectedProcedure/);
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
    expect(routerSource).not.toContain("updateBookingWidgetDraft: adminAgentProcedure\n    .input(z.object({ key:");
  });

  it("routes only the Booking Widget panel through the dedicated read and write procedures", () => {
    expect(pageSource).toContain("trpc.settings.getBookingWidgetDraft.useQuery()");
    expect(pageSource).toContain("trpc.settings.updateBookingWidgetDraft.useMutation()");
    expect(pageSource).toContain("savedValue={bookingWidgetSetting?.value}");
    expect(pageSource).toContain("onSave={handleSaveBookingWidgetDraft}");
  });
});

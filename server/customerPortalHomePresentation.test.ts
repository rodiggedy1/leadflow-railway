import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal Home presentation integration", () => {
  it("uses a presentation-only Home component without introducing direct portal queries or mutations", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortalHome.tsx"), "utf8");
    expect(source).not.toContain("trpc.");
    expect(source).toContain('onGoToPage("bookings")');
    expect(source).toContain('onGoToPage("services")');
    expect(source).toContain('onGoToPage("payments")');
    expect(source).toContain('onGoToPage("messages")');
    expect(source).toContain("onBookHomeCleaning");
    expect(source).toContain('aria-disabled="true"');
    expect(source).toContain("const lifecycle = nextBooking ?");
    expect(source).not.toContain("<strong>Today</strong>");
  });

  it("keeps the compact same-day strip presentation-only while retaining the existing note-save callback", async () => {
    const source = await readFile(path.resolve(root, "client/src/components/PortalCompactTodayStatus.tsx"), "utf8");
    expect(source).not.toContain("trpc.");
    expect(source).toContain("getCustomerPortalLiveStatusView(job)");
    expect(source).toContain("onViewBooking");
    expect(source).toContain("onUpdateNote?.(note)");
    expect(source).toContain('aria-expanded={notesOpen}');
    expect(source).toContain("mib-home-today-status__notes-reveal");
  });

  it("keeps the existing live portal data, same-day status, request modal, and rebook overlay owned by CustomerPortal", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    expect(source).toContain('trpc.customerPortal.me.useQuery()');
    expect(source).toContain('trpc.customerPortal.todayJobStatus.useQuery');
    expect(source).toContain('trpc.customerPortal.todayIsolatedProgress.useQuery');
    expect(source).toContain('trpc.customerPortal.messages.useQuery');
    expect(source).toContain('trpc.customerPortal.replyToMessageThread.useMutation');
    expect(source).toContain('todayBookingWithLiveStatus ? <PortalCompactTodayStatus');
    expect(source).toContain('onUpdateNote={todayLeadflowBooking ? note => updateLeadflowJobCustomerNote.mutate');
    expect(source).toContain("<ServiceRequestForm");
    expect(source).toContain("<BookNow portalRebook");
    expect(source.indexOf("const goToPage")).toBeLessThan(source.indexOf('if (activePage === "home")'));
    expect(source.indexOf("const openService")).toBeLessThan(source.indexOf('if (activePage === "home")'));
  });
});

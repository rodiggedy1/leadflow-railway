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

  it("replaces Home organizing with the active Pressure washing service in the top service row", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortalHome.tsx"), "utf8");
    const topServicesSource = source.slice(source.indexOf("const topServices"), source.indexOf("const additionalServices"));
    expect(topServicesSource).toContain('{ id: "pressure-washing", title: "Pressure Washing", price: "From $99"');
    expect(topServicesSource).toContain('image: "/manus-storage/mib-review-pressure-fallback_d93b1038.jpg"');
    expect(topServicesSource).not.toContain("Home Organization");
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

  it("lets a customer start a booking-linked message using the existing guarded reply mutation", async () => {
    const home = await readFile(path.resolve(root, "client/src/pages/CustomerPortalHome.tsx"), "utf8");
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    expect(home).toContain("onMessageTeam");
    expect(home).toContain("onClick={onMessageTeam}");
    expect(source).toContain("const messageEligibleLeadflowJobs");
    expect(source).toContain('job.jobDate === businessDate');
    expect(source).not.toContain('job.jobDate >= businessDate && job.bookingStatus.toLowerCase() !== "missing_from_launch27"');
    expect(source).toContain('job.bookingStatus.toLowerCase() !== "missing_from_launch27"');
    expect(source).toContain("const startMessageForNextBooking");
    expect(source).toContain("messageEligibleLeadflowJobs.length === 1");
    expect(source).toContain("Which booking is this about?");
    expect(source).toContain("onMessageTeam={startMessageForNextBooking}");
    expect(source).toContain("canMessageTeamToday={messageEligibleLeadflowJobs.length > 0}");
    expect(home).toContain("canMessageTeamToday");
    expect(home).toContain("disabled={!canMessageTeamToday}");
    expect(source).toContain("const messageThreadsForDisplay");
    expect(source).toContain("const shouldFocusComposer");
    expect(source).toContain("Message your cleaning team");
    expect(source).toContain("Your message is on its way to the team.");
    expect(source).toContain("We’ll notify your team when they are assigned.");
    expect(source).toContain('sendPortalReply.mutate({ leadflowJobId: thread.leadflowJobId, body }');
  });

  it("refreshes active customer Messages without a manual browser reload and promotes the most recently active booking conversation", async () => {
    const source = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");
    expect(source).toContain('refetchOnMount: "always"');
    expect(source).toContain('refetchOnWindowFocus: "always"');
    expect(source).toContain("refetchInterval: 10_000");
    expect(source).toContain("const leftLatest = left.messages[left.messages.length - 1]");
    expect(source).toContain("const rightLatest = right.messages[right.messages.length - 1]");
    expect(source).toContain("return rightTime - leftTime || right.jobDate.localeCompare(left.jobDate)");
    expect(source).toContain("const messageThreadsForDisplay");
    expect(source).toContain("return [selectedThread, ...messageThreads.filter(thread => thread.leadflowJobId !== selectedJobId)]");
  });
});

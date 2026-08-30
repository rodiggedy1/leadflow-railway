import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../client/src/components/NativeBookingsWorkspace.tsx", import.meta.url), "utf8");
const pageWrapperSource = readFileSync(new URL("../client/src/pages/NativeBookings.tsx", import.meta.url), "utf8");
const pageStyles = readFileSync(new URL("../client/src/pages/bookings-preview.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../client/src/components/AdminHeader.tsx", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("../client/src/components/AdminPageGuard.tsx", import.meta.url), "utf8");
const agentDashboardSource = readFileSync(new URL("../client/src/pages/AgentDashboard.tsx", import.meta.url), "utf8");
const sharedConstSource = readFileSync(new URL("../shared/const.ts", import.meta.url), "utf8");

describe("bookings UI preview contract", () => {
  it("wires a guarded lazy admin route and consistent external route entry", () => {
    expect(appSource).toContain('const NativeBookings = lazy(() => import("./pages/NativeBookings"));');
    expect(appSource).toContain('<Route path={"/admin/bookings"} component={NativeBookings} />');
    expect(pageWrapperSource).toContain('<AdminPageGuard pageId="bookings"><NativeBookingsWorkspace /></AdminPageGuard>');
    expect(pageSource).not.toContain("AdminHeader");
    expect(headerSource).toContain('| "bookings";');
    expect(headerSource).toContain('label: "Bookings",      href: "/admin/bookings"');
    expect(guardSource).toContain('"bookings":          "/admin/bookings"');
    expect(agentDashboardSource).toContain('"bookings":          "/admin/bookings"');
    expect(sharedConstSource).toContain('{ id: "bookings",          label: "Bookings",      group: "Operations" }');
  });

  it("preserves the supplied self-contained sidebar, workspace, and detail panel around native data", () => {
    for (const marker of ["Bookings workspace navigation", "MiB", "Bookings", "Teams", "Inbox", "Payments", "Rohan", "Administrator", "Select booking date", "Booking metrics", "Native LeadFlow bookings list", "TEAMS ASSIGNED", "CARDS ON FILE", "REQUESTED REVENUE", "Search customer, address, or request number", "Confirmed", "Needs attention", "Completed", "SERVICE & EXTRAS", "RECURRING PREFERENCE", "ASSIGNED TEAM", "PAYMENT", "NOTES & SPECIAL REQUESTS"]) {
      expect(pageSource).toContain(marker);
    }
    expect(pageSource).toContain("trpc.bookings.list.useQuery");
    expect(pageSource).toContain("trpc.bookings.get.useQuery");
    expect(pageSource).toContain("trpc.bookingFunnel.list.useQuery");
    expect(pageSource).toContain("trpc.bookingFunnel.get.useQuery");
    expect(pageSource).toContain("useMemo");
    expect(pageSource).toContain("useState");
  });

  it("matches the supplied desktop shell geometry and responsive breakpoint contract", () => {
    expect(pageStyles).toContain("grid-template-columns:82px minmax(720px,1fr) 410px");
    expect(pageStyles).toContain("height:100vh;background:#171719");
    expect(pageStyles).toContain("padding:36px 38px 60px");
    expect(pageStyles).toContain("grid-template-columns:1.6fr 1.25fr 1fr .78fr .42fr 20px");
    expect(pageStyles).toContain("@media(max-width:1120px)");
    expect(pageStyles).toContain("@media(max-width:760px)");
    expect(pageStyles).toContain("grid-template-columns:repeat(4,1fr)");
  });

  it("removes sample records and disables every unimplemented operational write", () => {
    expect(pageSource).toContain("OPERATIONS · NATIVE REQUESTS");
    expect(pageSource).toContain("New Book with AI requests appear here immediately for review.");
    expect(pageSource).toContain("Phone-captured booking leads appear here while customers finish the flow.");
    expect(pageSource).not.toContain("Demo Customer A");
    expect(pageSource).not.toContain("SEED_BOOKINGS");
    expect(pageSource).toContain('disabled title="Manual booking creation is not connected in this release"');
    expect(pageSource).toContain("Assignment is not connected in this release");
    expect(pageSource).toContain("Card collection is not connected in this release");
    expect(pageSource).not.toContain("useMutation");
    for (const prototypeIdentity of ["Rohan Gilkes", "Maya Thompson", "Derek Collins", "Nia Robinson", "Jordan Lee", "302) 981-6191"]) {
      expect(pageSource).not.toContain(prototypeIdentity);
    }
  });

  it("reads native bookings and funnel leads but contains no booking/customer/payment/messaging writes", () => {
    for (const prohibited of ["fetch(", "axios", "useMutation", "sendSms", "processPayment", "storagePut", "localStorage", "sessionStorage"]) {
      expect(pageSource).not.toContain(prohibited);
    }
  });

  it("keeps bookings and progressive leads in separate tabs with safe incomplete-field rendering", () => {
    expect(pageSource).toContain('useState<"bookings" | "leads">("bookings")');
    expect(pageSource).toContain('onClick={() => setView("bookings")}');
    expect(pageSource).toContain('onClick={() => setView("leads")}');
    expect(pageSource).toContain("Lead / In progress");
    expect(pageSource).toContain("Reservation started / Payment incomplete");
    expect(pageSource).toContain("status: lead.stage");
    expect(pageSource).not.toContain('stage: "lead" as const');
    expect(pageSource).toContain('if (view === "bookings") {');
    expect(pageSource).toContain('[...funnelRows.filter((row) => row.status !== "lead"), ...bookingRows]');
    expect(pageSource).toContain('.filter((row) => row.requestedLocalDate === date)');
    expect(pageSource).toContain('[bookings, date, funnelLeads, view]');
    expect(pageSource).toContain('return funnelRows.filter((row) => row.status === "lead")');
    expect(pageSource).toContain("Details in progress");
    expect(pageSource).toContain("Email not entered yet");
    expect(pageSource).not.toContain("mutationToken");
    expect(pageSource).not.toContain("idempotencyKey");
    expect(pageSource).not.toContain("commandHash");
  });

  it("provides responsive list and full-width mobile detail-panel behavior", () => {
    expect(pageStyles).toContain(".bookings-detail-panel{width:100%}");
    expect(pageStyles).toContain(".bookings-row{grid-template-columns:1fr auto;padding:14px}");
    expect(pageStyles).toContain(".bookings-ops-nav{position:fixed;left:0;right:0;bottom:0");
    expect(pageSource).toContain('aria-label={`Booking details for ${active.customerName}`}');
  });

  it("suppresses the inherited MIB Chat chrome on the self-contained Bookings route", () => {
    expect(appSource).toContain('const isBookingsWorkspace = location === "/admin/bookings";');
    expect(appSource).toContain("(location.startsWith(\"/admin\") && !isBookingsWorkspace)");
    expect(appSource).toContain("hasBeenMounted && !isBookingsWorkspace");
  });
});

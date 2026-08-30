import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../client/src/pages/BookingsPreview.tsx", import.meta.url), "utf8");
const pageStyles = readFileSync(new URL("../client/src/pages/bookings-preview.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../client/src/components/AdminHeader.tsx", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("../client/src/components/AdminPageGuard.tsx", import.meta.url), "utf8");
const agentDashboardSource = readFileSync(new URL("../client/src/pages/AgentDashboard.tsx", import.meta.url), "utf8");
const sharedConstSource = readFileSync(new URL("../shared/const.ts", import.meta.url), "utf8");

describe("bookings UI preview contract", () => {
  it("wires a guarded lazy admin route and consistent external route entry", () => {
    expect(appSource).toContain('const BookingsPreview = lazy(() => import("./pages/BookingsPreview"));');
    expect(appSource).toContain('<Route path={"/admin/bookings"} component={BookingsPreview} />');
    expect(pageSource).toContain('<AdminPageGuard pageId="bookings"><BookingsPreviewContent /></AdminPageGuard>');
    expect(pageSource).not.toContain("AdminHeader");
    expect(headerSource).toContain('| "bookings";');
    expect(headerSource).toContain('label: "Bookings",      href: "/admin/bookings"');
    expect(guardSource).toContain('"bookings":          "/admin/bookings"');
    expect(agentDashboardSource).toContain('"bookings":          "/admin/bookings"');
    expect(sharedConstSource).toContain('{ id: "bookings",          label: "Bookings",      group: "Operations" }');
  });

  it("preserves the supplied self-contained sidebar, workspace, detail panel, and browser-only interactions", () => {
    for (const marker of ["Bookings workspace navigation", "MiB", "Bookings", "Teams", "Inbox", "Payments", "Rohan", "Administrator", "Select demo booking date", "Demo booking metrics", "Demo bookings list", "TEAMS ASSIGNED", "CARDS ON FILE", "BOOKED REVENUE", "Search customer, address, or team", "Confirmed", "Needs attention", "Completed", "SERVICE & EXTRAS", "RECURRING SERVICE", "ASSIGNED TEAM", "PAYMENT", "NOTES & SPECIAL REQUESTS"]) {
      expect(pageSource).toContain(marker);
    }
    expect(pageSource).toContain("useMemo");
    expect(pageSource).toContain("useState");
    expect(pageSource).toContain("const update =");
    expect(pageSource).toContain("toggleExtra");
    expect(pageSource).toContain("assignTeam");
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

  it("labels every record and disconnected action as UI-only demo content", () => {
    expect(pageSource).toContain("OPERATIONS · UI PREVIEW");
    expect(pageSource).toContain("Sample records only.");
    expect(pageSource).toContain("sample values only");
    expect(pageSource).toContain("Demo Customer A");
    expect(pageSource).toContain("id: 1842");
    expect(pageSource).toContain("Nothing was sent, booked, charged, or saved.");
    expect(pageSource).toContain("No booking was saved.");
    for (const prototypeIdentity of ["Rohan Gilkes", "Maya Thompson", "Derek Collins", "Nia Robinson", "Jordan Lee", "302) 981-6191"]) {
      expect(pageSource).not.toContain(prototypeIdentity);
    }
  });

  it("contains no real booking, customer, payment, messaging, persistence, or data-fetch integration", () => {
    for (const prohibited of ["trpc.", "fetch(", "axios", "useQuery", "useMutation", "createBooking", "sendSms", "processPayment", "storagePut", "localStorage", "sessionStorage"]) {
      expect(pageSource).not.toContain(prohibited);
    }
  });

  it("provides responsive list and full-width mobile detail-panel behavior", () => {
    expect(pageStyles).toContain(".bookings-detail-panel{width:100%}");
    expect(pageStyles).toContain(".bookings-row{grid-template-columns:1fr auto;padding:14px}");
    expect(pageStyles).toContain(".bookings-ops-nav{position:fixed;left:0;right:0;bottom:0");
    expect(pageSource).toContain('aria-label={`Demo booking details for ${active.name}`}');
  });

  it("suppresses the inherited MIB Chat chrome on the self-contained Bookings route", () => {
    expect(appSource).toContain('const isBookingsWorkspace = location === "/admin/bookings";');
    expect(appSource).toContain("(location.startsWith(\"/admin\") && !isBookingsWorkspace)");
    expect(appSource).toContain("hasBeenMounted && !isBookingsWorkspace");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../client/src/pages/BookingsPreview.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const headerSource = readFileSync(new URL("../client/src/components/AdminHeader.tsx", import.meta.url), "utf8");
const guardSource = readFileSync(new URL("../client/src/components/AdminPageGuard.tsx", import.meta.url), "utf8");
const agentDashboardSource = readFileSync(new URL("../client/src/pages/AgentDashboard.tsx", import.meta.url), "utf8");
const sharedConstSource = readFileSync(new URL("../shared/const.ts", import.meta.url), "utf8");

describe("bookings UI preview contract", () => {
  it("wires a guarded lazy admin route and consistent Jobs navigation entry", () => {
    expect(appSource).toContain('const BookingsPreview = lazy(() => import("./pages/BookingsPreview"));');
    expect(appSource).toContain('<Route path={"/admin/bookings"} component={BookingsPreview} />');
    expect(pageSource).toContain('<AdminPageGuard pageId="bookings"><BookingsPreviewContent /></AdminPageGuard>');
    expect(pageSource).toContain('<AdminHeader activeTab="bookings"');
    expect(headerSource).toContain('| "bookings";');
    expect(headerSource).toContain('label: "Bookings",      href: "/admin/bookings"');
    expect(guardSource).toContain('"bookings":          "/admin/bookings"');
    expect(agentDashboardSource).toContain('"bookings":          "/admin/bookings"');
    expect(sharedConstSource).toContain('{ id: "bookings",          label: "Bookings",      group: "Operations" }');
  });

  it("preserves the supplied operations-dashboard structure and browser-only interactions", () => {
    for (const marker of ["Select demo booking date", "Demo booking metrics", "Demo bookings list", "Bookings", "Teams assigned", "Cards on file", "Booked revenue", "Search customer, address, team, or service", "Confirmed", "Needs attention", "Completed", "Service & extras", "Recurring service", "Assigned team", "Payment", "Notes & special requests"]) {
      expect(pageSource).toContain(marker);
    }
    expect(pageSource).toContain("useMemo");
    expect(pageSource).toContain("useState");
    expect(pageSource).toContain("updateActiveBooking");
    expect(pageSource).toContain("toggleExtra");
    expect(pageSource).toContain("assignTeam");
  });

  it("labels every record and disconnected action as UI-only demo content", () => {
    expect(pageSource).toContain("Operations · UI preview");
    expect(pageSource).toContain("Sample records only.");
    expect(pageSource).toContain("sample values only");
    expect(pageSource).toContain("Demo Customer A");
    expect(pageSource).toContain("DEMO-1842");
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
    expect(pageSource).toContain("grid-cols-2 gap-3 xl:grid-cols-4");
    expect(pageSource).toContain("hidden grid-cols-[1.55fr_1.2fr_1fr_.75fr_.4fr_24px]");
    expect(pageSource).toContain("grid w-full grid-cols-[1fr_auto]");
    expect(pageSource).toContain("w-full max-w-[430px]");
    expect(pageSource).toContain('aria-label={`Demo booking details for ${activeBooking.name}`}');
  });
});

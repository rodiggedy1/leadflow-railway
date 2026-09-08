import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const previewSource = readFileSync(new URL("../client/src/pages/MibHomePreview.tsx", import.meta.url), "utf8");
const previewStyles = readFileSync(new URL("../client/src/pages/mib-home-preview.css", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../client/src/components/MibSidebar.tsx", import.meta.url), "utf8");

describe("MIB fixed-design live-data contract", () => {
  it("keeps the approved admin route, guard, and sidebar unchanged", () => {
    expect(appSource).toContain('<Route path={"/admin2"} component={MibHomePreview} />');
    expect(appSource).toContain('const isHomepagePreview = location === "/admin/home-preview" || location === "/admin2";');
    expect(previewSource).toContain('<AdminPageGuard pageId="command-center">');
    expect(previewSource).toContain('<MibSidebar activeItem="Dashboard" />');
    expect(sidebarSource).toContain('{ label: "Dashboard", icon: LayoutDashboard, href: "/admin2" }');
  });

  it("uses only approved read-only dashboard and agent queries", () => {
    for (const required of ["trpc.mibDashboard.getBookingWindow.useQuery", "trpc.mibDashboard.getRecentActivity.useQuery", "trpc.agents.me.useQuery", "trpc.agents.getStatuses.useQuery", "bookingMetricSummary", "businessDateForMibDashboard"]) {
      expect(previewSource).toContain(required);
    }
    for (const prohibited of ["useMutation", "fetch(", "onClick=", "localStorage", "sessionStorage", "cleanerJobs", "cleaner_jobs"]) {
      expect(previewSource).not.toContain(prohibited);
    }
  });

  it("preserves the exact approved dashboard slots in every live-data state", () => {
    for (const marker of ["Good morning", "Last 30 days", "Operations Pulse", "Total Bookings", "Revenue", "New Customers", "Average Rating", "Bookings overview", "Bookings by service", "Today’s schedule", "Active teams", "Recent activity", "Get the mobile app", "mib-preview-metric__microchart", "mib-preview-pulse", "mib-preview-chart", "mib-preview-service", "mib-home-preview__operating-grid"]) {
      expect(previewSource).toContain(marker);
    }
    expect(previewSource).toContain("Array.from({ length: 6 }");
    expect(previewSource).toContain("Array.from({ length: 5 }");
    expect(previewSource).toContain("Array.from({ length: 4 }");
    expect(previewSource).toContain("Array.from({ length: 24 }");
    expect(previewStyles).toContain("grid-template-columns:208px minmax(0,1fr)");
    expect(previewStyles).toContain(".mib-preview-chart,.mib-preview-service{min-height:286px");
    expect(previewStyles).toContain(".mib-home-preview__operating-grid .mib-preview-panel{min-height:286px");
    expect(previewStyles).toContain(".mib-preview-metric{min-height:132px;display:grid;grid-template-columns:46px minmax(0,1fr) 104px");
    expect(previewStyles).toContain(".mib-command-header--dark-variant{border-color:rgba(255,255,255,.10);background:#2B2420");
  });
});

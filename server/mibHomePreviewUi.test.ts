import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const previewSource = readFileSync(new URL("../client/src/pages/MibHomePreview.tsx", import.meta.url), "utf8");
const previewStyles = readFileSync(new URL("../client/src/pages/mib-home-preview.css", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../client/src/components/MibSidebar.tsx", import.meta.url), "utf8");

describe("MIB homepage visual-preview contract", () => {
  it("registers the approved homepage at /admin2 without repointing the current admin home", () => {
    expect(appSource).toContain('const MibHomePreview = lazy(() => import("./pages/MibHomePreview"));');
    expect(appSource).toContain('<Route path={"/admin2"} component={MibHomePreview} />');
    expect(appSource).toContain('<Route path={"/admin/home-preview"} component={MibHomePreview} />');
    expect(appSource).toContain('window.location.replace("/admin/command-center")');
  });

  it("keeps the review page presentation-only and does not load operational data", () => {
    expect(previewSource).toContain('<AdminPageGuard pageId="command-center">');
    expect(previewSource).toContain('<MibSidebar activeItem="Dashboard" />');
    expect(previewSource).toContain('data-static-reference="true"');
    expect(previewSource).toContain("Good morning, Rohan.");
    for (const prohibited of ["trpc", "useQuery", "useMutation", "fetch(", "onClick=", "localStorage", "sessionStorage"]) {
      expect(previewSource).not.toContain(prohibited);
    }
  });

  it("uses the MIB dashboard composition and excludes the live global chat overlay", () => {
    for (const marker of ["MibSidebar activeItem=\"Dashboard\"", "Last 30 days", "Total Bookings", "Average Rating", "Bookings overview", "Today’s schedule", "Active teams", "Recent activity", "Get the mobile app", "Send download link", "mib-home-preview__promos", "vPmUAKhVtzTzruHW.png", "KtPTcczUntFsdOzR.png", "QqBhMBjofpziFnzR.png"]) {
      expect(previewSource).toContain(marker);
    }
    expect(previewSource).toContain("preserveAspectRatio=\"none\"");
    expect(previewSource).toContain("vs. last Monday");
    expect(previewStyles).toContain("grid-template-columns:208px minmax(0,1fr)");
    expect(previewStyles).toContain("--booking-card-radius:14px");
    expect(previewStyles).toContain("--booking-card-shadow:0 7px 20px rgba(38,31,24,.027)");
    expect(previewStyles).toContain("border:1px solid var(--mib-line)");
    expect(previewStyles).toContain("background:var(--booking-card-surface)");
    expect(previewStyles).toContain("--mib-shell-bg:#fbfaf8");
    expect(previewStyles).toContain("background:var(--mib-shell-bg)");
    expect(previewStyles).toContain("grid-template-columns:minmax(96px,.8fr) minmax(0,1.25fr)");
    expect(previewStyles).toContain("object-fit:cover");
    expect(previewStyles).toContain("--mib-gutter:16px");
    expect(previewStyles).toContain("grid-template-columns:148px minmax(0,1fr)");
    expect(previewStyles).toContain("font-family:Montserrat,Arial,sans-serif");
    expect(previewStyles).toContain(".mib-preview-list--activity li{");
    expect(previewStyles).toContain("@media(max-width:840px)");
    expect(previewStyles).toContain("@media(min-width:841px)");
    expect(previewStyles).toContain("position:absolute;top:16px;right:40px;left:42%");
    expect(sidebarSource).toContain('{ label: "Dashboard", icon: LayoutDashboard, href: "/admin2" }');
    expect(sidebarSource).toContain('{ label: "Bookings", icon: CalendarDays, href: "/admin/bookings" }');
    for (const href of [
      "https://quote.maidinblack.com/admin/sms-campaigns",
      "https://quote.maidinblack.com/admin/team-pay",
      "https://quote.maidinblack.com/admin/field-management",
      "https://quote.maidinblack.com/admin/hiring",
      "https://quote.maidinblack.com/admin/cs-inbox-2",
      "https://quote.maidinblack.com/admin/payments",
      "https://quote.maidinblack.com/admin/leads?tab=callbacks",
      "https://quote.maidinblack.com/admin/performance",
      "https://quote.maidinblack.com/admin/invoices",
      "https://quote.maidinblack.com/admin/settings",
    ]) expect(sidebarSource).toContain(href);
    expect(appSource).toContain('const isHomepagePreview = location === "/admin/home-preview" || location === "/admin2";');
    expect(appSource).toContain("!isHomepagePreview");
  });
});

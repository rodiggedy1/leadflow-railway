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
    expect(previewSource).toContain("const metricMicroBars = {");
    expect(previewSource).toContain('className="mib-preview-metric__microchart"');
    expect(previewSource).toContain('className="mib-preview-pulse"');
    expect(previewSource).toContain("Operations Pulse");
    expect(previewSource).toContain('className="mib-command-header mib-command-header--dark-variant"');
    expect(previewSource).toContain("mib-command-header--dark-variant");
    expect(previewSource).toContain("Message the team…");
    expect(previewSource).toContain("const commandPresence = [");
    expect(previewSource).toContain("maUqForRGuyxRSnl.png");
    expect(previewSource).toContain("alt={`${name} portrait preview`}");
    expect(previewStyles).toContain(".mib-command-header__member>b img{display:block;width:100%;height:100%;object-fit:cover");
    expect(previewSource).toContain("vs. last Monday");
    expect(previewStyles).toContain("grid-template-columns:208px minmax(0,1fr)");
    expect(previewStyles).toContain("--booking-card-radius:16px");
    expect(previewStyles).toContain("--booking-card-shadow:0 12px 34px rgba(57,47,37,.055),0 2px 6px rgba(57,47,37,.035)");
    expect(previewStyles).toContain("border:1px solid var(--mib-line)");
    expect(previewStyles).toContain("background:var(--booking-card-surface)");
    expect(previewStyles).toContain("--mib-shell-bg:#f8f6f1");
    expect(previewStyles).toContain("background:radial-gradient(circle at top left,#fffefd 0%,rgba(255,255,255,.7) 30%,transparent 55%),var(--mib-shell-bg)");
    expect(previewStyles).toContain("grid-template-columns:minmax(96px,.8fr) minmax(0,1.25fr)");
    expect(previewStyles).toContain("object-fit:cover");
    expect(previewStyles).toContain("--mib-gutter:16px");
    expect(previewStyles).toContain("grid-template-columns:148px minmax(0,1fr)");
    expect(previewStyles).toContain('font-family:"DM Sans",Arial,sans-serif');
    expect(previewStyles).toContain("background:linear-gradient(180deg,#fffefc 0%,#fdfbf7 100%)");
    expect(previewStyles).toContain(".mib-preview-chart{min-height:274px");
    expect(previewStyles).toContain(".mib-preview-chart header p b{font-size:13px;font-weight:800}");
    expect(previewStyles).toContain(".mib-preview-bars{height:158px;display:flex;align-items:flex-end");
    expect(previewStyles).toContain("background:linear-gradient(to top,#f46747,#ffc7ba)");
    expect(previewStyles).toContain(".mib-preview-chart,.mib-preview-service{min-height:286px");
    expect(previewStyles).toContain(".mib-preview-service>div{flex:1;grid-template-columns:136px minmax(0,1fr)");
    expect(previewStyles).toContain(".mib-preview-donut:after{inset:23px;background:#fffefd}");
    expect(previewStyles).toContain(".mib-home-preview__operating-grid .mib-preview-panel{min-height:286px");
    expect(previewStyles).toContain(".mib-preview-list:not(.mib-preview-list--teams):not(.mib-preview-list--activity) li:first-child>em{background:#e8f8f1;color:#178860}");
    expect(previewStyles).toContain(".mib-preview-list--activity li:nth-child(3)>b{background:#eef1ff;color:#596fe2}");
    expect(previewStyles).toContain(".mib-home-preview__sidebar{border-right-color:rgba(76,65,52,.09);background:linear-gradient(180deg,#fffdfa 0%,#fbf8f2 100%)");
    expect(previewStyles).toContain(".mib-home-preview__help{margin:20px 2px 0;border:1px solid rgba(76,65,52,.085);border-radius:13px");
    expect(previewStyles).toContain(".mib-preview-metric{min-height:132px;display:grid;grid-template-columns:46px minmax(0,1fr) 104px");
    expect(previewStyles).toContain(".mib-preview-metric__microchart{display:grid!important;grid-column:3;grid-row:1/-1");
    expect(previewStyles).toContain(".mib-preview-metric.coral .mib-preview-metric__microchart{color:#f26545}");
    expect(previewStyles).toContain(".mib-preview-metric.green .mib-preview-metric__microchart{color:#1b9a6d}");
    expect(previewStyles).toContain(".mib-preview-pulse{display:flex;align-items:center;min-height:68px;padding:5px 8px");
    expect(previewStyles).toContain(".mib-preview-pulse article+article{border-left:1px solid rgba(73,62,51,.035)}");
    expect(previewStyles).toContain(".mib-preview-pulse{min-height:76px;padding:6px 10px;border-color:rgba(73,62,51,.055);border-radius:16px");
    expect(previewStyles).toContain(".mib-preview-pulse article{flex-basis:168px;grid-template-columns:34px minmax(0,1fr);gap:9px;padding:9px 12px}");
    expect(previewStyles).toContain(".mib-command-header{display:flex;align-items:center;gap:18px;min-height:92px");
    expect(previewStyles).toContain(".mib-command-header__compose{display:flex;align-items:center;width:min(270px,24vw);height:44px");
    expect(previewStyles).toContain(".mib-command-header--dark-variant{border-color:rgba(255,255,255,.10);background:#2B2420");
    expect(previewStyles).toContain(".mib-command-header--dark-variant .mib-command-header__compose{border-color:rgba(255,255,255,.10);background:#39302B");
    expect(previewStyles).toContain("@media(max-width:840px){.mib-preview-pulse{min-height:66px;border-radius:12px}");
    expect(previewStyles).toContain("@media (min-width:841px) and (max-width:1360px){.mib-home-preview__metrics{grid-template-columns:repeat(2,minmax(0,1fr))}");
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

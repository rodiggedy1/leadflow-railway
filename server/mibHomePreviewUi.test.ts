import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const previewSource = readFileSync(new URL("../client/src/pages/MibHomePreview.tsx", import.meta.url), "utf8");
const previewStyles = readFileSync(new URL("../client/src/pages/mib-home-preview.css", import.meta.url), "utf8");

describe("MIB homepage visual-preview contract", () => {
  it("registers an isolated homepage review route without repointing the current admin home", () => {
    expect(appSource).toContain('const MibHomePreview = lazy(() => import("./pages/MibHomePreview"));');
    expect(appSource).toContain('<Route path={"/admin/home-preview"} component={MibHomePreview} />');
    expect(appSource).toContain('window.location.replace("/admin/command-center")');
  });

  it("keeps the review page presentation-only and does not load operational data", () => {
    expect(previewSource).toContain('<AdminPageGuard pageId="command-center">');
    expect(previewSource).toContain('data-presentation-only="true"');
    expect(previewSource).toContain("UI PREVIEW");
    expect(previewSource).toContain("no live customer, booking, payment, message, or operational data is loaded");
    for (const prohibited of ["trpc", "useQuery", "useMutation", "fetch(", "onClick=", "localStorage", "sessionStorage"]) {
      expect(previewSource).not.toContain(prohibited);
    }
  });

  it("uses the MIB dashboard composition and excludes the live global chat overlay", () => {
    for (const marker of ["mib-home-preview__sidebar", "Good morning, Rohan.", "Bookings overview", "Today’s schedule", "Active teams", "Recent activity", "mib-home-preview__promos"]) {
      expect(previewSource).toContain(marker);
    }
    expect(previewSource).toContain("preserveAspectRatio=\"none\"");
    expect(previewSource).toContain("Live after approval");
    expect(previewStyles).toContain("grid-template-columns: 208px minmax(0, 1fr)");
    expect(previewStyles).toContain("--booking-card-radius: 14px");
    expect(previewStyles).toContain("--booking-card-shadow: 0 9px 24px rgba(38, 31, 24, .035)");
    expect(previewStyles).toContain("border: 1px solid var(--mib-line)");
    expect(previewStyles).toContain("background: var(--booking-card-surface)");
    expect(previewStyles).toContain("@media (max-width: 840px)");
    expect(appSource).toContain('const isHomepagePreview = location === "/admin/home-preview";');
    expect(appSource).toContain("!isHomepagePreview");
  });
});

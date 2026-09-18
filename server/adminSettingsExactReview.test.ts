import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");
const nav = readFileSync(resolve(root, "client/src/components/ReviewWorkspaceNav.tsx"), "utf8");

describe("admin Settings exact review baseline", () => {
  it("renders the approved static SettingsReview component inside the identical review frame", () => {
    expect(app).toContain('function AdminSettingsReviewRoute() { return <AdminPageGuard pageId="settings"><ReviewWorkspaceFrame navActivePath="/review/settings"><SettingsReview /></ReviewWorkspaceFrame></AdminPageGuard>; }');
    expect(app).toContain('<Route path={"/admin/settings"} component={AdminSettingsReviewRoute} />');
    expect(app).not.toContain('<Route path={"/admin/settings"} component={SettingsPage} />');
  });

  it("keeps the live access guard but excludes inherited runtime chrome from this exact baseline", () => {
    expect(app).toContain('location.startsWith("/review/") || location === "/admin/settings"');
    expect(app).toContain('import AdminPageGuard from "./components/AdminPageGuard";');
  });

  it("keeps the review navigation visibly active on Settings while the live route is open", () => {
    expect(nav).toContain('export default function ReviewWorkspaceNav({ activePath }: { activePath?: string })');
    expect(nav).toContain('const routeKey = activePath ?? location;');
    expect(nav).toContain('const active = routeKey === item.href;');
  });
});

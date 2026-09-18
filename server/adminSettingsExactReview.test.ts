import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");
const nav = readFileSync(resolve(root, "client/src/components/ReviewWorkspaceNav.tsx"), "utf8");
const settings = readFileSync(resolve(root, "client/src/pages/SettingsExactLive.tsx"), "utf8");

describe("admin Settings exact review baseline", () => {
  it("renders the exact Settings live component inside the identical review frame", () => {
    expect(app).toContain('function AdminSettingsReviewRoute() { return <AdminPageGuard pageId="settings"><ReviewWorkspaceFrame navActivePath="/review/settings"><SettingsExactLive /></ReviewWorkspaceFrame></AdminPageGuard>; }');
    expect(app).toContain('<Route path={"/admin/settings"} component={AdminSettingsReviewRoute} />');
    expect(app).toContain('<Route path={"/admin/widget-config"} component={AdminSettingsReviewRoute} />');
    expect(app).not.toContain('const SettingsPage = lazy(() => import("./pages/SettingsPage"));');
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

  it("retains the existing live settings read, save, and feature-specific contracts inside the approved shell", () => {
    expect(settings).toContain('trpc.settings.getAll.useQuery()');
    expect(settings).toContain('trpc.settings.update.useMutation()');
    expect(settings).toContain('trpc.settings.getBookingWidgetDraft.useQuery()');
    expect(settings).toContain('trpc.settings.updateBookingWidgetDraft.useMutation()');
    expect(settings).toContain('trpc.settings.getPayRules.useQuery()');
    expect(settings).toContain('trpc.settings.updatePayRules.useMutation()');
    expect(settings).toContain('trpc.settings.listCustomPayRules.useQuery()');
    expect(settings).toContain('trpc.settings.createCustomPayRule.useMutation({');
    expect(settings).toContain('trpc.settings.updateCustomPayRule.useMutation({');
    expect(settings).toContain('trpc.settings.deleteCustomPayRule.useMutation({');
    expect(settings).toContain('trpc.responseTemplates.list.useQuery()');
    expect(settings).toContain('trpc.responseTemplates.create.useMutation({');
    expect(settings).toContain('trpc.responseTemplates.update.useMutation({');
    expect(settings).toContain('trpc.responseTemplates.delete.useMutation({');
    expect(settings).toContain('trpc.opsChat.syncOpenPhoneUsers.useMutation()');
    expect(settings).toContain('trpc.opsChat.setAgentOpenPhoneUserId.useMutation()');
    expect(settings).toContain('<BookingWidgetConfigPanel savedValue={bookingDraft?.value} onSave={saveBooking} />');
    expect(settings).toContain('<MessageFlowPanel flowType="reactivation"');
    expect(settings).toContain('C: ["flowC_sms1", "flowC_sms2", "flowC_sms3", "flowC_sms4"]');
    expect(settings).toContain('setDrafts((entries) => ({ ...entries, [activeFlowKey]: flow }))');
    expect(settings).toContain('data-live-settings-shell="true"');
  });
});
